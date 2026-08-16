const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const https = require("https");
const forge = require("node-forge");
const { SignedXml } = require("xml-crypto");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const EMITENTE = {
    cnpj: "66304541000111",
    xNome: "66.304.541 ELAINE CRISTINA DE CAMARGO DE SOUZA",
    ie: "344275522110",
    endereco: {
        xLgr: "RUA XV DE NOVEMBRO",
        nro: "100",
        xBairro: "CENTRO",
        cMun: "3519608",
        xMun: "IBITINGA",
        UF: "SP",
        CEP: "14940000",
        cPais: "1058",
        xPais: "BRASIL",
        fone: "1433420000"
    }
};

const CONFIG = {
    uf: "35",
    municipio: "3519608",
    serie: 1,
    ambiente: 2, // 2 = homologação
    modelo: "65",
    urlAutorizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx"
};

/* =========================================================
   CERTIFICADO
========================================================= */

function carregarCertificado() {
    const certPath = path.join(__dirname, "certificado.pfx");

    if (fs.existsSync(certPath)) {
        return certPath;
    }

    if (!process.env.CERT_BASE64) {
        throw new Error(
            "Certificado não encontrado. Coloque certificado.pfx ou configure CERT_BASE64."
        );
    }

    const base64 = process.env.CERT_BASE64.replace(/\s/g, "");
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(certPath, buffer);

    return certPath;
}

/* =========================================================
   UTILITÁRIOS
========================================================= */

function somenteNumeros(valor) {
    return String(valor || "").replace(/\D/g, "");
}

function calcularDV(chave43) {
    let soma = 0;
    let peso = 2;

    for (let i = chave43.length - 1; i >= 0; i--) {
        soma += Number(chave43[i]) * peso;
        peso++;
        if (peso > 9) {
            peso = 2;
        }
    }

    const resto = soma % 11;
    return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

function dataHoraSaoPaulo() {
    const agora = new Date();
    const partes = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).formatToParts(agora);

    const obj = {};
    for (const p of partes) {
        obj[p.type] = p.value;
    }

    return `${obj.year}-${obj.month}-${obj.day}T${obj.hour}:${obj.minute}:${obj.second}-03:00`;
}

function gerarNumeroNota() {
    return Math.floor(Math.random() * 999999999) + 1;
}

function gerarCodigoNumerico() {
    return String(Math.floor(Math.random() * 99999999)).padStart(8, "0");
}

/* =========================================================
   CHAVE DE ACESSO NFC-e
========================================================= */

function gerarChaveAcesso({ cnpj, data, modelo, serie, numero, tpEmis, cNF }) {
    const aamm = data.substring(2, 4) + data.substring(5, 7);

    const base =
        String(CONFIG.uf).padStart(2, "0") +
        aamm +
        somenteNumeros(cnpj).padStart(14, "0") +
        String(modelo).padStart(2, "0") +
        String(serie).padStart(3, "0") +
        String(numero).padStart(9, "0") +
        String(tpEmis).padStart(1, "0") +
        String(cNF).padStart(8, "0");

    if (base.length !== 43) {
        throw new Error(`Chave inválida: base possui ${base.length} dígitos em vez de 43.`);
    }

    const dv = calcularDV(base);
    return base + dv;
}

/* =========================================================
   CERTIFICADO / PFX
========================================================= */

function carregarPfx() {
    const certPath = carregarCertificado();
    const senha = process.env.CERT_PASSWORD;

    if (senha === undefined) {
        throw new Error("CERT_PASSWORD não configurada.");
    }

    const pfxData = fs.readFileSync(certPath);
    const p12Asn1 = forge.asn1.fromDer(pfxData.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

    let privateKey = null;
    let publicCert = null;

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certificados = certBags[forge.pki.oids.certBag] || [];

    if (certificados.length > 0 && certificados[0].cert) {
        publicCert = forge.pki.certificateToPem(certificados[0].cert);
    }

    const keyBagTypes = [
        forge.pki.oids.pkcs8ShroudedKeyBag,
        forge.pki.oids.keyBag
    ];

    for (const bagType of keyBagTypes) {
        if (privateKey) break;
        try {
            const bags = p12.getBags({ bagType });
            const lista = bags[bagType] || [];
            if (lista.length > 0 && lista[0].key) {
                privateKey = forge.pki.privateKeyToPem(lista[0].key);
            }
        } catch (erro) {
            // Tenta próximo tipo
        }
    }

    if (!privateKey) {
        throw new Error("Chave privada não encontrada no certificado PFX.");
    }

    if (!publicCert) {
        throw new Error("Certificado público não encontrado no PFX.");
    }

    return {
        privateKey,
        publicCert,
        certPath
    };
}

/* =========================================================
   KEY INFO XMLDSIG
========================================================= */

function MyKeyInfo(pemCert) {
    this.getKeyInfo = function () {
        const cleanCert = pemCert
            .replace(/-----BEGIN CERTIFICATE-----/g, "")
            .replace(/-----END CERTIFICATE-----/g, "")
            .replace(/\r?\n|\r/g, "");

        return (
            `<ds:X509Data>` +
            `<ds:X509Certificate>${cleanCert}</ds:X509Certificate>` +
            `</ds:X509Data>`
        );
    };

    this.getKey = function () {
        return null;
    };
}

/* =========================================================
   ASSINATURA
========================================================= */

function assinarNFe(xmlNFe, privateKey, publicCert) {
    const sig = new SignedXml();

    sig.prefix = "ds";
    sig.keyInfoProvider = new MyKeyInfo(publicCert);
    sig.signingKey = privateKey;

    sig.addReference(
        "//*[local-name()='infNFe']",
        [
            "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
            "http://www.w3.org/2001/10/xml-exc-c14n#"
        ],
        "http://www.w3.org/2001/04/xmlenc#sha256"
    );

    sig.computeSignature(xmlNFe, {
        location: {
            reference: "//*[local-name()='infNFe']",
            action: "after"
        }
    });

    return sig.getSignedXml();
}

/* =========================================================
   XML NFC-e
========================================================= */

function montarXmlNFCe(dados) {
    const numero = dados.numero;
    const serie = CONFIG.serie;
    const dataHora = dados.dhEmi;
    const cNF = dados.cNF;
    const tpEmis = 1;

    const chave = gerarChaveAcesso({
        cnpj: EMITENTE.cnpj,
        data: dataHora,
        modelo: 65,
        serie,
        numero,
        tpEmis,
        cNF
    });

    const dv = chave.slice(-1);

    const produto = dados.produto || {
        codigo: "001",
        descricao: "PRODUTO TESTE",
        ncm: "21069090",
        cfop: "5102",
        unidade: "UN",
        quantidade: 1,
        valorUnitario: 10
    };

    const quantidade = Number(produto.quantidade || 1);
    const valorUnitario = Number(produto.valorUnitario || 0);
    const valorProduto = quantidade * valorUnitario;
    const valorFormatado = valorProduto.toFixed(2);

    const xml = `
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe Id="NFe${chave}" versao="4.00">

<ide>
<cUF>${CONFIG.uf}</cUF>
<cNF>${cNF}</cNF>
<natOp>VENDA</natOp>
<mod>65</mod>
<serie>${serie}</serie>
<nNF>${numero}</nNF>
<dhEmi>${dataHora}</dhEmi>
<tpNF>1</tpNF>
<idDest>1</idDest>
<cMunFG>${CONFIG.municipio}</cMunFG>
<tpImp>4</tpImp>
<tpEmis>${tpEmis}</tpEmis>
<cDV>${dv}</cDV>
<tpAmb>${CONFIG.ambiente}</tpAmb>
<finNFe>1</finNFe>
<indFinal>1</indFinal>
<indPres>1</indPres>
<procEmi>0</procEmi>
<verProc>1.0.0</verProc>
</ide>

<emit>
<CNPJ>${EMITENTE.cnpj}</CNPJ>
<xNome>${EMITENTE.xNome}</xNome>
<enderEmit>
<xLgr>${EMITENTE.endereco.xLgr}</xLgr>
<nro>${EMITENTE.endereco.nro}</nro>
<xBairro>${EMITENTE.endereco.xBairro}</xBairro>
<cMun>${EMITENTE.endereco.cMun}</cMun>
<xMun>${EMITENTE.endereco.xMun}</xMun>
<UF>${EMITENTE.endereco.UF}</UF>
<CEP>${EMITENTE.endereco.CEP}</CEP>
<cPais>${EMITENTE.endereco.cPais}</cPais>
<xPais>${EMITENTE.endereco.xPais}</xPais>
<fone>${EMITENTE.endereco.fone}</fone>
</enderEmit>
<IE>${EMITENTE.ie}</IE>
<CRT>1</CRT>
</emit>

<det nItem="1">
<prod>
<cProd>${produto.codigo}</cProd>
<cEAN>SEM GTIN</cEAN>
<xProd>${produto.descricao}</xProd>
<NCM>${produto.ncm}</NCM>
<CFOP>${produto.cfop}</CFOP>
<uCom>${produto.unidade}</uCom>
<qCom>${quantidade.toFixed(4)}</qCom>
<vUnCom>${valorUnitario.toFixed(10)}</vUnCom>
<vProd>${valorFormatado}</vProd>
<cEANTrib>SEM GTIN</cEANTrib>
<uTrib>${produto.unidade}</uTrib>
<qTrib>${quantidade.toFixed(4)}</qTrib>
<vUnTrib>${valorUnitario.toFixed(10)}</vUnTrib>
<indTot>1</indTot>
</prod>
<imposto>
<ICMS>
<ICMSSN102>
<orig>0</orig>
<CSOSN>102</CSOSN>
</ICMSSN102>
</ICMS>
<PIS>
<PISOutr>
<CST>99</CST>
<vBC>0.00</vBC>
<pPIS>0.00</pPIS>
<vPIS>0.00</vPIS>
</PISOutr>
</PIS>
<COFINS>
<COFINSOutr>
<CST>99</CST>
<vBC>0.00</vBC>
<pCOFINS>0.00</pCOFINS>
<vCOFINS>0.00</vCOFINS>
</COFINSOutr>
</COFINS>
</imposto>
</det>

<total>
<ICMSTot>
<vBC>0.00</vBC>
<vICMS>0.00</vICMS>
<vICMSDeson>0.00</vICMSDeson>
<vFCP>0.00</vFCP>
<vBCST>0.00</vBCST>
<vST>0.00</vST>
<vFCPST>0.00</vFCPST>
<vFCPSTRet>0.00</vFCPSTRet>
<vProd>${valorFormatado}</vProd>
<vFrete>0.00</vFrete>
<vSeg>0.00</vSeg>
<vDesc>0.00</vDesc>
<vII>0.00</vII>
<vIPI>0.00</vIPI>
<vIPIDevol>0.00</vIPIDevol>
<vPIS>0.00</vPIS>
<vCOFINS>0.00</vCOFINS>
<vOutro>0.00</vOutro>
<vNF>${valorFormatado}</vNF>
<vTotTrib>0.00</vTotTrib>
</ICMSTot>
</total>

<transp>
<modFrete>9</modFrete>
</transp>

<pag>
<detPag>
<tPag>01</tPag>
<vPag>${valorFormatado}</vPag>
</detPag>
</pag>

<infRespTec>
<CNPJ>${EMITENTE.cnpj}</CNPJ>
<xContato>Elaine</xContato>
<email>suporte@sistema.com</email>
<fone>14999999999</fone>
</infRespTec>

</infNFe>
</NFe>
`.trim();

    return {
        xml,
        chave
    };
}

/* =========================================================
   ROTA INICIAL
========================================================= */

app.get("/", (req, res) => {
    res.json({
        sistema: "ERP NFC-e",
        status: "API Ativa",
        ambiente: CONFIG.ambiente === 2 ? "HOMOLOGAÇÃO" : "PRODUÇÃO",
        sefaz: CONFIG.urlAutorizacao
    });
});

/* =========================================================
   EMITIR NFC-e
========================================================= */

app.post("/emitir-nfce", (req, res) => {
    try {
        const numero = Number(req.body.numero) || gerarNumeroNota();
        const dhEmi = dataHoraSaoPaulo();
        const cNF = gerarCodigoNumerico();

        const dados = {
            numero,
            dhEmi,
            cNF,
            produto: req.body.produto
        };

        const nfce = montarXmlNFCe(dados);
        const certificado = carregarPfx();

        const xmlAssinado = assinarNFe(
            nfce.xml,
            certificado.privateKey,
            certificado.publicCert
        );

        res.json({
            sucesso: true,
            ambiente: CONFIG.ambiente,
            numero,
            serie: CONFIG.serie,
            chaveAcesso: nfce.chave,
            xmlAssinado
        });
    } catch (erro) {
        console.error("ERRO EMITIR:", erro);
        res.status(500).json({
            sucesso: false,
            erro: erro.message
        });
    }
});

/* =========================================================
   TRANSMITIR NFC-e (SOAP 1.2)
========================================================= */

app.post("/transmitir-nfce", async (req, res) => {
    try {
        if (!req.body.xmlAssinado) {
            return res.status(400).json({
                sucesso: false,
                erro: "xmlAssinado não foi informado."
            });
        }

        const xmlAssinado = req.body.xmlAssinado;
        const idLote = String(Date.now()).slice(-15);

        const soap = `
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <soap12:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
            <enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
                <idLote>${idLote}</idLote>
                <indSinc>1</indSinc>
                ${xmlAssinado}
            </enviNFe>
        </nfeDadosMsg>
    </soap12:Body>
</soap12:Envelope>
`.trim();

        const certificado = carregarPfx();

        const httpsAgent = new https.Agent({
            key: certificado.privateKey,
            cert: certificado.publicCert,
            rejectUnauthorized: false,
            minVersion: "TLSv1.2",
            maxVersion: "TLSv1.2"
        });

        console.log("Enviando lote para a SEFAZ-SP via SOAP 1.2...");

        const resposta = await axios.post(CONFIG.urlAutorizacao, soap, {
            httpsAgent,
            timeout: 60000,
            headers: {
                "Content-Type": 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',
                "Accept": "application/soap+xml, text/xml, */*"
            },
            validateStatus: function (status) {
                return status < 500;
            }
        });

        console.log("Status HTTP recebido da SEFAZ:", resposta.status);

        if (resposta.status !== 200) {
            return res.status(resposta.status).json({
                sucesso: false,
                status: resposta.status,
                erro: `SEFAZ rejeitou a conexão com HTTP ${resposta.status}`,
                respostaSefaz: resposta.data || "Nenhum detalhe retornado no corpo."
            });
        }

        res.json({
            sucesso: true,
            status: resposta.status,
            respostaSefaz: resposta.data,
            lote: idLote
        });

    } catch (erro) {
        console.error("========== ERRO REAL SEFAZ ==========");
        console.error("message:", erro.message);
        console.error("code:", erro.code);
        console.error("errno:", erro.errno);
        console.error("syscall:", erro.syscall);
        console.error("hostname:", erro.hostname);
        console.error("stack:", erro.stack);

        if (erro.response) {
            console.error("HTTP STATUS:", erro.response.status);
            console.error("HEADERS:", erro.response.headers);
            console.error("DATA:", erro.response.data);
        }

        if (erro.request) {
            console.error("REQUEST EXISTE: SIM");
        }

        console.error("=====================================");

        return res.status(500).json({
            sucesso: false,
            erro: erro.message,
            codigo: erro.code || null,
            errno: erro.errno || null,
            syscall: erro.syscall || null,
            hostname: erro.hostname || null,
            status: erro.response?.status || null,
            respostaSefaz: erro.response?.data || null
        });
    }
});

/* =========================================================
   TESTE DO CERTIFICADO
========================================================= */

app.get("/testar-certificado", (req, res) => {
    try {
        const certificado = carregarPfx();
        res.json({
            sucesso: true,
            mensagem: "Certificado PFX carregado corretamente.",
            certificado: Boolean(certificado.publicCert),
            chavePrivada: Boolean(certificado.privateKey)
        });
    } catch (erro) {
        res.status(500).json({
            sucesso: false,
            erro: erro.message
        });
    }
});

/* =========================================================
   TESTAR SEFAZ (STATUS SERVIÇO)
========================================================= */

app.get("/testar-sefaz", async (req, res) => {
    try {
        const certificado = carregarPfx();

        const soap = `
<soap12:Envelope
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
    <soap12:Body>
        <nfeDadosMsg
            xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
            <consStatServ
                xmlns="http://www.portalfiscal.inf.br/nfe"
                versao="4.00">
                <tpAmb>2</tpAmb>
                <cUF>35</cUF>
                <xServ>STATUS</xServ>
            </consStatServ>
        </nfeDadosMsg>
    </soap12:Body>
</soap12:Envelope>
`.trim();

        const httpsAgent = new https.Agent({
            key: certificado.privateKey,
            cert: certificado.publicCert,
            rejectUnauthorized: true,
            minVersion: "TLSv1.2"
        });

        const resposta = await axios.post(
            "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
            soap,
            {
                httpsAgent,
                timeout: 60000,
                headers: {
                    "Content-Type": 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF"',
                    "Accept": "application/soap+xml, text/xml, */*"
                },
                validateStatus: () => true
            }
        );

        console.log("===== TESTE SEFAZ =====");
        console.log("STATUS:", resposta.status);
        console.log("RESPOSTA:", resposta.data);
        console.log("=======================");

        res.json({
            sucesso: resposta.status >= 200 && resposta.status < 300,
            status: resposta.status,
            respostaSefaz: resposta.data
        });

    } catch (erro) {
        console.error("===== ERRO TESTE SEFAZ =====");
        console.error("MESSAGE:", erro.message);
        console.error("CODE:", erro.code);
        console.error("STATUS:", erro.response?.status);
        console.error("DATA:", erro.response?.data);
        console.error("============================");

        res.status(500).json({
            sucesso: false,
            erro: erro.message,
            codigoRede: erro.code || null,
            status: erro.response?.status || null,
            respostaSefaz: erro.response?.data || null
        });
    }
});

/* =========================================================
   INICIAR
========================================================= */

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log("Ambiente:", CONFIG.ambiente === 2 ? "HOMOLOGAÇÃO" : "PRODUÇÃO");
    console.log("SEFAZ:", CONFIG.urlAutorizacao);
});

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
    if (fs.existsSync(certPath)) return certPath;

    if (!process.env.CERT_BASE64) {
        throw new Error("Certificado não encontrado. Configure CERT_BASE64.");
    }

    const base64 = process.env.CERT_BASE64.replace(/\s/g, "");
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(certPath, buffer);
    return certPath;
}

function carregarPfx() {
    const certPath = carregarCertificado();
    const senha = process.env.CERT_PASSWORD;
    if (!senha) throw new Error("CERT_PASSWORD não configurada.");

    const pfxData = fs.readFileSync(certPath);
    const p12Asn1 = forge.asn1.fromDer(pfxData.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);

    let privateKey = null;
    let publicCert = null;

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (certBags[forge.pki.oids.certBag]) publicCert = forge.pki.certificateToPem(certBags[forge.pki.oids.certBag][0].cert);

    const keyBagTypes = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag];
    for (const bagType of keyBagTypes) {
        const bags = p12.getBags({ bagType });
        if (bags[bagType]) {
            privateKey = forge.pki.privateKeyToPem(bags[bagType][0].key);
            break;
        }
    }
    if (!privateKey || !publicCert) throw new Error("Erro ao extrair chaves do PFX.");
    return { privateKey, publicCert };
}

/* =========================================================
   XML & ASSINATURA
========================================================= */

function MyKeyInfo(pemCert) {
    this.getKeyInfo = () => `<ds:X509Data><ds:X509Certificate>${pemCert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\r?\n|\r/g, "")}</ds:X509Certificate></ds:X509Data>`;
    this.getKey = () => null;
}

function assinarNFe(xmlNFe, privateKey, publicCert) {
    const sig = new SignedXml();
    sig.prefix = "ds";
    sig.keyInfoProvider = new MyKeyInfo(publicCert);
    sig.signingKey = privateKey;
    sig.addReference("//*[local-name()='infNFe']", ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], "http://www.w3.org/2001/04/xmlenc#sha256");
    sig.computeSignature(xmlNFe, { location: { reference: "//*[local-name()='infNFe']", action: "after" } });
    return sig.getSignedXml();
}

function montarXmlNFCe(dados) {
    const chave = "35" + "2608" + "66304541000111" + "65" + String(CONFIG.serie).padStart(3, "0") + String(dados.numero).padStart(9, "0") + "1" + String(dados.cNF).padStart(8, "0") + "0";
    // Nota: O cálculo do dígito verificador (DV) deve ser implementado aqui.
    
    return { xml: `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chave}" versao="4.00">...</infNFe></NFe>`, chave };
}

/* =========================================================
   ROTAS
========================================================= */

app.post("/emitir-nfce", (req, res) => {
    try {
        const dados = { numero: req.body.numero || 1, cNF: "12345678", dhEmi: new Date().toISOString() };
        const { xml, chave } = montarXmlNFCe(dados);
        const { privateKey, publicCert } = carregarPfx();
        const xmlAssinado = assinarNFe(xml, privateKey, publicCert);
        res.json({ sucesso: true, xmlAssinado, chaveAcesso: chave });
    } catch (e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

// ROTA CORRIGIDA COM SOAP 1.1
app.post("/transmitir-nfce", async (req, res) => {
    try {
        const soap = `
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
            <enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
                <idLote>${Date.now().toString().slice(-15)}</idLote>
                <indSinc>1</indSinc>
                ${req.body.xmlAssinado}
            </enviNFe>
        </nfeDadosMsg>
    </soap:Body>
</soap:Envelope>`;

        const { privateKey, publicCert } = carregarPfx();
        const httpsAgent = new https.Agent({ key: privateKey, cert: publicCert, rejectUnauthorized: false });

        const resposta = await axios.post(CONFIG.urlAutorizacao, soap, {
            httpsAgent,
            headers: {
                "Content-Type": "text/xml; charset=utf-8",
                "SOAPAction": "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"
            }
        });

        res.json({ sucesso: true, respostaSefaz: resposta.data });
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: e.message, detalhes: e.response?.data });
    }
});

app.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));

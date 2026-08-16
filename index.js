const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { SignedXml } = require('xml-crypto');
const forge = require('node-forge');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cors());

// Configurações do Emitente (Elaine Cristina)
const EMITENTE = {
    cnpj: "66304541000111",
    xNome: "66.304.541 ELAINE CRISTINA DE CAMARGO DE SOUZA",
    ie: "344275522110",
    enderEmit: {
        xLgr: "Rua Exemplo",
        nro: "123",
        xBairro: "Centro",
        cMun: "3519608", // Código IBGE de Ibitinga - SP
        xMun: "Ibitinga",
        uf: "SP",
        cep: "14940000"
    }
};

// Função para carregar o certificado digital das variáveis de ambiente do Render
function carregarCertificado() {
    try {
        if (!process.env.CERT_BASE64) {
            console.log("Aviso: CERT_BASE64 não configurado.");
            return null;
        }
        const certBuffer = Buffer.from(process.env.CERT_BASE64, 'base64');
        const certPath = path.join(__dirname, 'certificado.pfx');
        fs.writeFileSync(certPath, certBuffer);
        console.log("Certificado digital carregado com sucesso!");
        return certPath;
    } catch (erro) {
        console.error("Erro ao carregar o certificado:", erro.message);
        return null;
    }
}

carregarCertificado();

// Rota de Status
app.get('/', (req, res) => {
    res.json({ 
        status: "API Fiscal NFC-e Rodando com Assinatura e Transmissão!",
        emitente: EMITENTE.xNome,
        cnpj: EMITENTE.cnpj
    });
});

// Rota 1: Gerar o XML e Assinar Digitalmente
app.post('/emitir-nfce', (req, res) => {
    try {
        const dadosVenda = req.body;
        const nNF = Math.floor(Math.random() * 999999) + 1;
        const cDV = "5";
        const chNFe = `352608${EMITENTE.cnpj}65001000${String(nNF).padStart(9, '0')}1${cDV}`;

        let xmlNFe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chNFe}" versao="4.00">
        <ide>
            <cUF>35</cUF>
            <cNF>00000001</cNF>
            <natOp>VENDAS</natOp>
            <mod>65</mod>
            <serie>1</serie>
            <nNF>${nNF}</nNF>
            <dhEmi>${new Date().toISOString()}</dhEmi>
            <tpNF>1</tpNF>
            <idDest>1</idDest>
            <cMunFG>${EMITENTE.enderEmit.cMun}</cMunFG>
            <tpImp>4</tpImp>
            <tpEmis>1</tpEmis>
            <cDV>${cDV}</cDV>
            <tpAmb>2</tpAmb>
            <finNFe>1</finNFe>
            <indFinal>1</indFinal>
            <indPres>1</indPres>
            <procEmi>0</procEmi>
            <verProc>1.0</verProc>
        </ide>
        <emit>
            <CNPJ>${EMITENTE.cnpj}</CNPJ>
            <xNome>${EMITENTE.xNome}</xNome>
            <enderEmit>
                <xLgr>${EMITENTE.enderEmit.xLgr}</xLgr>
                <nro>${EMITENTE.enderEmit.nro}</nro>
                <xBairro>${EMITENTE.enderEmit.xBairro}</xBairro>
                <cMun>${EMITENTE.enderEmit.cMun}</cMun>
                <xMun>${EMITENTE.enderEmit.xMun}</xMun>
                <UF>${EMITENTE.enderEmit.uf}</UF>
                <CEP>${EMITENTE.enderEmit.cep}</CEP>
                <cPais>1058</cPais>
                <xPais>BRASIL</xPais>
            </enderEmit>
            <IE>${EMITENTE.ie}</IE>
            <CRT>1</CRT>
        </emit>
        <det nItem="1">
            <prod>
                <cProd>001</cProd>
                <cEAN>SEM GTIN</cEAN>
                <xProd>Produto de Teste Elaine</xProd>
                <NCM>00000000</NCM>
                <CFOP>5102</CFOP>
                <uCom>UN</uCom>
                <qCom>1.0000</qCom>
                <vUnCom>150.00</vUnCom>
                <vProd>150.00</vProd>
                <cEANTrib>SEM GTIN</cEANTrib>
                <uTrib>UN</uTrib>
                <qTrib>1.0000</qTrib>
                <vUnTrib>150.00</vUnTrib>
                <indTot>1</indTot>
            </prod>
            <imposto>
                <ICMS>
                    <ICMSSN102>
                        <orig>0</orig>
                        <CSOSN>102</CSOSN>
                    </ICMSSN102>
                </ICMS>
                <PIS><PISOutr><CST>99</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>
                <COFINS><COFINSOutr><CST>99</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vPCOFINS>0.00</vPCOFINS></COFINSOutr></COFINS>
            </imposto>
        </det>
        <total>
            <ICMSTot>
                <vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>
                <vProd>150.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol>
                <vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>150.00</vNF><vTotTrib>0.00</vTotTrib>
            </ICMSTot>
        </total>
        <transp><modFrete>9</modFrete></transp>
        <pag><detPag><tPag>01</tPag><vPag>150.00</vPag></detPag></pag>
    </infNFe>
</NFe>`;

        // Assinatura Digital
        let xmlAssinado = xmlNFe;
        const certPath = path.join(__dirname, 'certificado.pfx');
        if (fs.existsSync(certPath)) {
            const pfxData = fs.readFileSync(certPath);
            const p12Asn1 = forge.asn1.fromDer(pfxData.toString('binary'));
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, process.env.CERT_PASSWORD);
            const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
            const pkcs8Bag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0];
            const privateKey = forge.pki.privateKeyToPem(pkcs8Bag.key);

            const sig = new SignedXml();
            sig.addReference(
                "//*[local-name()='infNFe']",
                ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
                "http://www.w3.org/2000/09/xmldsig#sha1"
            );
            sig.signingKey = privateKey;
            sig.computeSignature(xmlNFe);
            xmlAssinado = sig.getSignedXml();
        }

        res.json({
            sucesso: true,
            mensagem: "XML gerado e assinado com sucesso!",
            xmlAssinado,
            chaveAcesso: chNFe
        });

    } catch (erro) {
        console.error("Erro ao gerar/assinar:", erro);
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

// Rota 2: Transmitir para a SEFAZ-SP (Homologação)
app.post('/transmitir-nfce', async (req, res) => {
    try {
        let { xmlAssinado } = req.body;

        if (!xmlAssinado) {
            return res.status(400).json({ sucesso: false, erro: "XML assinado não fornecido." });
        }

        // Limpeza de espaços excedentes e quebras de linha para evitar erro de formatação na SEFAZ
        xmlAssinado = xmlAssinado.replace(/>\s+</g, '><').trim();

        const httpsAgent = new https.Agent({
            pfx: fs.readFileSync(path.join(__dirname, 'certificado.pfx')),
            passphrase: process.env.CERT_PASSWORD,
            rejectUnauthorized: false
        });

        const soapEnvelope = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:stat="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
            <soap:Header/>
            <soap:Body>
                <stat:nfeDadosMsg>
                    <enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
                        <idLote>1</idLote>
                        <indSinc>1</indSinc>
                        ${xmlAssinado}
                    </enviNFe>
                </stat:nfeDadosMsg>
            </soap:Body>
        </soap:Envelope>`;

        const resposta = await axios.post(
            "https://homologacao.nfce.fazenda.sp.gov.br/nfceWEB/services/NFeAutorizacao4.asmx", 
            soapEnvelope, 
            {
                headers: { 
                    'Content-Type': 'application/soap+xml; charset=utf-8',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote'
                },
                httpsAgent,
                timeout: 20000
            }
        );

        res.json({
            sucesso: true,
            mensagem: "Requisição processada pela SEFAZ!",
            retornoSefaz: resposta.data
        });

    } catch (erro) {
        const detalheErro = erro.response ? erro.response.data : erro.message;
        console.error("Erro na transmissão SEFAZ:", detalheErro);
        res.status(500).json({ sucesso: false, erro: detalheErro });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
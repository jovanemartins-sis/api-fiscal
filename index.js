const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { SignedXml } = require('xml-crypto');
const forge = require('node-forge');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json({ limit: '5mb' })); // Aumentado limite para XMLs
app.use(cors());

// Configurações do Emitente
const EMITENTE = {
    cnpj: "66304541000111",
    xNome: "66.304.541 ELAINE CRISTINA DE CAMARGO DE SOUZA",
    ie: "344275522110",
    enderEmit: {
        xLgr: "Rua Exemplo",
        nro: "123",
        xBairro: "Centro",
        cMun: "3519608",
        xMun: "Ibitinga",
        uf: "SP",
        cep: "14940000"
    }
};

// Carregamento do Certificado
function carregarCertificado() {
    try {
        if (process.env.CERT_BASE64) {
            const certBuffer = Buffer.from(process.env.CERT_BASE64, 'base64');
            fs.writeFileSync(path.join(__dirname, 'certificado.pfx'), certBuffer);
            console.log("Certificado carregado!");
        }
    } catch (e) { console.error("Erro ao carregar certificado:", e.message); }
}
carregarCertificado();

// Rota 1: Gerar e Assinar
app.post('/emitir-nfce', (req, res) => {
    try {
        const dadosVenda = req.body;
        const nNF = Math.floor(Math.random() * 999999) + 1;
        const chNFe = `352608${EMITENTE.cnpj}65001000${String(nNF).padStart(9, '0')}15`;

        let xmlNFe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chNFe}" versao="4.00">...</infNFe></NFe>`;
        // (Estrutura simplificada para o exemplo, preencha com o XML completo do passo anterior)

        let xmlAssinado = xmlNFe;
        const certPath = path.join(__dirname, 'certificado.pfx');
        
        if (fs.existsSync(certPath)) {
            const pfxData = fs.readFileSync(certPath);
            const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfxData.toString('binary')), process.env.CERT_PASSWORD);
            const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag][0];
            const privateKey = forge.pki.privateKeyToPem(keyBag.key);

            const sig = new SignedXml();
            sig.addReference("//*[local-name()='infNFe']", ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], "http://www.w3.org/2000/09/xmldsig#sha1");
            sig.signingKey = privateKey;
            sig.computeSignature(xmlNFe);
            xmlAssinado = sig.getSignedXml();
        }

        res.json({ sucesso: true, xmlAssinado, chaveAcesso: chNFe });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
});

// Rota 2: Transmitir para a SEFAZ
app.post('/transmitir-nfce', async (req, res) => {
    try {
        const { xmlAssinado } = req.body;

        const httpsAgent = new https.Agent({
            pfx: fs.readFileSync(path.join(__dirname, 'certificado.pfx')),
            passphrase: process.env.CERT_PASSWORD,
            rejectUnauthorized: false
        });

        const soapEnvelope = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${xmlAssinado}</nfeDadosMsg></soap:Body></soap:Envelope>`;

        const resposta = await axios.post("https://homologacao.nfce.fazenda.sp.gov.br/nfceWEB/services/NFeAutorizacao4.asmx", soapEnvelope, {
            headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
            httpsAgent
        });

        res.json({ sucesso: true, retorno: resposta.data });
    } catch (erro) {
        res.status(500).json({ erro: "Falha na comunicação com SEFAZ" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
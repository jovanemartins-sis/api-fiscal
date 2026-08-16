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

// --- CONFIGURAÇÃO ---
const EMITENTE = {
    cnpj: "66304541000111",
    xNome: "66.304.541 ELAINE CRISTINA DE CAMARGO DE SOUZA",
    ie: "344275522110"
};

// --- FUNÇÕES AUXILIARES ---
function carregarCertificado() {
    if (!process.env.CERT_BASE64) return null;
    const certBuffer = Buffer.from(process.env.CERT_BASE64.replace(/\s/g, ''), 'base64');
    const certPath = path.join(__dirname, 'certificado.pfx');
    fs.writeFileSync(certPath, certBuffer);
    return certPath;
}
carregarCertificado();

function calcularDV(chave43) {
    let soma = 0, peso = 2;
    for (let i = chave43.length - 1; i >= 0; i--) {
        soma += parseInt(chave43.charAt(i)) * peso;
        peso = (peso === 9) ? 2 : peso + 1;
    }
    let resto = soma % 11;
    return (resto < 2) ? "0" : String(11 - resto);
}

// --- ROTAS ---
app.get('/', (req, res) => res.json({ status: "API Ativa" }));

app.post('/emitir-nfce', (req, res) => {
    try {
        const nNF = Math.floor(Math.random() * 999999) + 1;
        const nNFStr = String(nNF).padStart(9, '0');
        const chBase = "3526086630454100011165001" + nNFStr + "100000001";
        const chNFe = chBase + calcularDV(chBase);

        // XML Minificado para evitar falha de schema
        let xmlNFe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${chNFe}" versao="4.00"><ide><cUF>35</cUF><cNF>00000001</cNF><natOp>VENDAS</natOp><mod>65</mod><serie>1</serie><nNF>${nNF}</nNF><dhEmi>2026-08-16T17:20:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>3519608</cMunFG><tpImp>4</tpImp><tpEmis>1</tpEmis><cDV>${chNFe.slice(-1)}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>1.0</verProc></ide><emit><CNPJ>${EMITENTE.cnpj}</CNPJ><xNome>${EMITENTE.xNome}</xNome><enderEmit><xLgr>Rua Exemplo</xLgr><nro>123</nro><xBairro>Centro</xBairro><cMun>3519608</cMun><xMun>Ibitinga</xMun><UF>SP</UF><CEP>14940000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>${EMITENTE.ie}</IE><CRT>1</CRT></emit><det nItem="1"><prod><cProd>001</cProd><cEAN>SEM GTIN</cEAN><xProd>TESTE</xProd><NCM>21069090</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1.0000</qTrib><vUnTrib>10.00</vUnTrib><indTot>1</indTot></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det><total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>10.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>10.00</vNF><vTotTrib>0.00</vTotTrib></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag></pag><infRespTec><CNPJ>${EMITENTE.cnpj}</CNPJ><xContato>Elaine</xContato><email>a@a.com</email><fone>14999999999</fone></infRespTec></infNFe></NFe>`;

        // Leitura otimizada e blindada da chave privada do PFX
        const pfxData = fs.readFileSync(path.join(__dirname, 'certificado.pfx'));
        const p12Asn1 = forge.asn1.fromDer(pfxData.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, process.env.CERT_PASSWORD);
        
        let privateKey = null;
        try {
            const bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
            if (bags[forge.pki.oids.pkcs8ShroudedKeyBag] && bags[forge.pki.oids.pkcs8ShroudedKeyBag].length > 0) {
                privateKey = forge.pki.privateKeyToPem(bags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key);
            }
        } catch (err) {
            // Ignora e tenta o próximo formato se houver falha
        }

        if (!privateKey) {
            try {
                const bags = p12.getBags({ bagType: forge.pki.oids.keyBag });
                if (bags[forge.pki.oids.keyBag] && bags[forge.pki.oids.keyBag].length > 0) {
                    privateKey = forge.pki.privateKeyToPem(bags[forge.pki.oids.keyBag][0].key);
                }
            } catch (err) {
                // Ignora
            }
        }

        if (!privateKey) {
            return res.status(500).json({ sucesso: false, erro: "Chave privada não encontrada no certificado PFX." });
        }

        const sig = new SignedXml();
        sig.addReference("//*[local-name()='infNFe']", ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], "http://www.w3.org/2001/04/xmlenc#sha256");
        sig.signingKey = privateKey;
        sig.computeSignature(xmlNFe);

        res.json({ sucesso: true, xmlAssinado: sig.getSignedXml(), chaveAcesso: chNFe });
    } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/transmitir-nfce', async (req, res) => {
    try {
        const soap = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4"><enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>1</idLote><indSinc>1</indSinc>${req.body.xmlAssinado}</enviNFe></nfeDadosMsg></soap12:Body></soap12:Envelope>`;
        const resp = await axios.post("https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx", soap, {
            headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
            httpsAgent: new https.Agent({ pfx: fs.readFileSync(path.join(__dirname, 'certificado.pfx')), passphrase: process.env.CERT_PASSWORD, rejectUnauthorized: false })
        });
        res.json({ xml: resp.data });
    } catch (e) { res.status(500).json({ erro: e.response?.data || e.message }); }
});

app.listen(process.env.PORT || 10000);

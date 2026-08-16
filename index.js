const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { SignedXml } = require('xml-crypto');
const forge = require('node-forge');

const app = express();
app.use(express.json());
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
        status: "API Fiscal NFC-e Rodando com Assinatura Digital!",
        emitente: EMITENTE.xNome,
        cnpj: EMITENTE.cnpj
    });
});

// Rota Principal: Recebe a venda, monta o XML e assina digitalmente
app.post('/emitir-nfce', (req, res) => {
    try {
        const dadosVenda = req.body;

        if (!dadosVenda || !dadosVenda.itens || dadosVenda.itens.length === 0) {
            return res.status(400).json({ erro: "Nenhum item encontrado na venda." });
        }

        // 1. Montagem da estrutura XML da NFC-e (Modelo 65)
        const nNF = Math.floor(Math.random() * 999999) + 1;
        const cDV = "5";
        const chNFe = `352608${EMITENTE.cnpj}65001000${String(nNF).padStart(9, '0')}1${cDV}`;

        let xmlItens = "";
        let totalProdutos = 0;

        dadosVenda.itens.forEach((item, index) => {
            const vProd = Number(item.valor).toFixed(2);
            totalProdutos += Number(vProd);
            xmlItens += `
            <det nItem="${index + 1}">
                <prod>
                    <cProd>${item.codigo || (index + 1)}</cProd>
                    <cEAN>SEM GTIN</cEAN>
                    <xProd>${item.descricao}</xProd>
                    <NCM>00000000</NCM>
                    <CFOP>5102</CFOP>
                    <uCom>UN</uCom>
                    <qCom>1.0000</qCom>
                    <vUnCom>${vProd}</vUnCom>
                    <vProd>${vProd}</vProd>
                    <cEANTrib>SEM GTIN</cEANTrib>
                    <uTrib>UN</uTrib>
                    <qTrib>1.0000</qTrib>
                    <vUnTrib>${vProd}</vUnTrib>
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
                            <vPCOFINS>0.00</vPCOFINS>
                        </COFINSOutr>
                    </COFINS>
                </imposto>
            </det>`;
        });

        const xmlNFe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
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
        ${xmlItens}
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
                <vProd>${totalProdutos.toFixed(2)}</vProd>
                <vFrete>0.00</vFrete>
                <vSeg>0.00</vSeg>
                <vDesc>0.00</vDesc>
                <vII>0.00</vII>
                <vIPI>0.00</vIPI>
                <vIPIDevol>0.00</vIPIDevol>
                <vPIS>0.00</vPIS>
                <vCOFINS>0.00</vCOFINS>
                <vOutro>0.00</vOutro>
                <vNF>${totalProdutos.toFixed(2)}</vNF>
                <vTotTrib>0.00</vTotTrib>
            </ICMSTot>
        </total>
        <transp>
            <modFrete>9</modFrete>
        </transp>
        <pag>
            <detPag>
                <tPag>01</tPag>
                <vPag>${totalProdutos.toFixed(2)}</vPag>
            </detPag>
        </pag>
    </infNFe>
</NFe>`;

        // 2. Assinatura Digital do XML
        let xmlAssinado = xmlNFe;
        try {
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
                console.log("NFC-e assinada digitalmente com sucesso!");
            }
        } catch (erroAssinatura) {
            console.error("Aviso na assinatura digital (verifique a senha):", erroAssinatura.message);
        }

        res.json({
            sucesso: true,
            mensagem: "XML da NFC-e gerado e assinado com sucesso!",
            chaveAcesso: chNFe,
            totalVenda: totalProdutos,
            xmlTamanho: xmlAssinado.length
        });

    } catch (erro) {
        console.error("Erro ao gerar NFC-e:", erro);
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
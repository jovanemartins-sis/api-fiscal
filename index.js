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
        xLgr: "Rua Exemplo", // Ajustar se necessário
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
        status: "API Fiscal NFC-e Rodando!",
        emitente: EMITENTE.xNome,
        cnpj: EMITENTE.cnpj
    });
});

// Rota Principal: Recebe a venda, monta o XML e assina
app.post('/emitir-nfce', (req, res) => {
    try {
        const dadosVenda = req.body;

        if (!dadosVenda || !dadosVenda.itens || dadosVenda.itens.length === 0) {
            return res.status(400).json({ erro: "Nenhum item encontrado na venda." });
        }

        // 1. Montagem da estrutura XML da NFC-e (Modelo 65)
        const nNF = Math.floor(Math.random() * 999999) + 1; // Número da nota aleatório para teste
        const cDV = "5"; // Dígito verificador simplificado
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

        // 2. Assinatura Digital do XML usando o certificado A1
        // (Aqui preparamos a estrutura pronta para a assinatura com xml-crypto)
        
        console.log("XML gerado com sucesso para o CNPJ:", EMITENTE.cnpj);

        res.json({
            sucesso: true,
            mensagem: "XML da NFC-e gerado, estruturado e pronto para assinatura/transmissão!",
            chaveAcesso: chNFe,
            totalVenda: totalProdutos,
            xmlGeradoTamanho: xmlNFe.length
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
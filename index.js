const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Rota de Teste / Status
app.get('/', (req, res) => {
    res.json({ status: "API Fiscal Rodando no Render!" });
});

// Rota para receber os dados e preparar a NFC-e
app.post('/emitir-nfce', (req, res) => {
    const dadosVenda = req.body;

    // Validação básica para ver se enviou itens
    if (!dadosVenda || !dadosVenda.itens || dadosVenda.itens.length === 0) {
        return res.status(400).json({ 
            erro: "Nenhum item encontrado na venda. Envie os dados no formato correto." 
        });
    }

    // Por enquanto, vamos apenas simular o recebimento e validação
    console.log("Dados da NFC-e recebidos:", dadosVenda);

    res.json({
        sucesso: true,
        mensagem: "Dados da NFC-e recebidos com sucesso!",
        protocoloSimulado: "987654321012345",
        totalVenda: dadosVenda.total || 0,
        itensRecebidos: dadosVenda.itens.length
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
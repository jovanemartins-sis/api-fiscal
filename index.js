const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
  res.json({ status: 'API Fiscal Rodando no Render!' });
});

app.post('/emitir-nota', (req, res) => {
  const dadosVenda = req.body;
  res.json({ sucesso: true, mensagem: 'Nota processada para teste!', dadosVenda });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
// routes/relatorios.js - Relatórios salvos (gerados a partir de dados reais)
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/relatorios - Lista relatórios salvos (mais recentes primeiro)
router.get('/', (req, res) => {
  try {
    const relatorios = db().prepare(
      'SELECT * FROM relatorios ORDER BY criado_em DESC, id DESC LIMIT 100'
    ).all();
    res.json(relatorios);
  } catch (error) {
    console.error('Erro ao listar relatórios:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/relatorios - Salva um relatório gerado
// Body: { mensagem: string } (texto/JSON serializado do relatório)
router.post('/', (req, res) => {
  const { mensagem } = req.body;

  if (!mensagem || !String(mensagem).trim()) {
    return res.status(400).json({ error: 'O conteúdo do relatório é obrigatório' });
  }

  try {
    const result = db().prepare(
      'INSERT INTO relatorios (mensagem) VALUES (?)'
    ).run(String(mensagem));

    const salvo = db().prepare('SELECT * FROM relatorios WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(salvo);
  } catch (error) {
    console.error('Erro ao salvar relatório:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/relatorios/:id - Apaga um relatório específico
router.delete('/:id', (req, res) => {
  try {
    const conn = db();
    const relatorio = conn.prepare('SELECT * FROM relatorios WHERE id = ?').get(req.params.id);

    if (!relatorio) {
      return res.status(404).json({ error: 'Relatório não encontrado' });
    }

    conn.prepare('DELETE FROM relatorios WHERE id = ?').run(req.params.id);
    res.json({ ok: true, message: 'Relatório apagado com sucesso' });
  } catch (error) {
    console.error('Erro ao apagar relatório:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/relatorios - Apaga todos os relatórios salvos
router.delete('/', (req, res) => {
  try {
    db().prepare('DELETE FROM relatorios').run();
    res.json({ ok: true, message: 'Relatórios apagados com sucesso' });
  } catch (error) {
    console.error('Erro ao apagar relatórios:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
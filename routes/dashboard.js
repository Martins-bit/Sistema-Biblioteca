// routes/dashboard.js - Resumo geral da biblioteca (painel do Dashboard)
// Todos os números vêm de agregações reais do banco — nada mockado.
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/dashboard - Estatísticas resumidas + devoluções recentes
router.get('/', (req, res) => {
  try {
    const conn = db();

    const livrosRow = conn.prepare(`
      SELECT COUNT(*) AS titulos, COALESCE(SUM(acervo), 0) AS exemplares
      FROM livros
    `).get();

    const exemplaresEmprestados = conn.prepare(
      'SELECT COUNT(*) AS c FROM emprestimos WHERE devolvido = 0'
    ).get().c;

    const exemplaresDisponiveis = Math.max(0, (livrosRow.exemplares || 0) - exemplaresEmprestados);

    const alunosTotal = conn.prepare('SELECT COUNT(*) AS c FROM alunos').get().c;

    const emprestimosAtivos = exemplaresEmprestados;

    const hoje = new Date().toISOString().split('T')[0];
    const emprestimosAtrasados = conn.prepare(`
      SELECT COUNT(*) AS c FROM emprestimos
      WHERE devolvido = 0 AND dataLimite IS NOT NULL AND dataLimite < ?
    `).get(hoje).c;

    const devolucoesHoje = conn.prepare(`
      SELECT COUNT(*) AS c FROM emprestimos
      WHERE devolvido = 1 AND dataDevolucao = ?
    `).get(hoje).c;

    // Devoluções recentes (últimas 8, mais atuais primeiro)
    const devolucoesRecentes = conn.prepare(`
      SELECT e.id, e.dataDevolucao, e.dataRetirada, e.dataLimite,
             e.estadoSaida, e.estadoDevolucao,
             a.nome AS alunoNome, a.turma AS alunoTurma,
             l.titulo AS livroTitulo
      FROM emprestimos e
      JOIN alunos a ON e.alunoId = a.id
      JOIN livros l ON e.livroId = l.id
      WHERE e.devolvido = 1
      ORDER BY e.dataDevolucao DESC, e.id DESC
      LIMIT 8
    `).all();

    // Empréstimos em atraso (para o banner de alerta)
    const emprestimosVencidosLista = conn.prepare(`
      SELECT e.id, e.dataRetirada, e.dataLimite,
             a.nome AS alunoNome, a.turma AS alunoTurma,
             l.titulo AS livroTitulo
      FROM emprestimos e
      JOIN alunos a ON e.alunoId = a.id
      JOIN livros l ON e.livroId = l.id
      WHERE e.devolvido = 0 AND e.dataLimite IS NOT NULL AND e.dataLimite < ?
      ORDER BY e.dataLimite ASC
      LIMIT 50
    `).all(hoje);

    res.json({
      livrosTitulos: livrosRow.titulos || 0,
      exemplaresTotal: livrosRow.exemplares || 0,
      exemplaresDisponiveis,
      exemplaresEmprestados,
      alunosTotal,
      emprestimosAtivos,
      emprestimosAtrasados,
      devolucoesHoje,
      devolucoesRecentes,
      emprestimosVencidosLista
    });
  } catch (error) {
    console.error('Erro ao montar dashboard:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
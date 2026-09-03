// routes/alunos.js - Rotas para gerenciamento de alunos
const express = require('express');
const router = express.Router();
const db = require('../db');
const { normalizarTurma, turmaValida } = require('../services/turmas');
const { calcularReputacao, calcularReputacaoTodos } = require('../services/reputacao');
const { verificarSituacao, registrarFimDeBloqueioSeEncerrado } = require('../services/bloqueio');

function situacaoDe(conn, aluno, rep) {
  registrarFimDeBloqueioSeEncerrado(conn, aluno.id, rep.nota);
  return verificarSituacao(conn, aluno.id, rep);
}

// Consulta sem efeito colateral: não cria nem encerra bloqueios
function verificarSituacaoSomenteLeitura(conn, alunoId, rep) {
  const hoje = new Date().toISOString().split('T')[0];
  const ativo = conn.prepare(
    'SELECT * FROM bloqueios WHERE alunoId = ? AND encerrado = 0 AND dataFim >= ? ORDER BY id DESC LIMIT 1'
  ).get(alunoId, hoje);
  if (ativo) {
    const dias = Math.max(0, Math.ceil((new Date(ativo.dataFim + 'T00:00:00') - new Date(hoje + 'T00:00:00')) / 86400000));
    return { bloqueado: true, nota: rep.nota, estrelas: rep.estrelas, situacao: 'Bloqueado temporariamente', dataInicio: ativo.dataInicio, dataFim: ativo.dataFim, diasRestantes: dias, motivo: ativo.motivo };
  }
  let situacao;
  if (rep.nota < 3.0) situacao = 'Bloqueado temporariamente';
  else if (rep.nota >= 4.5) situacao = 'Excelente';
  else if (rep.nota >= 3.5) situacao = 'Boa';
  else situacao = 'Regular';
  return { bloqueado: rep.nota < 3.0, nota: rep.nota, estrelas: rep.estrelas, situacao };
}

// GET /api/alunos - Listar todos os alunos (com reputação/estrelas calculadas)
// Query opcional: ?comReputacao=0 para desativar o cálculo
router.get('/', (req, res) => {
  try {
    const conn = db();
    if (req.query.comReputacao === '0') {
      const alunos = conn.prepare('SELECT * FROM alunos ORDER BY nome').all();
      return res.json(alunos);
    }
    const alunos = calcularReputacaoTodos(conn).map(a => {
      const sit = situacaoDe(conn, a, a);
      return { ...a, situacao: sit.situacao, bloqueado: sit.bloqueado, bloqueioFim: sit.dataFim || null, diasRestantes: sit.diasRestantes ?? null };
    });
    res.json(alunos);
  } catch (error) {
    console.error('Erro ao listar alunos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/alunos/:id/reputacao - Reputação detalhada de um aluno
// Query opcional: ?criarBloqueio=0 para apenas consultar, sem criar bloqueio
router.get('/:id/reputacao', (req, res) => {
  try {
    const conn = db();
    const aluno = conn.prepare('SELECT * FROM alunos WHERE id = ?').get(req.params.id);
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }
    const rep = calcularReputacao(conn, aluno.id);
    const somenteConsulta = req.query.criarBloqueio === '0';
    const sit = somenteConsulta
      ? verificarSituacaoSomenteLeitura(conn, aluno.id, rep)
      : situacaoDe(conn, aluno, rep);
    res.json({ aluno: { id: aluno.id, nome: aluno.nome, turma: aluno.turma }, ...rep, situacao: sit.situacao, bloqueado: sit.bloqueado, bloqueioFim: sit.dataFim || null, diasRestantes: sit.diasRestantes ?? null });
  } catch (error) {
    console.error('Erro ao calcular reputação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/alunos/:id/historico-avaliacao - Histórico de mudanças da nota e bloqueios
router.get('/:id/historico-avaliacao', (req, res) => {
  try {
    const conn = db();
    const aluno = conn.prepare('SELECT * FROM alunos WHERE id = ?').get(req.params.id);
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }
    const eventos = conn.prepare(
      'SELECT * FROM historico_avaliacao WHERE alunoId = ? ORDER BY id DESC LIMIT 100'
    ).all(aluno.id);
    res.json(eventos);
  } catch (error) {
    console.error('Erro ao buscar histórico de avaliação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/alunos - Criar novo aluno
router.post('/', (req, res) => {
  const { nome, turma } = req.body;

  if (!nome || !String(nome).trim()) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  if (!turma || !String(turma).trim()) {
    return res.status(400).json({ error: 'Turma é obrigatória' });
  }
  if (!turmaValida(turma)) {
    return res.status(400).json({
      error: 'Turma inválida. Use uma das opções: 6°A, 6°B, 7°A, 7°B, 8°A, 8°B, 9°A, 9°B, 1°A, 1°B, 2°A, 2°B, 3°A, 3°B'
    });
  }

  try {
    const turmaNormalizada = normalizarTurma(turma);
    const result = db().prepare(
      'INSERT INTO alunos (nome, turma) VALUES (?, ?)'
    ).run(String(nome).trim(), turmaNormalizada);

    const novoAluno = db().prepare('SELECT * FROM alunos WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(novoAluno);
  } catch (error) {
    console.error('Erro ao criar aluno:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/alunos/:id - Atualizar aluno
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { nome, turma } = req.body;

  if (!nome || !String(nome).trim()) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  if (!turma || !String(turma).trim()) {
    return res.status(400).json({ error: 'Turma é obrigatória' });
  }
  if (!turmaValida(turma)) {
    return res.status(400).json({
      error: 'Turma inválida. Use uma das opções: 6°A, 6°B, 7°A, 7°B, 8°A, 8°B, 9°A, 9°B, 1°A, 1°B, 2°A, 2°B, 3°A, 3°B'
    });
  }

  try {
    const conn = db();
    const aluno = conn.prepare('SELECT * FROM alunos WHERE id = ?').get(id);

    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    conn.prepare(
      'UPDATE alunos SET nome = ?, turma = ? WHERE id = ?'
    ).run(String(nome).trim(), normalizarTurma(turma), id);

    const alunoAtualizado = conn.prepare('SELECT * FROM alunos WHERE id = ?').get(id);
    res.json(alunoAtualizado);
  } catch (error) {
    console.error('Erro ao atualizar aluno:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/alunos/:id - Excluir aluno
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const conn = db();
    // Verificar se o aluno tem empréstimos ativos
    const emprestimosAtivos = conn.prepare(
      'SELECT COUNT(*) as count FROM emprestimos WHERE alunoId = ? AND devolvido = 0'
    ).get(id);

    if (emprestimosAtivos.count > 0) {
      return res.status(400).json({
        error: 'Não é possível excluir aluno com empréstimos ativos'
      });
    }

    const aluno = conn.prepare('SELECT * FROM alunos WHERE id = ?').get(id);

    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    // Exclui o histórico concluído do aluno junto com o cadastro
    // (empréstimos ativos já foram bloqueados acima). Feito em transação
    // para evitar violação de chave estrangeira.
    const tx = conn.transaction(() => {
      conn.prepare('DELETE FROM emprestimos WHERE alunoId = ?').run(id);
      conn.prepare('DELETE FROM alunos WHERE id = ?').run(id);
    });
    tx();

    res.json({ message: 'Aluno excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir aluno:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
// routes/emprestimos.js - Rotas para gerenciamento de empréstimos
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/emprestimos - Listar todos os empréstimos
router.get('/', (req, res) => {
  try {
    const emprestimos = db().prepare(`
      SELECT e.*,
             a.nome as alunoNome, a.turma as alunoTurma,
             l.titulo as livroTitulo, l.autor as livroAutor
      FROM emprestimos e
      JOIN alunos a ON e.alunoId = a.id
      JOIN livros l ON e.livroId = l.id
      ORDER BY e.dataRetirada DESC
    `).all();
    res.json(emprestimos);
  } catch (error) {
    console.error('Erro ao listar empréstimos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/emprestimos - Criar novo empréstimo
router.post('/', (req, res) => {
  const { alunoId, livroId, dataRetirada, dataLimite } = req.body;

  if (!alunoId || !livroId || !dataRetirada) {
    return res.status(400).json({ error: 'Aluno, livro e data de retirada são obrigatórios' });
  }

  try {
    // Verificar se o aluno existe
    const aluno = db().prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId);
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    // Verificar se o livro existe
    const livro = db().prepare('SELECT * FROM livros WHERE id = ?').get(livroId);
    if (!livro) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }

    // Verificar se há cópias disponíveis
    const emprestimosAtivos = db().prepare(
      'SELECT COUNT(*) as count FROM emprestimos WHERE livroId = ? AND devolvido = 0'
    ).get(livroId);

    if (emprestimosAtivos.count >= livro.acervo) {
      return res.status(400).json({
        error: 'Não há cópias disponíveis deste livro para empréstimo'
      });
    }

    const result = db().prepare(
      'INSERT INTO emprestimos (alunoId, livroId, dataRetirada, dataLimite, devolvido) VALUES (?, ?, ?, ?, 0)'
    ).run(alunoId, livroId, dataRetirada, dataLimite || null);

    const novoEmprestimo = db().prepare(`
      SELECT e.*,
             a.nome as alunoNome, a.turma as alunoTurma,
             l.titulo as livroTitulo, l.autor as livroAutor
      FROM emprestimos e
      JOIN alunos a ON e.alunoId = a.id
      JOIN livros l ON e.livroId = l.id
      WHERE e.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(novoEmprestimo);
  } catch (error) {
    console.error('Erro ao criar empréstimo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/emprestimos/:id - Devolver livro (marcar como devolvido)
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { dataDevolucao } = req.body;

  try {
    const emprestimo = db().prepare('SELECT * FROM emprestimos WHERE id = ?').get(id);

    if (!emprestimo) {
      return res.status(404).json({ error: 'Empréstimo não encontrado' });
    }

    if (emprestimo.devolvido) {
      return res.status(400).json({ error: 'Este empréstimo já foi devolvido' });
    }

    db().prepare(
      'UPDATE emprestimos SET devolvido = 1, dataDevolucao = ? WHERE id = ?'
    ).run(dataDevolucao || new Date().toISOString().split('T')[0], id);

    const emprestimoAtualizado = db().prepare(`
      SELECT e.*,
             a.nome as alunoNome, a.turma as alunoTurma,
             l.titulo as livroTitulo, l.autor as livroAutor
      FROM emprestimos e
      JOIN alunos a ON e.alunoId = a.id
      JOIN livros l ON e.livroId = l.id
      WHERE e.id = ?
    `).get(id);

    res.json(emprestimoAtualizado);
  } catch (error) {
    console.error('Erro ao devolver livro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/emprestimos/:id - Cancelar empréstimo
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const emprestimo = db().prepare('SELECT * FROM emprestimos WHERE id = ?').get(id);

    if (!emprestimo) {
      return res.status(404).json({ error: 'Empréstimo não encontrado' });
    }

    // Só permitir exclusão se não estiver devolvido (ou seja, ainda ativo)
    // Na prática, talvez não queiramos permitir exclusão de empréstimos históricos
    // Mas para fins de teste, vamos permitir se não estiver devolvido
    if (emprestimo.devolvido) {
      return res.status(400).json({ error: 'Não é possível excluir empréstimo já devolvido' });
    }

    db().prepare('DELETE FROM emprestimos WHERE id = ?').run(id);
    res.json({ message: 'Empréstimo cancelado com sucesso' });
  } catch (error) {
    console.error('Erro ao cancelar empréstimo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
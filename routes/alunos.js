// routes/alunos.js - Rotas para gerenciamento de alunos
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/alunos - Listar todos os alunos
router.get('/', (req, res) => {
  try {
    const alunos = db().prepare('SELECT * FROM alunos ORDER BY nome').all();
    res.json(alunos);
  } catch (error) {
    console.error('Erro ao listar alunos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/alunos - Criar novo aluno
router.post('/', (req, res) => {
  const { nome, turma } = req.body;
  
  if (!nome || !turma) {
    return res.status(400).json({ error: 'Nome e turma são obrigatórios' });
  }
  
  try {
    const result = db().prepare(
      'INSERT INTO alunos (nome, turma) VALUES (?, ?)'
    ).run(nome, turma);
    
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
  
  if (!nome || !turma) {
    return res.status(400).json({ error: 'Nome e turma são obrigatórios' });
  }
  
  try {
    const aluno = db().prepare('SELECT * FROM alunos WHERE id = ?').get(id);
    
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }
    
    db().prepare(
      'UPDATE alunos SET nome = ?, turma = ? WHERE id = ?'
    ).run(nome, turma, id);
    
    const alunoAtualizado = db().prepare('SELECT * FROM alunos WHERE id = ?').get(id);
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
    // Verificar se o aluno tem empréstimos ativos
    const emprestimosAtivos = db().prepare(
      'SELECT COUNT(*) as count FROM emprestimos WHERE alunoId = ? AND devolvido = 0'
    ).get(id);
    
    if (emprestimosAtivos.count > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir aluno com empréstimos ativos' 
      });
    }
    
    const aluno = db().prepare('SELECT * FROM alunos WHERE id = ?').get(id);
    
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }
    
    db().prepare('DELETE FROM alunos WHERE id = ?').run(id);
    res.json({ message: 'Aluno excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir aluno:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
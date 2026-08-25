// routes/livros.js - Rotas para gerenciamento de livros
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/livros - Listar todos os livros
router.get('/', (req, res) => {
  try {
    const livros = db().prepare('SELECT * FROM livros ORDER BY titulo').all();
    res.json(livros);
  } catch (error) {
    console.error('Erro ao listar livros:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/livros - Criar novo livro
router.post('/', (req, res) => {
  const { titulo, autor, categoria, acervo } = req.body;
  
  if (!titulo || !autor || !categoria) {
    return res.status(400).json({ error: 'Título, autor e categoria são obrigatórios' });
  }
  
  try {
    const result = db().prepare(
      'INSERT INTO livros (titulo, autor, categoria, acervo) VALUES (?, ?, ?, ?)'
    ).run(titulo, autor, categoria, acervo || 1);
    
    const novoLivro = db().prepare('SELECT * FROM livros WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(novoLivro);
  } catch (error) {
    console.error('Erro ao criar livro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/livros/:id - Atualizar livro
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { titulo, autor, categoria, acervo } = req.body;
  
  if (!titulo || !autor || !categoria) {
    return res.status(400).json({ error: 'Título, autor e categoria são obrigatórios' });
  }
  
  try {
    const livro = db().prepare('SELECT * FROM livros WHERE id = ?').get(id);
    
    if (!livro) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }
    
    db().prepare(
      'UPDATE livros SET titulo = ?, autor = ?, categoria = ?, acervo = ? WHERE id = ?'
    ).run(titulo, autor, categoria, acervo || 1, id);
    
    const livroAtualizado = db().prepare('SELECT * FROM livros WHERE id = ?').get(id);
    res.json(livroAtualizado);
  } catch (error) {
    console.error('Erro ao atualizar livro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/livros/:id - Excluir livro
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    // Verificar se o livro tem empréstimos ativos
    const emprestimosAtivos = db().prepare(
      'SELECT COUNT(*) as count FROM emprestimos WHERE livroId = ? AND devolvido = 0'
    ).get(id);
    
    if (emprestimosAtivos.count > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir livro com empréstimos ativos' 
      });
    }
    
    const livro = db().prepare('SELECT * FROM livros WHERE id = ?').get(id);
    
    if (!livro) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }
    
    db().prepare('DELETE FROM livros WHERE id = ?').run(id);
    res.json({ message: 'Livro excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir livro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
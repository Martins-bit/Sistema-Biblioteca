// routes/livros.js - Rotas para gerenciamento de livros
const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * Valida a URL da capa (opcional).
 * Aceita http(s)://, data:image (upload em base64) ou caminho local /...
 */
function capaValida(capaUrl) {
  if (!capaUrl) return true; // opcional
  const s = String(capaUrl).trim();
  if (!s) return true;
  if (s.length > 500000) return false; // evita payloads gigantes (dataURL)
  return (
    /^https?:\/\//i.test(s) ||
    /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(s) ||
    /^\//.test(s)
  );
}

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

// GET /api/livros/:id - Detalhes de um livro
router.get('/:id', (req, res) => {
  try {
    const livro = db().prepare('SELECT * FROM livros WHERE id = ?').get(req.params.id);
    if (!livro) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }
    res.json(livro);
  } catch (error) {
    console.error('Erro ao buscar livro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/livros - Criar novo livro
router.post('/', (req, res) => {
  const { titulo, autor, categoria, acervo, capaUrl } = req.body;

  if (!titulo || !autor || !categoria) {
    return res.status(400).json({ error: 'Título, autor e categoria são obrigatórios' });
  }
  if (!capaValida(capaUrl)) {
    return res.status(400).json({ error: 'URL da capa inválida' });
  }

  try {
    const result = db().prepare(
      'INSERT INTO livros (titulo, autor, categoria, acervo, capaUrl) VALUES (?, ?, ?, ?, ?)'
    ).run(
      String(titulo).trim(),
      String(autor).trim(),
      String(categoria).trim(),
      Math.max(1, parseInt(acervo, 10) || 1),
      capaUrl ? String(capaUrl).trim() : null
    );

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
  const { titulo, autor, categoria, acervo, capaUrl } = req.body;

  if (!titulo || !autor || !categoria) {
    return res.status(400).json({ error: 'Título, autor e categoria são obrigatórios' });
  }
  if (!capaValida(capaUrl)) {
    return res.status(400).json({ error: 'URL da capa inválida' });
  }

  try {
    const conn = db();
    const livro = conn.prepare('SELECT * FROM livros WHERE id = ?').get(id);

    if (!livro) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }

    conn.prepare(
      'UPDATE livros SET titulo = ?, autor = ?, categoria = ?, acervo = ?, capaUrl = ? WHERE id = ?'
    ).run(
      String(titulo).trim(),
      String(autor).trim(),
      String(categoria).trim(),
      Math.max(1, parseInt(acervo, 10) || 1),
      capaUrl ? String(capaUrl).trim() : null,
      id
    );

    const livroAtualizado = conn.prepare('SELECT * FROM livros WHERE id = ?').get(id);
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
    const conn = db();
    // Verificar se o livro tem empréstimos ativos
    const emprestimosAtivos = conn.prepare(
      'SELECT COUNT(*) as count FROM emprestimos WHERE livroId = ? AND devolvido = 0'
    ).get(id);

    if (emprestimosAtivos.count > 0) {
      return res.status(400).json({
        error: 'Não é possível excluir livro com empréstimos ativos'
      });
    }

    const livro = conn.prepare('SELECT * FROM livros WHERE id = ?').get(id);

    if (!livro) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }

    // Exclui o histórico concluído do livro junto com o cadastro
    // (empréstimos ativos já foram bloqueados acima). Feito em transação
    // para evitar violação de chave estrangeira.
    const tx = conn.transaction(() => {
      conn.prepare('DELETE FROM emprestimos WHERE livroId = ?').run(id);
      conn.prepare('DELETE FROM livros WHERE id = ?').run(id);
    });
    tx();

    res.json({ message: 'Livro excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir livro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
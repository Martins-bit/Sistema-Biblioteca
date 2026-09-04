// routes/backup.js - Exportação, importação e limpeza completa dos dados
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/backup - Exporta todos os dados (alunos, livros, empréstimos, relatórios)
router.get('/', (req, res) => {
  try {
    const conn = db();
    res.json({
      exportadoEm: new Date().toISOString(),
      alunos: conn.prepare('SELECT * FROM alunos').all(),
      livros: conn.prepare('SELECT * FROM livros').all(),
      emprestimos: conn.prepare('SELECT * FROM emprestimos').all(),
      relatorios: conn.prepare('SELECT * FROM relatorios').all()
    });
  } catch (error) {
    console.error('Erro ao exportar backup:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/backup - Importa/restaura dados de um backup JSON
// Body: { alunos: [], livros: [], emprestimos: [], relatorios: [] }
// Estratégia: insere registros que não conflitam; mapeia IDs antigos -> novos
// para manter a integridade dos empréstimos.
router.post('/', (req, res) => {
  const { alunos, livros, emprestimos, relatorios } = req.body || {};

  if (!Array.isArray(alunos) && !Array.isArray(livros) && !Array.isArray(emprestimos)) {
    return res.status(400).json({ error: 'Backup inválido: nenhuma lista de dados encontrada' });
  }

  try {
    const conn = db();
    const mapaAlunos = new Map(); // idAntigo -> idNovo
    const mapaLivros = new Map();

    const inserirAluno = conn.prepare('INSERT INTO alunos (nome, turma) VALUES (?, ?)');
    const inserirLivro = conn.prepare('INSERT INTO livros (titulo, autor, categoria, acervo, capaUrl) VALUES (?, ?, ?, ?, ?)');
    const inserirEmprestimo = conn.prepare(`
      INSERT INTO emprestimos (alunoId, livroId, dataRetirada, dataLimite, devolvido, dataDevolucao,
                               estadoSaida, obsSaida, estadoDevolucao, obsDevolucao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const inserirRelatorio = conn.prepare('INSERT INTO relatorios (mensagem) VALUES (?)');

    const contarAlunos = conn.prepare('SELECT COUNT(*) AS c FROM alunos WHERE nome = ? AND turma = ?');
    const contarLivros = conn.prepare('SELECT COUNT(*) AS c FROM livros WHERE titulo = ? AND autor = ?');

    let inseridos = { alunos: 0, livros: 0, emprestimos: 0, relatorios: 0 };
    let ignorados = { alunos: 0, livros: 0 };

    const tx = conn.transaction(() => {
      (Array.isArray(alunos) ? alunos : []).forEach(a => {
        if (!a || !a.nome || !a.turma) return;
        // Evita duplicar alunos idênticos já existentes
        if (contarAlunos.get(a.nome, a.turma).c > 0) { ignorados.alunos++; return; }
        const r = inserirAluno.run(a.nome, a.turma);
        mapaAlunos.set(a.id, Number(r.lastInsertRowid));
        inseridos.alunos++;
      });

      (Array.isArray(livros) ? livros : []).forEach(l => {
        if (!l || !l.titulo || !l.autor || !l.categoria) return;
        if (contarLivros.get(l.titulo, l.autor).c > 0) { ignorados.livros++; return; }
        const r = inserirLivro.run(l.titulo, l.autor, l.categoria, l.acervo || 1, l.capaUrl || null);
        mapaLivros.set(l.id, Number(r.lastInsertRowid));
        inseridos.livros++;
      });

      (Array.isArray(emprestimos) ? emprestimos : []).forEach(e => {
        if (!e) return;
        const alunoNovo = mapaAlunos.has(e.alunoId)
          ? mapaAlunos.get(e.alunoId)
          : (conn.prepare('SELECT id FROM alunos WHERE id = ?').get(e.alunoId)?.id);
        const livroNovo = mapaLivros.has(e.livroId)
          ? mapaLivros.get(e.livroId)
          : (conn.prepare('SELECT id FROM livros WHERE id = ?').get(e.livroId)?.id);
        if (!alunoNovo || !livroNovo) return; // referência quebrada no backup
        inserirEmprestimo.run(
          alunoNovo, livroNovo,
          e.dataRetirada || new Date().toISOString().split('T')[0],
          e.dataLimite || null,
          e.devolvido ? 1 : 0,
          e.devolvido ? (e.dataDevolucao || null) : null,
          e.estadoSaida || null,
          e.obsSaida || null,
          e.estadoDevolucao || null,
          e.obsDevolucao || null
        );
        inseridos.emprestimos++;
      });

      (Array.isArray(relatorios) ? relatorios : []).forEach(r => {
        if (!r || !r.mensagem) return;
        inserirRelatorio.run(r.mensagem);
        inseridos.relatorios++;
      });
    });

    tx();

    res.json({ ok: true, inseridos, ignorados });
  } catch (error) {
    console.error('Erro ao importar backup:', error);
    res.status(500).json({ error: 'Erro interno do servidor ao importar backup' });
  }
});

// DELETE /api/backup - Apaga TODOS os dados (alunos, livros, empréstimos, relatórios)
router.delete('/', (req, res) => {
  try {
    const conn = db();
    const tx = conn.transaction(() => {
      conn.prepare('DELETE FROM emprestimos').run();
      conn.prepare('DELETE FROM bloqueios').run();
      conn.prepare('DELETE FROM historico_avaliacao').run();
      conn.prepare('DELETE FROM alunos').run();
      conn.prepare('DELETE FROM livros').run();
      conn.prepare('DELETE FROM relatorios').run();
    });
    tx();
    res.json({ ok: true, message: 'Todos os dados foram apagados' });
  } catch (error) {
    console.error('Erro ao apagar dados:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
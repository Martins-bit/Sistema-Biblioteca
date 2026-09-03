// routes/emprestimos.js - Rotas para gerenciamento de empréstimos
// Inclui registro do estado de conservação do livro na saída e na devolução.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { ESTADOS_CONSERVACAO, calcularReputacao, notaParaEstrelas } = require('../services/reputacao');
const { verificarSituacao, registrarHistorico, registrarFimDeBloqueioSeEncerrado } = require('../services/bloqueio');

const SELECT_EMPRESTIMO_COMPLETO = `
  SELECT e.*,
         a.nome as alunoNome, a.turma as alunoTurma,
         l.titulo as livroTitulo, l.autor as livroAutor, l.categoria as livroCategoria
  FROM emprestimos e
  JOIN alunos a ON e.alunoId = a.id
  JOIN livros l ON e.livroId = l.id
`;

// Valida estado de conservação (opcional; se informado deve ser um dos permitidos)
function estadoValido(estado) {
  if (estado === undefined || estado === null || estado === '') return { ok: true, valor: null };
  const s = String(estado).trim();
  if (ESTADOS_CONSERVACAO.includes(s)) return { ok: true, valor: s };
  return { ok: false };
}

// GET /api/emprestimos - Listar todos os empréstimos (com dados de conservação)
router.get('/', (req, res) => {
  try {
    const emprestimos = db().prepare(`
      ${SELECT_EMPRESTIMO_COMPLETO}
      ORDER BY e.devolvido ASC, e.dataRetirada DESC, e.id DESC
    `).all();
    res.json(emprestimos);
  } catch (error) {
    console.error('Erro ao listar empréstimos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/emprestimos/:id - Histórico/detalhes completos de um empréstimo
router.get('/:id', (req, res) => {
  try {
    const emprestimo = db().prepare(`
      ${SELECT_EMPRESTIMO_COMPLETO}
      WHERE e.id = ?
    `).get(req.params.id);

    if (!emprestimo) {
      return res.status(404).json({ error: 'Empréstimo não encontrado' });
    }
    res.json(emprestimo);
  } catch (error) {
    console.error('Erro ao buscar empréstimo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/emprestimos - Criar novo empréstimo
// Body: { alunoId, livroId, dataRetirada, dataLimite, estadoSaida?, obsSaida? }
router.post('/', (req, res) => {
  const { alunoId, livroId, dataRetirada, dataLimite, estadoSaida, obsSaida } = req.body;

  if (!alunoId || !livroId || !dataRetirada) {
    return res.status(400).json({ error: 'Aluno, livro e data de retirada são obrigatórios' });
  }

  const checkEstado = estadoValido(estadoSaida);
  if (!checkEstado.ok) {
    return res.status(400).json({
      error: 'Estado de conservação inválido. Use: Novo, Ótimo, Bom, Regular ou Danificado'
    });
  }

  try {
    const conn = db();
    // Verificar se o aluno existe
    const aluno = conn.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId);
    if (!aluno) {
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }

    // Verificar se o livro existe
    const livro = conn.prepare('SELECT * FROM livros WHERE id = ?').get(livroId);
    if (!livro) {
      return res.status(404).json({ error: 'Livro não encontrado' });
    }

    // Verificar se há cópias disponíveis
    const emprestimosAtivos = conn.prepare(
      'SELECT COUNT(*) as count FROM emprestimos WHERE livroId = ? AND devolvido = 0'
    ).get(livroId);

    if (emprestimosAtivos.count >= livro.acervo) {
      return res.status(400).json({
        error: 'Não há cópias disponíveis deste livro para empréstimo'
      });
    }

    // ==== REGRA DE BLOQUEIO: aluno com avaliação < 3,0 fica impedido de novos empréstimos ====
    // Validada aqui no backend — mesmo chamando a API diretamente, o empréstimo é recusado.
    const rep = calcularReputacao(conn, alunoId);
    registrarFimDeBloqueioSeEncerrado(conn, alunoId, rep.nota);
    const situacao = verificarSituacao(conn, alunoId, rep);
    if (situacao.bloqueado) {
      const dataFimFmt = String(situacao.dataFim).split('-').reverse().join('/');
      return res.status(403).json({
        error: `Aluno temporariamente bloqueado. Avaliação: ${rep.estrelas} ${rep.nota.toFixed(1).replace('.', ',')}. Novo empréstimo disponível em ${dataFimFmt} (faltam ${situacao.diasRestantes} dia(s)).`,
        bloqueio: situacao
      });
    }

    const result = conn.prepare(`
      INSERT INTO emprestimos (alunoId, livroId, dataRetirada, dataLimite, devolvido,
                               estadoSaida, obsSaida)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(
      alunoId, livroId, dataRetirada, dataLimite || null,
      checkEstado.valor,
      obsSaida ? String(obsSaida).trim() || null : null
    );

    const novoEmprestimo = conn.prepare(`
      ${SELECT_EMPRESTIMO_COMPLETO}
      WHERE e.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(novoEmprestimo);
  } catch (error) {
    console.error('Erro ao criar empréstimo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/emprestimos/:id - Devolver livro
// Body: { dataDevolucao?, estadoDevolucao?, obsDevolucao? }
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { dataDevolucao, estadoDevolucao, obsDevolucao } = req.body;

  const checkEstado = estadoValido(estadoDevolucao);
  if (!checkEstado.ok) {
    return res.status(400).json({
      error: 'Estado de conservação inválido. Use: Novo, Ótimo, Bom, Regular ou Danificado'
    });
  }

  try {
    const conn = db();
    const emprestimo = conn.prepare('SELECT * FROM emprestimos WHERE id = ?').get(id);

    if (!emprestimo) {
      return res.status(404).json({ error: 'Empréstimo não encontrado' });
    }

    if (emprestimo.devolvido) {
      return res.status(400).json({ error: 'Este empréstimo já foi devolvido' });
    }

    const notaAnterior = calcularReputacao(conn, emprestimo.alunoId).nota;

    conn.prepare(`
      UPDATE emprestimos
      SET devolvido = 1,
          dataDevolucao = ?,
          estadoDevolucao = ?,
          obsDevolucao = ?
      WHERE id = ?
    `).run(
      dataDevolucao || new Date().toISOString().split('T')[0],
      checkEstado.valor,
      obsDevolucao ? String(obsDevolucao).trim() || null : null,
      id
    );

    // ==== Histórico da avaliação: explica por que a nota mudou ====
    const repDepois = calcularReputacao(conn, emprestimo.alunoId);
    registrarFimDeBloqueioSeEncerrado(conn, emprestimo.alunoId, repDepois.nota);

    const limite = emprestimo.dataLimite ? String(emprestimo.dataLimite).slice(0, 10) : null;
    const devolucao = String(dataDevolucao || new Date().toISOString().split('T')[0]).slice(0, 10);
    const fmt = (iso) => iso.split('-').reverse().join('/');

    if (limite) {
      if (devolucao <= limite) {
        registrarHistorico(conn, emprestimo.alunoId, 'devolucao_prazo',
          `Devolvido ${devolucao < limite ? 'antes do prazo' : 'no prazo'} (limite ${fmt(limite)}).`, notaAnterior, repDepois.nota);
      } else {
        const dias = Math.ceil((new Date(devolucao + 'T00:00:00') - new Date(limite + 'T00:00:00')) / 86400000);
        registrarHistorico(conn, emprestimo.alunoId, 'devolucao_atrasada',
          `Atraso de ${dias} dia(s) (limite ${fmt(limite)}, devolvido em ${fmt(devolucao)}).`, notaAnterior, repDepois.nota);
      }
    }

    if (checkEstado.valor && emprestimo.estadoSaida) {
      const ordem = { 'Danificado': 1, 'Regular': 2, 'Bom': 3, 'Ótimo': 4, 'Novo': 5 };
      if (ordem[checkEstado.valor] < ordem[emprestimo.estadoSaida]) {
        registrarHistorico(conn, emprestimo.alunoId, 'estado_piorou',
          `Estado do livro piorou: saída "${emprestimo.estadoSaida}" → devolução "${checkEstado.valor}".`,
          notaAnterior, repDepois.nota);
      } else {
        registrarHistorico(conn, emprestimo.alunoId, 'estado_ok',
          `Livro devolvido no mesmo estado da saída ("${checkEstado.valor}").`, notaAnterior, repDepois.nota);
      }
    }
    registrarHistorico(conn, emprestimo.alunoId, 'nota_atualizada',
      `Nota atualizada para ${repDepois.nota.toFixed(1).replace('.', ',')} ${repDepois.estrelas}.`, notaAnterior, repDepois.nota);

    // Verifica se a devolução derrubou a nota abaixo de 3,0 e inicia novo bloqueio se necessário
    const situacao = verificarSituacao(conn, emprestimo.alunoId, repDepois);

    const emprestimoAtualizado = conn.prepare(`
      ${SELECT_EMPRESTIMO_COMPLETO}
      WHERE e.id = ?
    `).get(id);

    res.json({ ...emprestimoAtualizado, situacaoAluno: situacao });
  } catch (error) {
    console.error('Erro ao devolver livro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/emprestimos/:id - Cancelar empréstimo
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const conn = db();
    const emprestimo = conn.prepare('SELECT * FROM emprestimos WHERE id = ?').get(id);

    if (!emprestimo) {
      return res.status(404).json({ error: 'Empréstimo não encontrado' });
    }

    // Só permitir exclusão se não estiver devolvido (ou seja, ainda ativo)
    if (emprestimo.devolvido) {
      return res.status(400).json({ error: 'Não é possível excluir empréstimo já devolvido' });
    }

    conn.prepare('DELETE FROM emprestimos WHERE id = ?').run(id);
    res.json({ message: 'Empréstimo cancelado com sucesso' });
  } catch (error) {
    console.error('Erro ao cancelar empréstimo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
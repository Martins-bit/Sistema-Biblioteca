// routes/ranking.js - Rankings reais de alunos e salas/turmas
// Fontes: tabela de empréstimos + serviço de reputação (estrelas).
// Nenhum número fixo/mockado.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { normalizarTurma } = require('../services/turmas');
const { calcularReputacaoTodos } = require('../services/reputacao');

/**
 * Constrói o filtro SQL de período sobre dataRetirada.
 * periodo: geral | mes | ano | personalizado (usa de/ate)
 */
function filtroPeriodo(query) {
  const { periodo, de, ate } = query;
  const cond = [];
  const params = [];

  if (periodo === 'mes') {
    cond.push(`strftime('%Y-%m', e.dataRetirada) = strftime('%Y-%m', 'now')`);
  } else if (periodo === 'ano') {
    cond.push(`strftime('%Y', e.dataRetirada) = strftime('%Y', 'now')`);
  } else if (periodo === 'personalizado') {
    if (de) { cond.push('e.dataRetirada >= ?'); params.push(de); }
    if (ate) { cond.push('e.dataRetirada <= ?'); params.push(ate); }
  }
  // 'geral' (padrão): sem filtro

  return { where: cond.length ? `AND ${cond.join(' AND ')}` : '', params };
}

// GET /api/ranking/alunos?periodo=geral|mes|ano|personalizado&de=&ate=
// Retorna duas listas: "leitores" (mais empréstimos) e "reputacao" (melhores estrelas)
router.get('/alunos', (req, res) => {
  try {
    const conn = db();
    const { where, params } = filtroPeriodo(req.query);

    // Estatísticas por aluno dentro do período selecionado
    const stats = conn.prepare(`
      SELECT e.alunoId,
             COUNT(*) AS totalEmprestimos,
             SUM(CASE WHEN e.devolvido = 1 THEN 1 ELSE 0 END) AS devolvidos,
             SUM(CASE WHEN e.devolvido = 1 AND e.dataLimite IS NOT NULL
                       AND e.dataDevolucao > e.dataLimite THEN 1 ELSE 0 END) AS atrasos,
             SUM(CASE WHEN e.devolvido = 1 AND (e.dataLimite IS NULL
                       OR e.dataDevolucao <= e.dataLimite) THEN 1 ELSE 0 END) AS noPrazo
      FROM emprestimos e
      WHERE 1 = 1 ${where}
      GROUP BY e.alunoId
    `).all(...params);

    const statsMap = new Map(stats.map(s => [s.alunoId, s]));

    // Reputação calculada pelo serviço centralizado (histórico completo)
    const alunosComRep = calcularReputacaoTodos(conn);

    const leitores = alunosComRep
      .map(a => {
        const s = statsMap.get(a.id) || {
          totalEmprestimos: 0, devolvidos: 0, atrasos: 0, noPrazo: 0
        };
        return {
          alunoId: a.id,
          nome: a.nome,
          turma: a.turma,
          totalEmprestimos: s.totalEmprestimos || 0,
          devolvidos: s.devolvidos || 0,
          atrasos: s.atrasos || 0,
          noPrazo: s.noPrazo || 0,
          nota: a.nota,
          estrelas: a.estrelas
        };
      })
      .filter(a => a.totalEmprestimos > 0)
      .sort((a, b) =>
        b.totalEmprestimos - a.totalEmprestimos ||
        a.atrasos - b.atrasos ||
        a.nome.localeCompare(b.nome, 'pt-BR')
      )
      .map((a, i) => ({ ...a, posicao: i + 1 }));

    // Melhor reputação: ordena por nota; desempate por volume de empréstimos
    // concluídos (evita favorecer quem pegou apenas 1 livro) e menos atrasos.
    const reputacao = alunosComRep
      .map(a => {
        const s = statsMap.get(a.id) || {
          totalEmprestimos: 0, devolvidos: 0, atrasos: 0, noPrazo: 0
        };
        return {
          alunoId: a.id,
          nome: a.nome,
          turma: a.turma,
          totalEmprestimos: s.totalEmprestimos || 0,
          devolvidos: s.devolvidos || 0,
          atrasos: s.atrasos || 0,
          noPrazo: s.noPrazo || 0,
          nota: a.nota,
          estrelas: a.estrelas
        };
      })
      .filter(a => a.totalEmprestimos > 0)
      .sort((a, b) =>
        b.nota - a.nota ||
        b.devolvidos - a.devolvidos ||
        a.atrasos - b.atrasos ||
        a.nome.localeCompare(b.nome, 'pt-BR')
      )
      .map((a, i) => ({ ...a, posicao: i + 1 }));

    res.json({ leitores, reputacao });
  } catch (error) {
    console.error('Erro ao gerar ranking de alunos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /api/ranking/salas?periodo=geral|mes|ano|personalizado&de=&ate=
// Ranking das salas/turmas que mais pegaram livros emprestados
router.get('/salas', (req, res) => {
  try {
    const conn = db();
    const { where, params } = filtroPeriodo(req.query);

    const rows = conn.prepare(`
      SELECT a.turma AS turmaBruta,
             COUNT(*) AS totalEmprestimos,
             COUNT(DISTINCT e.alunoId) AS alunosParticipantes,
             SUM(CASE WHEN e.devolvido = 1 THEN 1 ELSE 0 END) AS devolvidos,
             SUM(CASE WHEN e.devolvido = 1 AND (e.dataLimite IS NULL
                       OR e.dataDevolucao <= e.dataLimite) THEN 1 ELSE 0 END) AS devolvidosNoPrazo,
             SUM(CASE WHEN e.devolvido = 1 AND e.dataLimite IS NOT NULL
                       AND e.dataDevolucao > e.dataLimite THEN 1 ELSE 0 END) AS devolvidosAtrasados
      FROM emprestimos e
      JOIN alunos a ON e.alunoId = a.id
      WHERE 1 = 1 ${where}
      GROUP BY a.turma
      ORDER BY totalEmprestimos DESC
    `).all(...params);

    // Agrupa turmas com grafias diferentes no mesmo rótulo canônico
    const salasMap = new Map();
    for (const r of rows) {
      const turma = normalizarTurma(r.turmaBruta) || r.turmaBruta;
      const atual = salasMap.get(turma) || {
        turma,
        totalEmprestimos: 0,
        alunosParticipantes: 0,
        devolvidos: 0,
        devolvidosNoPrazo: 0,
        devolvidosAtrasados: 0
      };
      atual.totalEmprestimos += r.totalEmprestimos;
      atual.devolvidos += r.devolvidos || 0;
      atual.devolvidosNoPrazo += r.devolvidosNoPrazo || 0;
      atual.devolvidosAtrasados += r.devolvidosAtrasados || 0;
      salasMap.set(turma, atual);
    }

    // alunosParticipantes precisa ser recalculado por turma canônica (DISTINCT aluno)
    const alunosPorTurma = conn.prepare(`
      SELECT a.turma AS turmaBruta, COUNT(DISTINCT e.alunoId) AS alunos
      FROM emprestimos e
      JOIN alunos a ON e.alunoId = a.id
      WHERE 1 = 1 ${where}
      GROUP BY a.turma
    `).all(...params);
    const participantesMap = new Map();
    for (const r of alunosPorTurma) {
      const turma = normalizarTurma(r.turmaBruta) || r.turmaBruta;
      participantesMap.set(turma, (participantesMap.get(turma) || 0) + r.alunos);
    }
    for (const [turma, sala] of salasMap) {
      sala.alunosParticipantes = participantesMap.get(turma) || 0;
    }

    const salas = [...salasMap.values()]
      .sort((a, b) =>
        b.totalEmprestimos - a.totalEmprestimos ||
        b.alunosParticipantes - a.alunosParticipantes ||
        a.turma.localeCompare(b.turma, 'pt-BR')
      )
      .map((s, i) => ({ ...s, posicao: i + 1 }));

    res.json({ salas });
  } catch (error) {
    console.error('Erro ao gerar ranking de salas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
// routes/estatisticas.js - Estatísticas agregadas para Relatórios (dados reais do banco)
const express = require('express');
const router = express.Router();
const db = require('../db');

const NIVEL_CONSERVACAO = { 'Novo': 5, 'Ótimo': 4, 'Bom': 3, 'Regular': 2, 'Danificado': 1 };

function calcPeriodo(periodo, de, ate) {
  const hoje = new Date().toISOString().split('T')[0];
  if (periodo === 'hoje') return { de: hoje, ate: hoje };
  if (periodo === '7d') {
    const d = new Date(); d.setDate(d.getDate() - 6);
    return { de: d.toISOString().split('T')[0], ate: hoje };
  }
  if (periodo === '30d') {
    const d = new Date(); d.setDate(d.getDate() - 29);
    return { de: d.toISOString().split('T')[0], ate: hoje };
  }
  if (periodo === 'mes') {
    const h = hoje.slice(0, 7);
    return { de: h + '-01', ate: hoje };
  }
  if (periodo === 'ano') {
    return { de: hoje.slice(0, 4) + '-01-01', ate: hoje };
  }
  if (periodo === 'personalizado') return { de: de || null, ate: ate || null };
  return { de: null, ate: null }; // geral
}

// GET /api/estatisticas?periodo=&de=&ate=
router.get('/', (req, res) => {
  try {
    const conn = db();
    const { periodo = 'geral', de, ate } = req.query;
    const p = calcPeriodo(periodo, de, ate);

    const whereEmp = [];
    const argsEmp = [];
    if (p.de) { whereEmp.push('e.dataRetirada >= ?'); argsEmp.push(p.de); }
    if (p.ate) { whereEmp.push('e.dataRetirada <= ?'); argsEmp.push(p.ate); }
    const whereSql = whereEmp.length ? 'WHERE ' + whereEmp.join(' AND ') : '';

    // ---- Acervo (global, independente do período) ----
    const acervo = conn.prepare(`
      SELECT COUNT(*) AS titulos, COALESCE(SUM(acervo),0) AS exemplares FROM livros
    `).get();
    const emprestados = conn.prepare('SELECT COUNT(*) AS c FROM emprestimos WHERE devolvido = 0').get().c;

    // ---- Empréstimos no período ----
    const resumo = conn.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN devolvido = 1 THEN 1 ELSE 0 END) AS devolvidos,
             SUM(CASE WHEN devolvido = 0 THEN 1 ELSE 0 END) AS ativos
      FROM emprestimos e ${whereSql}
    `).get(...argsEmp);

    const hoje = new Date().toISOString().split('T')[0];
    const atrasadosAtivos = conn.prepare(`
      SELECT COUNT(*) AS c FROM emprestimos e
      ${whereSql ? whereSql + ' AND ' : 'WHERE '} e.devolvido = 0 AND e.dataLimite IS NOT NULL AND e.dataLimite < ?
    `).get(...argsEmp, hoje).c;
    const atrasadosDevolvidos = conn.prepare(`
      SELECT COUNT(*) AS c FROM emprestimos e
      ${whereSql ? whereSql + ' AND ' : 'WHERE '} e.devolvido = 1 AND e.dataDevolucao IS NOT NULL AND e.dataLimite IS NOT NULL AND e.dataDevolucao > e.dataLimite
    `).get(...argsEmp).c;
    const noPrazo = conn.prepare(`
      SELECT COUNT(*) AS c FROM emprestimos e
      ${whereSql ? whereSql + ' AND ' : 'WHERE '} e.devolvido = 1 AND (e.dataLimite IS NULL OR e.dataDevolucao IS NULL OR e.dataDevolucao <= e.dataLimite)
    `).get(...argsEmp).c;

    // ---- Deteriorações no período ----
    const deterioracoes = conn.prepare(`
      SELECT COUNT(*) AS c FROM emprestimos e
      ${whereSql ? whereSql + ' AND ' : 'WHERE '}
        e.estadoSaida IS NOT NULL AND e.estadoDevolucao IS NOT NULL
        AND (CASE e.estadoSaida WHEN 'Novo' THEN 5 WHEN 'Ótimo' THEN 4 WHEN 'Bom' THEN 3 WHEN 'Regular' THEN 2 WHEN 'Danificado' THEN 1 ELSE 0 END)
          > (CASE e.estadoDevolucao WHEN 'Novo' THEN 5 WHEN 'Ótimo' THEN 4 WHEN 'Bom' THEN 3 WHEN 'Regular' THEN 2 WHEN 'Danificado' THEN 1 ELSE 0 END)
    `).get(...argsEmp).c;

    // ---- Livros mais emprestados (no período) ----
    const maisEmprestados = conn.prepare(`
      SELECT l.id, l.titulo, l.autor, COUNT(e.id) AS total
      FROM emprestimos e JOIN livros l ON e.livroId = l.id
      ${whereSql}
      GROUP BY e.livroId ORDER BY total DESC, l.titulo ASC LIMIT 10
    `).all(...argsEmp);

    // ---- Alunos que mais pegaram ----
    const topAlunos = conn.prepare(`
      SELECT a.id, a.nome, a.turma, COUNT(e.id) AS total,
             SUM(CASE WHEN e.devolvido = 0 THEN 1 ELSE 0 END) AS ativos
      FROM emprestimos e JOIN alunos a ON e.alunoId = a.id
      ${whereSql}
      GROUP BY e.alunoId ORDER BY total DESC, a.nome ASC LIMIT 10
    `).all(...argsEmp);

    // ---- Salas que mais pegaram ----
    const topSalas = conn.prepare(`
      SELECT a.turma AS sala, COUNT(e.id) AS total
      FROM emprestimos e JOIN alunos a ON e.alunoId = a.id
      ${whereSql}
      GROUP BY a.turma ORDER BY total DESC, a.turma ASC LIMIT 10
    `).all(...argsEmp);

    // ---- Empréstimos por mês (últimos 6 meses dentro do período) ----
    const porMes = conn.prepare(`
      SELECT substr(e.dataRetirada, 1, 7) AS mes, COUNT(*) AS total
      FROM emprestimos e ${whereSql}
      GROUP BY mes ORDER BY mes ASC
    `).all(...argsEmp);

    // ---- Média de empréstimos por dia do período ----
    let mediaDia = 0;
    if (p.de && p.ate) {
      const dias = Math.max(1, Math.round((new Date(p.ate + 'T00:00:00') - new Date(p.de + 'T00:00:00')) / 86400000) + 1);
      mediaDia = Math.round(((resumo.total || 0) / dias) * 100) / 100;
    }

    // ---- Totais globais auxiliares ----
    const alunosTotal = conn.prepare('SELECT COUNT(*) AS c FROM alunos').get().c;
    const devolucoesTotais = conn.prepare('SELECT COUNT(*) AS c FROM emprestimos WHERE devolvido = 1').get().c;

    res.json({
      periodo: { tipo: periodo, de: p.de, ate: p.ate },
      acervo: {
        titulos: acervo.titulos || 0,
        exemplares: acervo.exemplares || 0,
        disponiveis: Math.max(0, (acervo.exemplares || 0) - emprestados),
        emprestados
      },
      alunosTotal,
      devolucoesTotais,
      emprestimos: {
        total: resumo.total || 0,
        devolvidos: resumo.devolvidos || 0,
        ativos: resumo.ativos || 0,
        atrasados: atrasadosAtivos + atrasadosDevolvidos,
        noPrazo: noPrazo || 0,
        deterioracoes: deterioracoes || 0,
        mediaDia
      },
      maisEmprestados,
      topAlunos,
      topSalas,
      porMes
    });
  } catch (error) {
    console.error('Erro ao gerar estatísticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;

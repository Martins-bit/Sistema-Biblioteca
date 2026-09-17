// routes/emprestimos.js - Rotas para gerenciamento de empréstimos
// Inclui registro do estado de conservação do livro na saída e na devolução.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { ESTADOS_CONSERVACAO, calcularReputacao, notaParaEstrelas } = require('../services/reputacao');
const { verificarSituacao, registrarHistorico, registrarFimDeBloqueioSeEncerrado } = require('../services/bloqueio');

const SELECT_EMPRESTIMO_COMPLETO = `
  SELECT e.*,
         a.nome as alunoNome, a.turma as alunoTurma, a.matricula as alunoMatricula,
         l.titulo as livroTitulo, l.autor as livroAutor, l.categoria as livroCategoria, l.isbn as livroIsbn
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

// ---------------------------------------------------------------------------
// Etapa 7: validação de datas e IDs (fonte da verdade no backend)
// ---------------------------------------------------------------------------

function hojeISO() {
  return new Date().toISOString().split('T')[0];
}

// Exige "AAAA-MM-DD" com data de calendário real (não aceita "abc", 32/13 etc.)
function dataISOValida(valor) {
  if (valor === undefined || valor === null) return false;
  const s = String(valor).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime()) && d.toISOString().split('T')[0] === s;
}

function adicionarDias(iso, dias) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  const inc = Number(dias);
  if (!Number.isFinite(inc)) return d.toISOString().split('T')[0];
  d.setDate(d.getDate() + inc);
  return d.toISOString().split('T')[0];
}

// Converte IDs de corpo/params em inteiros positivos (rejeita "1abc", 0, -1, NaN)
function idInteiroPositivo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
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
// Body: { alunoId, livroId, dataRetirada, dataLimite?, estadoSaida?, obsSaida? }
// Etapa 7: IDs e datas validados no backend; dataLimite padrão = retirada + 7 dias;
// recusa par aluno+livro já emprestado; tudo em transação.
const PRAZO_PADRAO_DIAS = 7;

router.post('/', (req, res) => {
  const body = req.body || {};
  const alunoId = idInteiroPositivo(body.alunoId);
  const livroId = idInteiroPositivo(body.livroId);

  if (!alunoId || !livroId) {
    return res.status(400).json({ error: 'Aluno e livro são obrigatórios (IDs inválidos).' });
  }

  const dataRetirada = body.dataRetirada !== undefined && body.dataRetirada !== null && String(body.dataRetirada).trim() !== ''
    ? String(body.dataRetirada).trim().slice(0, 10)
    : hojeISO();

  if (!dataISOValida(dataRetirada)) {
    return res.status(400).json({ error: 'Data de retirada inválida. Use o formato AAAA-MM-DD.' });
  }
  if (dataRetirada > hojeISO()) {
    return res.status(400).json({ error: 'A data de retirada não pode ser no futuro.' });
  }

  let dataLimite;
  if (body.dataLimite !== undefined && body.dataLimite !== null && String(body.dataLimite).trim() !== '') {
    dataLimite = String(body.dataLimite).trim().slice(0, 10);
    if (!dataISOValida(dataLimite)) {
      return res.status(400).json({ error: 'Data limite inválida. Use o formato AAAA-MM-DD.' });
    }
    if (dataLimite <= dataRetirada) {
      return res.status(400).json({ error: 'A data limite deve ser posterior à data de retirada.' });
    }
  } else {
    dataLimite = adicionarDias(dataRetirada, PRAZO_PADRAO_DIAS);
  }

  const checkEstado = estadoValido(body.estadoSaida);
  if (!checkEstado.ok) {
    return res.status(400).json({
      error: 'Estado de conservação inválido. Use: Novo, Ótimo, Bom, Regular ou Danificado'
    });
  }

  try {
    const conn = db();

    const novoEmprestimo = conn.transaction(() => {
      // Verificar se o aluno existe
      const aluno = conn.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId);
      if (!aluno) {
        const e = new Error('Aluno não encontrado'); e.status = 404; throw e;
      }

      // Verificar se o livro existe
      const livro = conn.prepare('SELECT * FROM livros WHERE id = ?').get(livroId);
      if (!livro) {
        const e = new Error('Livro não encontrado'); e.status = 404; throw e;
      }

      // Etapa 7: o mesmo aluno não pode ter o mesmo livro emprestado duas vezes
      // ao mesmo tempo (protege também contra submissões duplicadas).
      // Verificado ANTES da disponibilidade: a mensagem específica ajuda mais.
      const duplicado = conn.prepare(
        'SELECT id FROM emprestimos WHERE alunoId = ? AND livroId = ? AND devolvido = 0 LIMIT 1'
      ).get(alunoId, livroId);
      if (duplicado) {
        const e = new Error('Este aluno já possui um empréstimo ativo deste livro.');
        e.status = 400; throw e;
      }

      // Verificar se há cópias disponíveis
      const emprestimosAtivos = conn.prepare(
        'SELECT COUNT(*) as count FROM emprestimos WHERE livroId = ? AND devolvido = 0'
      ).get(livroId);

      if (emprestimosAtivos.count >= livro.acervo) {
        const e = new Error('Não há cópias disponíveis deste livro para empréstimo');
        e.status = 400; throw e;
      }

      // ==== REGRA DE BLOQUEIO: aluno com avaliação < 3,0 fica impedido de novos empréstimos ====
      // Validada aqui no backend — mesmo chamando a API diretamente, o empréstimo é recusado.
      const rep = calcularReputacao(conn, alunoId);
      registrarFimDeBloqueioSeEncerrado(conn, alunoId, rep.nota);
      const situacao = verificarSituacao(conn, alunoId, rep);
      if (situacao.bloqueado) {
        const dataFimFmt = String(situacao.dataFim).split('-').reverse().join('/');
        const e = new Error(`Aluno temporariamente bloqueado. Avaliação: ${rep.estrelas} ${rep.nota.toFixed(1).replace('.', ',')}. Novo empréstimo disponível em ${dataFimFmt} (faltam ${situacao.diasRestantes} dia(s)).`);
        e.status = 403; e.bloqueio = situacao; throw e;
      }

      const result = conn.prepare(`
        INSERT INTO emprestimos (alunoId, livroId, dataRetirada, dataLimite, devolvido,
                                 estadoSaida, obsSaida)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(
        alunoId, livroId, dataRetirada, dataLimite,
        checkEstado.valor,
        body.obsSaida ? String(body.obsSaida).trim() || null : null
      );

      return conn.prepare(`
        ${SELECT_EMPRESTIMO_COMPLETO}
        WHERE e.id = ?
      `).get(result.lastInsertRowid);
    })();

    res.status(201).json(novoEmprestimo);
  } catch (error) {
    if (error.status && error.status >= 400 && error.status < 500) {
      const resposta = { error: error.message };
      if (error.bloqueio) resposta.bloqueio = error.bloqueio;
      return res.status(error.status).json(resposta);
    }
    console.error('Erro ao criar empréstimo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/emprestimos/:id - Devolver livro
// Body: { dataDevolucao?, estadoDevolucao?, obsDevolucao? }
// Etapa 7: data de devolução validada (>= retirada e <= hoje) e tudo em transação
// (atualização + histórico + bloqueio) — ou aplica tudo, ou nada.
router.put('/:id', (req, res) => {
  const id = idInteiroPositivo(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'ID de empréstimo inválido.' });
  }

  const body = req.body || {};
  const checkEstado = estadoValido(body.estadoDevolucao);
  if (!checkEstado.ok) {
    return res.status(400).json({
      error: 'Estado de conservação inválido. Use: Novo, Ótimo, Bom, Regular ou Danificado'
    });
  }

  const dataDevolucao = body.dataDevolucao !== undefined && body.dataDevolucao !== null && String(body.dataDevolucao).trim() !== ''
    ? String(body.dataDevolucao).trim().slice(0, 10)
    : hojeISO();

  if (!dataISOValida(dataDevolucao)) {
    return res.status(400).json({ error: 'Data de devolução inválida. Use o formato AAAA-MM-DD.' });
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

    // Etapa 7: consistência das datas — não devolver antes de pegar nem no futuro.
    const retirada = String(emprestimo.dataRetirada).slice(0, 10);
    if (dataDevolucao < retirada) {
      return res.status(400).json({
        error: `A data de devolução (${dataDevolucao.split('-').reverse().join('/')}) não pode ser anterior à data de retirada (${retirada.split('-').reverse().join('/')}).`
      });
    }
    if (dataDevolucao > hojeISO()) {
      return res.status(400).json({ error: 'A data de devolução não pode ser no futuro.' });
    }

    const resultado = conn.transaction(() => {
      const notaAnterior = calcularReputacao(conn, emprestimo.alunoId).nota;

      conn.prepare(`
        UPDATE emprestimos
        SET devolvido = 1,
            dataDevolucao = ?,
            estadoDevolucao = ?,
            obsDevolucao = ?
        WHERE id = ?
      `).run(
        dataDevolucao,
        checkEstado.valor,
        body.obsDevolucao ? String(body.obsDevolucao).trim() || null : null,
        id
      );

      // ==== Histórico da avaliação: explica por que a nota mudou ====
      const repDepois = calcularReputacao(conn, emprestimo.alunoId);
      registrarFimDeBloqueioSeEncerrado(conn, emprestimo.alunoId, repDepois.nota);

      const limite = emprestimo.dataLimite ? String(emprestimo.dataLimite).slice(0, 10) : null;
      const devolucao = dataDevolucao;
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

      return { ...emprestimoAtualizado, situacaoAluno: situacao };
    })();

    res.json(resultado);
  } catch (error) {
    console.error('Erro ao devolver livro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// DELETE /api/emprestimos/:id - Cancelar empréstimo
router.delete('/:id', (req, res) => {
  const id = idInteiroPositivo(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'ID de empréstimo inválido.' });
  }

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
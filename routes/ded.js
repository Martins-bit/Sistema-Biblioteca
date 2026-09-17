// routes/ded.js - Etapa 6B: importação de alunos via arquivo DED.
//
// Fluxo: upload/preview (POST /api/alunos/ded/preview) -> confirmação transacional
// (POST /api/alunos/ded/confirmar) + mapeamento persistente de turmas.
//
// Estas rotas são montadas em /api/alunos/ded dentro de routes/alunos.js
// (que já está protegido por requireAuth no server.js). O CSRF é global
// (middleware/csrf.js) e cobre POST/PUT automaticamente.

const express = require('express');
const multer = require('multer');
const db = require('../db');
const { TURMAS, turmaValida } = require('../services/turmas');
const ded = require('../services/ded');

const router = express.Router();

// Upload seguro: memória, 2 MB, extensões csv/txt/tsv.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const nome = String(file.originalname || '').toLowerCase();
    const okExt = /\.(csv|txt|tsv)$/.test(nome);
    const okMime = !file.mimetype || /^(text\/|application\/(octet-stream|csv|vnd\.ms-excel))/.test(file.mimetype);
    if (!okExt || !okMime) {
      return cb(new Error('Formato não suportado. Envie um arquivo CSV, TXT ou TSV.'));
    }
    cb(null, true);
  }
});

// ---------------------------------------------------------------------------
// Helpers de banco / mapeamento
// ---------------------------------------------------------------------------

function obterMapeamentos(conn) {
  return conn.prepare('SELECT turma_ded, turma_sistema FROM ded_turma_map').all()
    .reduce((mapa, m) => { mapa.set(m.turma_ded, m.turma_sistema); return mapa; }, new Map());
}

function salvarMapeamento(conn, turmaDed, turmaSistema) {
  const td = ded.normalizarTurmaDed(turmaDed);
  if (!td) return { ok: false, erro: 'turma_ded obrigatória.' };
  // turma_sistema NULL => marcado para ignorar.
  let ts = turmaSistema === null || turmaSistema === undefined || String(turmaSistema).trim() === ''
    ? null : String(turmaSistema).trim();
  if (ts !== null && !turmaValida(ts)) {
    return { ok: false, erro: `Turma do sistema inválida: "${ts}".` };
  }
  conn.prepare(`
    INSERT INTO ded_turma_map (turma_ded, turma_sistema) VALUES (?, ?)
    ON CONFLICT(turma_ded) DO UPDATE SET turma_sistema = excluded.turma_sistema
  `).run(td, ts);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// MAPEAMENTO (GET/PUT)
// ---------------------------------------------------------------------------

// GET /api/alunos/ded/mapeamento
router.get('/mapeamento', (req, res) => {
  try {
    const lista = db().prepare(
      'SELECT turma_ded, turma_sistema FROM ded_turma_map ORDER BY turma_ded'
    ).all();
    res.json({ mapeamentos: lista, turmasSistema: TURMAS });
  } catch (error) {
    console.error('Erro ao listar mapeamentos DED:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /api/alunos/ded/mapeamento — body: { mapeamentos: [{turmaDed, turmaSistema|null}] }
router.put('/mapeamento', (req, res) => {
  try {
    const itens = Array.isArray(req.body && req.body.mapeamentos) ? req.body.mapeamentos : null;
    if (!itens) return res.status(400).json({ error: 'Corpo inválido: informe "mapeamentos".' });

    const conn = db();
    const tx = conn.transaction(() => {
      for (const item of itens) {
        const r = salvarMapeamento(conn, item.turmaDed, item.turmaSistema);
        if (!r.ok) { const e = new Error(r.erro); e.status = 400; throw e; }
      }
    });
    try { tx(); } catch (e) {
      if (e.status === 400) return res.status(400).json({ error: e.message });
      throw e;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao salvar mapeamentos DED:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ---------------------------------------------------------------------------
// PREVIEW
// ---------------------------------------------------------------------------

// POST /api/alunos/ded/preview — multipart form com campo "arquivo"
// (ou JSON { conteudoBase64, nome }).
router.post('/preview', (req, res) => {
  upload.single('arquivo')(req, res, (errUpload) => {
    if (errUpload) {
      return res.status(400).json({ error: errUpload.message || 'Arquivo inválido.' });
    }
    try {
      let buffer = null, nomeArquivo = '';
      if (req.file) { buffer = req.file.buffer; nomeArquivo = req.file.originalname; }
      else if (req.body && req.body.conteudoBase64) {
        buffer = Buffer.from(req.body.conteudoBase64, 'base64');
        nomeArquivo = String(req.body.nome || '');
      }
      if (!buffer || !buffer.length) {
        return res.status(400).json({ error: 'Arquivo vazio.' });
      }
      const ext = nomeArquivo.toLowerCase().split('.').pop();
      if (ext === 'xlsx' || ext === 'xls' || ext === 'doc' || ext === 'docx') {
        return res.status(400).json({ error: 'Formato não suportado. Envie um arquivo CSV, TXT ou TSV.' });
      }
      // Conteúdo binário real (ex.: xlsx com extensão trocada): ZIP tem PK\x03\x04.
      if (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
        return res.status(400).json({ error: 'Formato não suportado. Envie um arquivo CSV, TXT ou TSV.' });
      }

      const texto = ded.decodificarArquivo(buffer);
      const parse = ded.parseArquivo(texto);
      if (!parse.ok) return res.status(400).json({ error: parse.erro });

      const linhas = parse.linhas;

      const conn = db();
      const mapa = obterMapeamentos(conn);
      const turmasArquivo = ded.turmasDistintas(linhas);

      // Mapeamentos faltando (nem confirmados, nem marcados p/ ignorar).
      const turmasSemMapeamento = turmasArquivo.filter(t => !mapa.has(t));

      // Alunos existentes por matrícula e por nome+turma (para correspondências).
      const existentesPorMatricula = new Map(
        conn.prepare('SELECT id, nome, turma, matricula FROM alunos WHERE matricula IS NOT NULL').all()
          .map(a => [a.matricula, a])
      );
      const existentesSemMatricula = conn.prepare(
        'SELECT id, nome, turma, matricula FROM alunos WHERE matricula IS NULL'
      ).all();

      // Duplicidades dentro do arquivo (por matrícula).
      const contagemMatricula = new Map();
      for (const l of linhas) {
        if (l.matricula) contagemMatricula.set(l.matricula, (contagemMatricula.get(l.matricula) || 0) + 1);
      }

      const preview = linhas.map((l) => {
        const item = {
          linha: l.linha,
          matricula: l.matricula,
          nome: l.nome,
          turmaDed: l.turmaDed,
          turmaSistema: mapa.get(l.turmaDed) ?? null,
          acao: 'INVALIDO',
          motivo: l.erro || '',
          alunoExistenteId: null,
          correspondencias: []
        };

        if (l.erro) { item.motivo = l.erro; return item; }
        if (!mapa.has(l.turmaDed)) {
          item.motivo = 'Turma requer mapeamento.';
          return item;
        }
        if (mapa.get(l.turmaDed) === null) {
          item.acao = 'IGNORAR';
          item.motivo = 'Turma marcada para ignorar no mapeamento.';
          return item;
        }

        const duplicada = l.matricula && contagemMatricula.get(l.matricula) > 1;
        if (duplicada) {
          item.acao = 'CONFLITO';
          item.motivo = 'Esta matrícula aparece mais de uma vez no arquivo.';
          return item;
        }

        const existente = l.matricula ? existentesPorMatricula.get(l.matricula) : null;
        if (existente) {
          item.acao = 'ATUALIZAR';
          item.alunoExistenteId = existente.id;
          item.nomeAnterior = existente.nome;
          item.turmaAnterior = existente.turma;
          item.motivo = `Atualizar aluno #${existente.id}`;
          return item;
        }

        // Sem matrícula no banco: procura possíveis homônimos (NÃO vincula).
        if (!l.matricula) {
          const homonimos = existentesSemMatricula.filter(a =>
            a.nome.toLowerCase() === l.nome.toLowerCase() && a.turma === item.turmaSistema
          );
          if (homonimos.length) {
            item.acao = 'CORRESPONDENCIA';
            item.correspondencias = homonimos.map(a => ({ id: a.id, nome: a.nome, turma: a.turma }));
            item.motivo = 'Possível correspondência por nome — confirme para vincular ou criar novo.';
            return item;
          }
        }

        item.acao = 'NOVO';
        item.motivo = 'Criar novo aluno';
        return item;
      });

      // Contagem por ação (para o frontend).
      const resumo = preview.reduce((acc, p) => { acc[p.acao] = (acc[p.acao] || 0) + 1; return acc; }, {});

      res.json({
        ok: true,
        arquivo: nomeArquivo,
        separador: parse.separador === '\t' ? 'TAB' : parse.separador,
        comCabecalho: parse.comCabecalho,
        turmasArquivo,
        turmasSemMapeamento,
        mapeamentosSalvos: conn.prepare('SELECT turma_ded, turma_sistema FROM ded_turma_map').all(),
        preview,
        resumo
      });
    } catch (error) {
      console.error('Erro no preview DED:', error);
      res.status(500).json({ error: 'Não foi possível ler o arquivo. Nenhuma alteração foi aplicada.' });
    }
  });
});

// ---------------------------------------------------------------------------
// CONFIRMAÇÃO (transacional)
// ---------------------------------------------------------------------------

// POST /api/alunos/ded/confirmar
// Body: { linhas: [{ linha, matricula, nome, turmaDed, acao, vincularAlunoId? }] }
// O servidor NÃO confia na prévia: revalida tudo (mapeamento, matrícula,
// duplicidade, existência) e executa em transação — ou aplica tudo, ou nada.
router.post('/confirmar', (req, res) => {
  try {
    const recebidas = Array.isArray(req.body && req.body.linhas) ? req.body.linhas : null;
    if (!recebidas) return res.status(400).json({ error: 'Corpo inválido: informe "linhas".' });

    const conn = db();
    const mapa = obterMapeamentos(conn);
    const stmtAlunoPorMatricula = conn.prepare('SELECT id, nome, turma, matricula FROM alunos WHERE matricula = ?');
    const stmtAlunoPorId = conn.prepare('SELECT id, nome, turma, matricula FROM alunos WHERE id = ?');
    const stmtInsert = conn.prepare('INSERT INTO alunos (nome, turma, matricula) VALUES (?, ?, ?)');
    const stmtUpdate = conn.prepare('UPDATE alunos SET nome = ?, turma = ? WHERE id = ?');

    let criados = 0, atualizados = 0, ignorados = 0, nomesAtualizados = 0, turmasAtualizadas = 0;
    let conflitos = 0, invalidos = 0;

    const tx = conn.transaction(() => {
      const vistas = new Map(); // matrículas já processadas nesta importação
      for (const r of recebidas) {
        const matriculaNorm = ded.normalizarMatricula(r.matricula);
        const nome = ded.normalizarNome(r.nome);
        const turmaDed = ded.normalizarTurmaDed(r.turmaDed);

        // Revalidação completa (não confia no frontend).
        if (matriculaNorm.invalida || !nome || !turmaDed) { invalidos++; continue; }

        if (!mapa.has(turmaDed) || mapa.get(turmaDed) === null) { ignorados++; continue; }
        const turmaSistema = mapa.get(turmaDed);
        if (!turmaValida(turmaSistema)) { invalidos++; continue; }

        if (matriculaNorm.valor && vistas.has(matriculaNorm.valor)) { conflitos++; continue; }
        if (matriculaNorm.valor) vistas.set(matriculaNorm.valor, true);

        const acao = String(r.acao || '').toUpperCase();

        if (acao === 'IGNORAR') { ignorados++; continue; }

        if (acao === 'NOVO') {
          // Pode ter surgido a matrícula no banco desde a prévia: re-verifica.
          const existente = matriculaNorm.valor ? stmtAlunoPorMatricula.get(matriculaNorm.valor) : null;
          if (existente) {
            stmtUpdate.run(nome, turmaSistema, existente.id);
            atualizados++;
            if (existente.nome !== nome) nomesAtualizados++;
            if (existente.turma !== turmaSistema) turmasAtualizadas++;
          } else {
            stmtInsert.run(nome, turmaSistema, matriculaNorm.valor);
            criados++;
          }
          continue;
        }

        if (acao === 'ATUALIZAR' || acao === 'CORRESPONDENCIA') {
          // CORRESPONDENCIA: só vincula/atualiza se a usuária confirmou o id
          // e o aluno ainda existe (evita fusão errada de homônimos).
          let alvo = null;
          if (acao === 'CORRESPONDENCIA') {
            const idVinculo = Number(r.vincularAlunoId);
            if (!idVinculo) { ignorados++; continue; }
            const aluno = stmtAlunoPorId.get(idVinculo);
            if (!aluno) { invalidos++; continue; }
            if (aluno.matricula && aluno.matricula !== matriculaNorm.valor) {
              invalidos++; continue;
            }
            alvo = aluno;
          } else {
            alvo = matriculaNorm.valor
              ? stmtAlunoPorMatricula.get(matriculaNorm.valor)
              : (r.alunoExistenteId ? stmtAlunoPorId.get(Number(r.alunoExistenteId)) : null);
          }
          if (!alvo) { invalidos++; continue; }

          stmtUpdate.run(nome, turmaSistema, alvo.id);
          atualizados++;
          if (alvo.nome !== nome) nomesAtualizados++;
          if (alvo.turma !== turmaSistema) turmasAtualizadas++;
          continue;
        }

        // Ações não reconhecidas / CONFLITO => não importa.
        if (acao === 'CONFLITO') conflitos++;
        else invalidos++;
      }
    });

    try { tx(); } catch (errorTx) {
      console.error('Erro na transação de importação DED (rollback):', errorTx);
      return res.status(500).json({
        error: 'Não foi possível concluir a importação. Nenhuma alteração foi aplicada.'
      });
    }

    res.json({ ok: true, criados, atualizados, ignorados, conflitos, invalidos, nomesAtualizados, turmasAtualizadas });
  } catch (error) {
    console.error('Erro ao confirmar importação DED:', error);
    res.status(500).json({ error: 'Não foi possível concluir a importação. Nenhuma alteração foi aplicada.' });
  }
});

module.exports = router;

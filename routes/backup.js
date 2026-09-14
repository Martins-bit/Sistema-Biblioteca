// routes/backup.js - Backup, restauração e limpeza dos dados.
//
// Todas as rotas deste router são protegidas por requireAuth (ver server.js),
// então NÃO reimplementamos autenticação aqui.
//
// Endpoints:
//   GET    /api/backup                 -> exporta os dados como JSON (download/compatibilidade)
//   GET    /api/backup/status          -> último backup + config automática + operação atual
//   GET    /api/backup/lista           -> histórico de backups internos
//   POST   /api/backup/criar           -> cria um backup consistente (.db) agora
//   GET    /api/backup/arquivo/:nome   -> baixa um arquivo de backup do disco
//   GET    /api/backup/config          -> lê a config do backup automático
//   PUT    /api/backup/config          -> atualiza a config do backup automático
//   POST   /api/backup/validar         -> valida um arquivo enviado (sem restaurar)
//   POST   /api/backup/restaurar       -> restaura um backup (com pre-restore + confirmação)
//   POST   /api/backup                 -> importa dados de um JSON antigo (merge)
//   DELETE /api/backup                 -> apaga TODOS os dados (ação separada e explícita)

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const db = require('../db');
const backup = require('../services/backup');

// Upload em memória: arquivos de backup são pequenos e evitamos lixo em disco.
// Limite de 200 MB para folga; acima disso recusamos.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }
});

// Base64 para arquivos .db enviados como JSON (alternativa ao FormData).
function decodificarBase64(str) {
  const limpo = String(str).replace(/^data:.*?;base64,/, '');
  return Buffer.from(limpo, 'base64');
}

function nomeArquivoSeguro(nome) {
  const base = path.basename(String(nome || ''));
  if (!/^[\w.\-]+\.(db|json)$/i.test(base)) return null;
  if (/\.meta\.json$/i.test(base)) return null; // metadados não são backups
  return base;
}

// Remove um arquivo e possíveis sobras de WAL (-wal/-shm) que o SQLite pode criar.
// No Windows, arquivos com handle aberto não podem ser apagados na hora;
// tentamos novamente após uma pequena pausa antes de desistir.
function removerArquivoSqlite(arquivo) {
  for (const f of [arquivo, `${arquivo}-wal`, `${arquivo}-shm`]) {
    if (!fs.existsSync(f)) continue;
    try {
      fs.unlinkSync(f);
    } catch (_) {
      try {
        const inicio = Date.now();
        while (Date.now() - inicio < 500) { /* aguarda liberação do handle */ }
        fs.unlinkSync(f);
      } catch (e2) {
        console.error('Aviso: não foi possível remover arquivo temporário:', f, e2.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Status / histórico
// ---------------------------------------------------------------------------

// GET /api/backup/status - visão geral para a interface.
router.get('/status', (req, res) => {
  try {
    const cfg = backup.lerConfig();
    res.json({
      ultimoBackup: backup.ultimoBackup(),
      config: cfg,
      operacao: backup.operacaoAtual(),
      pasta: 'backups/',
      retencao: backup.RETENCAO_AUTOMATICOS
    });
  } catch (error) {
    console.error('Erro ao obter status de backup:', error);
    res.status(500).json({ error: 'Não foi possível obter o status do backup.' });
  }
});

// GET /api/backup/lista - histórico simples de backups internos.
router.get('/lista', (req, res) => {
  try {
    res.json({ backups: backup.listarBackups() });
  } catch (error) {
    console.error('Erro ao listar backups:', error);
    res.status(500).json({ error: 'Não foi possível listar os backups.' });
  }
});

// ---------------------------------------------------------------------------
// Criação de backup consistente
// ---------------------------------------------------------------------------

// POST /api/backup/criar - cria um backup interno agora (formato .db, consistente).
router.post('/criar', async (req, res) => {
  try {
    backup.iniciarOperacao('backup');
  } catch (e) {
    return res.status(409).json({ error: e.message });
  }
  try {
    const conn = db();
    const meta = await backup.criarBackupArquivo(conn, 'manual');

    // Valida o backup recém-criado antes de registrar como sucesso.
    const check = backup.validarBackupDb(path.join(backup.BACKUP_DIR, meta.arquivo));
    if (!check.valido) {
      return res.status(500).json({ error: 'Não foi possível criar o backup.' });
    }

    res.json({
      ok: true,
      message: 'Backup concluído com sucesso.',
      backup: meta
    });
  } catch (error) {
    console.error('Erro ao criar backup:', error);
    res.status(500).json({ error: 'Não foi possível criar o backup.' });
  } finally {
    backup.finalizarOperacao();
  }
});

// GET /api/backup/arquivo/:nome - baixa um arquivo de backup do disco.
router.get('/arquivo/:nome', (req, res) => {
  const nome = nomeArquivoSeguro(req.params.nome);
  if (!nome) return res.status(400).json({ error: 'Nome de arquivo inválido.' });
  const full = path.join(backup.BACKUP_DIR, nome);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.download(full, nome);
});

// ---------------------------------------------------------------------------
// Configuração do backup automático
// ---------------------------------------------------------------------------

const FREQUENCIAS_VALIDAS = ['diario', 'semanal'];

// GET /api/backup/config
router.get('/config', (req, res) => {
  res.json(backup.lerConfig());
});

// PUT /api/backup/config - body: { automatico: bool, frequencia: 'diario'|'semanal' }
router.put('/config', (req, res) => {
  try {
    const { automatico, frequencia } = req.body || {};
    const patch = {};
    if (typeof automatico === 'boolean') patch.automatico = automatico;
    if (frequencia) {
      if (!FREQUENCIAS_VALIDAS.includes(frequencia)) {
        return res.status(400).json({ error: 'Frequência inválida.' });
      }
      patch.frequencia = frequencia;
    }
    const cfg = backup.salvarConfig(patch);

    // Ao ativar, dispara a verificação (cria já o primeiro backup se vencido).
    if (patch.automatico === true) {
      const scheduler = require('../services/backupScheduler');
      scheduler.verificarEExecutar(db).catch(() => {});
    }
    res.json({ ok: true, config: cfg });
  } catch (error) {
    console.error('Erro ao salvar config de backup:', error);
    res.status(500).json({ error: 'Não foi possível salvar as configurações.' });
  }
});

// ---------------------------------------------------------------------------
// Validação de arquivo enviado
// ---------------------------------------------------------------------------

// Extrai o buffer do arquivo a partir de FormData (campo "arquivo") ou JSON
// ({ nome, conteudoBase64 }).
function extrairArquivoEnviado(req) {
  if (req.file) {
    return { nome: req.file.originalname, buffer: req.file.buffer };
  }
  const body = req.body || {};
  if (body.conteudoBase64) {
    try {
      return { nome: body.nome || 'backup.db', buffer: decodificarBase64(body.conteudoBase64) };
    } catch (_) {
      return null;
    }
  }
  return null;
}

// POST /api/backup/validar - valida sem restaurar. Retorna informações.
router.post('/validar', upload.single('arquivo'), (req, res) => {
  const enviado = extrairArquivoEnviado(req);
  if (!enviado || !enviado.buffer) {
    // Alguns uploads de arquivo vazio chegam sem conteúdo (multer descarta
    // arquivos de 0 byte). Ainda assim, trata-se de um backup inválido.
    return res.status(422).json({
      valido: false,
      error: 'Este arquivo não é um backup válido do Sistema da Biblioteca.',
      motivo: 'O arquivo está vazio.'
    });
  }
  if (!enviado.buffer.length) {
    return res.status(422).json({
      valido: false,
      error: 'Este arquivo não é um backup válido do Sistema da Biblioteca.',
      motivo: 'O arquivo está vazio.'
    });
  }

  const nome = String(enviado.nome || '');
  const temporario = path.join(backup.BACKUP_DIR, `.validacao-${Date.now()}`);
  backup.garantirPastaBackups();

  try {
    fs.writeFileSync(temporario, enviado.buffer);

    let resultado;
    if (/\.json$/i.test(nome)) {
      try {
        resultado = backup.validarBackupJson(JSON.parse(enviado.buffer.toString('utf8')));
      } catch (_) {
        resultado = { valido: false, motivo: 'JSON inválido.' };
      }
    } else {
      resultado = backup.validarBackupDb(temporario);
    }

    if (!resultado.valido) {
      return res.status(422).json({
        valido: false,
        error: 'Este arquivo não é um backup válido do Sistema da Biblioteca.',
        motivo: resultado.motivo
      });
    }

    res.json({
      valido: true,
      nome,
      tipo: /\.json$/i.test(nome) ? 'json' : 'db',
      tamanho: enviado.buffer.length,
      contagens: resultado.meta || null
    });
  } finally {
    removerArquivoSqlite(temporario);
  }
});

// ---------------------------------------------------------------------------
// Restauração
// ---------------------------------------------------------------------------

// Restaura a partir de um backup .db (interno ou enviado).
// Estratégia:
//   1. valida o arquivo de backup;
//   2. cria um pre-restore do estado atual (se falhar, CANCELA);
//   3. fecha a conexão compartilhada;
//   4. substitui o arquivo do banco pela cópia validada (via arquivo temporário);
//   5. reabre a conexão.
// Em qualquer falha após o passo 2, tenta recuperar o pre-restore.
async function restaurarDeArquivoDb(origem, nomeOrigem) {
  const check = backup.validarBackupDb(origem);
  if (!check.valido) {
    const e = new Error('Este arquivo não é um backup válido do Sistema da Biblioteca.');
    e.status = 422;
    throw e;
  }

  // 1) Pre-restore do estado atual ANTES de tocar em qualquer coisa.
  let preRestore;
  try {
    preRestore = await backup.criarBackupArquivo(db(), 'pre-restore');
  } catch (err) {
    const e = new Error('Não foi possível criar o backup de segurança (pre-restore). Restauração cancelada.');
    e.status = 500;
    throw e;
  }

  const dbPath = backup.DB_PATH;
  const tmpDestino = path.join(backup.BACKUP_DIR, `.restore-${Date.now()}.db`);
  try {
    // Copia a origem validada para um temporário (não mexemos no arquivo original).
    fs.copyFileSync(origem, tmpDestino);

    // Fecha a conexão (com checkpoint) para liberar o arquivo principal.
    db.fechar();

    // Remove WAL/SHM do banco atual para não misturar estado antigo.
    for (const sufixo of ['-wal', '-shm']) {
      const f = `${dbPath}${sufixo}`;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    // Substitui o banco principal.
    fs.copyFileSync(tmpDestino, dbPath);
  } catch (err) {
    // Falha na troca: reabre o que houver e tenta recuperar do pre-restore.
    try { db.reabrir(); } catch (_) {}
    try {
      fs.copyFileSync(path.join(backup.BACKUP_DIR, preRestore.arquivo), dbPath);
      db.reabrir();
    } catch (recErr) {
      console.error('Falha crítica ao recuperar pre-restore:', recErr);
    }
    const e = new Error('Falha ao restaurar o backup. Os dados atuais foram preservados.');
    e.status = 500;
    throw e;
  } finally {
    try { if (fs.existsSync(tmpDestino)) fs.unlinkSync(tmpDestino); } catch (_) {}
  }

  // 2) Reabre e valida o banco restaurado.
  const conn = db.reabrir();
  const contagens = backup.metadadosDoBanco(conn);
  return { preRestore: preRestore.arquivo, origem: nomeOrigem, contagens };
}

// POST /api/backup/restaurar
// Aceita:
//   - FormData com campo "arquivo" (+ confirmar=1); ou
//   - JSON { nome: 'biblioteca-backup-....db' } para restaurar backup interno; ou
//   - JSON { nome, conteudoBase64 }.
router.post('/restaurar', upload.single('arquivo'), async (req, res) => {
  const confirmar = req.body?.confirmar === '1' || req.body?.confirmar === 1 || req.body?.confirmar === true;
  if (!confirmar) {
    return res.status(400).json({ error: 'Restauração não confirmada.' });
  }

  try {
    backup.iniciarOperacao('restauracao');
  } catch (e) {
    return res.status(409).json({ error: e.message });
  }

  let temporario = null;
  try {
    let origem;
    let nomeOrigem;

    if (req.file) {
      backup.garantirPastaBackups();
      temporario = path.join(backup.BACKUP_DIR, `.upload-${Date.now()}.db`);
      fs.writeFileSync(temporario, req.file.buffer);
      origem = temporario;
      nomeOrigem = req.file.originalname;
    } else if (req.body?.conteudoBase64) {
      backup.garantirPastaBackups();
      temporario = path.join(backup.BACKUP_DIR, `.upload-${Date.now()}.db`);
      fs.writeFileSync(temporario, decodificarBase64(req.body.conteudoBase64));
      origem = temporario;
      nomeOrigem = req.body.nome || 'backup.db';
    } else if (req.body?.nome) {
      const nome = nomeArquivoSeguro(req.body.nome);
      if (!nome) return res.status(400).json({ error: 'Nome de backup inválido.' });
      origem = path.join(backup.BACKUP_DIR, nome);
      nomeOrigem = nome;
      if (!fs.existsSync(origem)) {
        return res.status(404).json({ error: 'Backup não encontrado.' });
      }
      if (/\.json$/i.test(nome)) {
        return res.status(400).json({
          error: 'Backups em JSON devem ser importados (ação de importação), não restaurados por arquivo.'
        });
      }
    } else {
      return res.status(400).json({ error: 'Nenhum arquivo de backup informado.' });
    }

    const resultado = await restaurarDeArquivoDb(origem, nomeOrigem);
    res.json({
      ok: true,
      message: 'Backup restaurado com sucesso.',
      ...resultado
    });
  } catch (error) {
    console.error('Erro ao restaurar backup:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Não foi possível restaurar o backup.'
    });
  } finally {
    if (temporario) removerArquivoSqlite(temporario);
    backup.finalizarOperacao();
  }
});

// ---------------------------------------------------------------------------
// Exportação JSON (compatibilidade)
// ---------------------------------------------------------------------------

// GET /api/backup - Exporta todos os dados como JSON (download/compatibilidade).
router.get('/', (req, res) => {
  try {
    const conn = db();
    res.json({
      version: 3,
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
    const inserirLivro = conn.prepare(
      'INSERT INTO livros (titulo, autor, categoria, acervo, capaUrl, isbn, classificacao, genero, localizacaoLetra, localizacaoNumero) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
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
        const r = inserirLivro.run(
          l.titulo,
          l.autor,
          l.categoria,
          l.acervo || 1,
          l.capaUrl || null,
          l.isbn || null,
          l.classificacao || null,
          l.genero || null,
          l.localizacaoLetra || null,
          l.localizacaoNumero ?? null
        );
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

// DELETE /api/backup - Apaga TODOS os dados (ação separada e explícita).
// NUNCA é executada automaticamente por um backup. Exige confirmação explícita.
router.delete('/', (req, res) => {
  const confirmar = req.body?.confirmar === '1' || req.query.confirmar === '1';
  if (!confirmar) {
    return res.status(400).json({ error: 'Exclusão total não confirmada.' });
  }
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
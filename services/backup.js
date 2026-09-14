// services/backup.js
// Serviço de backup/restauração do Sistema da Biblioteca.
//
// Decisões de projeto (por que não é uma cópia ingênua do arquivo):
// - O banco usa journal_mode = WAL. Copiar biblioteca.db "na mão" pode capturar
//   um estado inconsistente (parte das últimas escritas ainda vive no -wal).
// - O better-sqlite3 (>= 7) expõe `db.backup(destino)`, que usa a API Online
//   Backup do próprio SQLite: gera uma cópia CONSISTENTE mesmo com conexões
//   abertas e WAL. É o mecanismo mais seguro para este projeto.
// - Por isso o formato de backup interno é um arquivo .db (SQLite), e não JSON.
//   O antigo JSON continua aceito na importação (compatibilidade) e o download
//   manual em JSON também segue disponível.
//
// Nada aqui apaga ou sobrescreve o banco real do sistema. A restauração opera
// por meio de uma cópia temporária + troca de arquivo, sempre após um
// pre-restore do estado atual.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'biblioteca.db');
const BACKUP_DIR = path.join(ROOT, 'backups');
const CONFIG_PATH = path.join(BACKUP_DIR, 'config.json');

// Tabelas que todo backup válido do sistema precisa conter.
const TABELAS_ESSENCIAIS = ['users', 'alunos', 'livros', 'emprestimos'];

// Retenção: quantos backups AUTOMÁTICOS manter (os manuais nunca são removidos).
const RETENCAO_AUTOMATICOS = 10;

// ---------------------------------------------------------------------------
// Estado de concorrência: uma única operação (backup OU restauração) por vez.
// Suficiente para um sistema local/escolar de usuário único.
// ---------------------------------------------------------------------------
let operacaoEmAndamento = null; // { tipo, inicio }

function operacaoAtual() {
  return operacaoEmAndamento;
}

function iniciarOperacao(tipo) {
  if (operacaoEmAndamento) {
    const e = new Error(
      `Já existe uma operação em andamento (${operacaoEmAndamento.tipo}). Aguarde ela terminar.`
    );
    e.code = 'OPERACAO_EM_ANDAMENTO';
    throw e;
  }
  operacaoEmAndamento = { tipo, inicio: new Date().toISOString() };
}

function finalizarOperacao() {
  operacaoEmAndamento = null;
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function garantirPastaBackups() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// Timestamp compatível com Windows (sem ":" que é inválido em nomes de arquivo).
// Ex.: 2026-09-14-1915
function timestamp(nomeBase) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}`;
  return `${nomeBase}-${ts}`;
}

// Gera um caminho de arquivo que NUNCA sobrescreve um backup existente.
// Se já existir, acrescenta um sufixo -2, -3, ...
function caminhoUnico(pasta, nomeBase, extensao) {
  let nome = `${nomeBase}${extensao}`;
  let destino = path.join(pasta, nome);
  let i = 2;
  while (fs.existsSync(destino)) {
    nome = `${nomeBase}-${i}${extensao}`;
    destino = path.join(pasta, nome);
    i++;
  }
  return destino;
}

// Metadados leves gravados ao lado de cada backup: contagens e origem.
function metadadosDoBanco(conn) {
  const conta = (t) => {
    try {
      return conn.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    } catch (_) {
      return null;
    }
  };
  return {
    livros: conta('livros'),
    alunos: conta('alunos'),
    emprestimos: conta('emprestimos'),
    relatorios: conta('relatorios')
  };
}

function lerMetadados(arquivo) {
  const metaPath = `${arquivo}.meta.json`;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function escreverMetadados(arquivo, meta) {
  try {
    fs.writeFileSync(`${arquivo}.meta.json`, JSON.stringify(meta, null, 2));
  } catch (e) {
    console.error('Aviso: não foi possível gravar metadados do backup:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Validação de arquivos de backup
// ---------------------------------------------------------------------------

// Verifica se um arquivo SQLite é realmente um backup do Sistema da Biblioteca.
// Não confia na extensão: abre o arquivo, confere o cabeçalho SQLite, lê o
// schema e exige as tabelas essenciais.
function validarBackupDb(arquivo) {
  if (!fs.existsSync(arquivo)) {
    return { valido: false, motivo: 'Arquivo não encontrado.' };
  }
  const stat = fs.statSync(arquivo);
  if (stat.size === 0) {
    return { valido: false, motivo: 'O arquivo está vazio.' };
  }
  // Um arquivo SQLite válido começa com a assinatura "SQLite format 3\0".
  let header;
  try {
    const fd = fs.openSync(arquivo, 'r');
    header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
  } catch (e) {
    return { valido: false, motivo: 'Não foi possível ler o arquivo.' };
  }
  if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
    return { valido: false, motivo: 'O arquivo não é um banco SQLite.' };
  }

  let conn;
  try {
    conn = new Database(arquivo, { readonly: true });
    const tabelas = conn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);

    const faltando = TABELAS_ESSENCIAIS.filter((t) => !tabelas.includes(t));
    if (faltando.length) {
      // Fecha ANTES de retornar: no Windows, uma conexão aberta impede o
      // arquivo temporário de ser apagado depois (ficaria "travado").
      conn.close();
      return {
        valido: false,
        motivo: `Estrutura incompatível. Faltam tabelas: ${faltando.join(', ')}.`
      };
    }

    const meta = metadadosDoBanco(conn);
    conn.close();
    return { valido: true, meta, tamanho: stat.size };
  } catch (e) {
    if (conn) { try { conn.close(); } catch (_) {} }
    return { valido: false, motivo: 'O arquivo está corrompido ou não é um backup válido.' };
  }
}

// Valida um backup em formato JSON antigo (compatibilidade).
function validarBackupJson(obj) {
  if (!obj || typeof obj !== 'object') {
    return { valido: false, motivo: 'JSON inválido.' };
  }
  const temLista =
    Array.isArray(obj.alunos) || Array.isArray(obj.livros) || Array.isArray(obj.emprestimos);
  if (!temLista) {
    return { valido: false, motivo: 'Nenhuma lista de dados (alunos/livros/emprestimos) encontrada.' };
  }
  return {
    valido: true,
    meta: {
      alunos: Array.isArray(obj.alunos) ? obj.alunos.length : 0,
      livros: Array.isArray(obj.livros) ? obj.livros.length : 0,
      emprestimos: Array.isArray(obj.emprestimos) ? obj.emprestimos.length : 0,
      relatorios: Array.isArray(obj.relatorios) ? obj.relatorios.length : 0
    }
  };
}

// ---------------------------------------------------------------------------
// Criação de backup consistente
// ---------------------------------------------------------------------------

// Cria um arquivo .db consistente usando a API de backup do SQLite.
// tipo: 'manual' | 'automatico' | 'pre-restore'
function criarBackupArquivo(conn, tipo) {
  garantirPastaBackups();

  const nomeBase =
    tipo === 'pre-restore'
      ? timestamp('pre-restore')
      : timestamp('biblioteca-backup');

  const destino = caminhoUnico(BACKUP_DIR, nomeBase, '.db');

  // `backup` retorna uma Promise e é a forma consistente de copiar o banco.
  // Como o restante do fluxo é síncrono (better-sqlite3), usamos a versão
  // síncrona via retorno de Promise resolvida no chamador.
  return conn.backup(destino).then(() => {
    // O `backup()` cria uma cópia em modo WAL, o que gera arquivos -wal/-shm
    // ao lado. Convertemos o backup para um único arquivo autocontido (DELETE)
    // e fazemos checkpoint, para que o backup seja um .db isolado e portável.
    try {
      const bc = new Database(destino);
      bc.pragma('wal_checkpoint(TRUNCATE)');
      bc.pragma('journal_mode = DELETE');
      bc.close();
    } catch (e) {
      console.error('Aviso: não foi possível normalizar o arquivo de backup:', e.message);
    }
    // Remove sobras do modo WAL, se existirem.
    for (const suf of ['-wal', '-shm']) {
      const f = `${destino}${suf}`;
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }

    const meta = {
      arquivo: path.basename(destino),
      tipo,
      criadoEm: new Date().toISOString(),
      tamanho: fs.statSync(destino).size,
      contagens: metadadosDoBanco(conn)
    };
    escreverMetadados(destino, meta);
    return meta;
  });
}

// ---------------------------------------------------------------------------
// Histórico de backups internos
// ---------------------------------------------------------------------------

function listarBackups() {
  garantirPastaBackups();
  const itens = fs
    .readdirSync(BACKUP_DIR)
    // Aceita .db e .json, mas ignora os arquivos de metadados (*.meta.json).
    .filter((f) => f.endsWith('.db') || (f.endsWith('.json') && !f.endsWith('.meta.json')))
    .map((nome) => {
      const full = path.join(BACKUP_DIR, nome);
      let stat;
      try { stat = fs.statSync(full); } catch (_) { return null; }
      const meta = lerMetadados(full);
      const tipo = meta?.tipo || (nome.startsWith('pre-restore') ? 'pre-restore' : 'manual');
      return {
        arquivo: nome,
        tipo,
        criadoEm: meta?.criadoEm || stat.mtime.toISOString(),
        tamanho: stat.size,
        contagens: meta?.contagens || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
  return itens;
}

function ultimoBackup() {
  const todos = listarBackups().filter((b) => b.tipo !== 'pre-restore');
  return todos.length ? todos[0] : null;
}

// ---------------------------------------------------------------------------
// Retenção: manter apenas os N backups automáticos mais recentes.
// Backups manuais e pre-restore NUNCA são apagados aqui.
// ---------------------------------------------------------------------------
function aplicarRetencao() {
  const automaticos = listarBackups().filter((b) => b.tipo === 'automatico');
  if (automaticos.length <= RETENCAO_AUTOMATICOS) return { removidos: [] };

  const excedentes = automaticos.slice(RETENCAO_AUTOMATICOS);
  const removidos = [];
  for (const b of excedentes) {
    const full = path.join(BACKUP_DIR, b.arquivo);
    try {
      fs.unlinkSync(full);
      if (fs.existsSync(`${full}.meta.json`)) fs.unlinkSync(`${full}.meta.json`);
      removidos.push(b.arquivo);
    } catch (e) {
      console.error('Falha ao remover backup antigo:', b.arquivo, e.message);
    }
  }
  return { removidos };
}

// ---------------------------------------------------------------------------
// Configuração do backup automático
// ---------------------------------------------------------------------------

const CONFIG_PADRAO = { automatico: false, frequencia: 'diario', ultimaExecucao: null };

function lerConfig() {
  garantirPastaBackups();
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...CONFIG_PADRAO, ...cfg };
  } catch (_) {
    return { ...CONFIG_PADRAO };
  }
}

function salvarConfig(cfg) {
  garantirPastaBackups();
  const atual = lerConfig();
  const novo = { ...atual, ...cfg };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(novo, null, 2));
  return novo;
}

// Decide se já é hora de rodar um backup automático com base na frequência e
// na última execução. Usado tanto no agendador quanto na checagem de startup.
function precisaExecutarAutomatico(cfg) {
  if (!cfg.automatico) return false;
  if (!cfg.ultimaExecucao) return true;
  const agora = Date.now();
  const ultima = new Date(cfg.ultimaExecucao).getTime();
  if (isNaN(ultima)) return true;
  const intervaloMs = cfg.frequencia === 'semanal'
    ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return agora - ultima >= intervaloMs;
}

module.exports = {
  DB_PATH,
  BACKUP_DIR,
  TABELAS_ESSENCIAIS,
  RETENCAO_AUTOMATICOS,
  operacaoAtual,
  iniciarOperacao,
  finalizarOperacao,
  garantirPastaBackups,
  timestamp,
  caminhoUnico,
  criarBackupArquivo,
  metadadosDoBanco,
  validarBackupDb,
  validarBackupJson,
  listarBackups,
  ultimoBackup,
  aplicarRetencao,
  lerConfig,
  salvarConfig,
  precisaExecutarAutomatico
};

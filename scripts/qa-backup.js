// scripts/qa-backup.js
// Harness de QA da Etapa 4 (backup/restauração).
//
// SEGURANÇA: este script NUNCA toca no biblioteca.db real. Ele opera em uma
// pasta de QA temporária e restaura para um banco de teste próprio.
//
// Uso: node scripts/qa-backup.js
// Ao final, remove os arquivos temporários de QA.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const QA_DIR = path.join(os.tmpdir(), `qa-backup-${Date.now()}`);
fs.mkdirSync(QA_DIR, { recursive: true });

let passou = 0;
let falhou = 0;
function ok(nome) { passou++; console.log(`  ✔ ${nome}`); }
function falha(nome, err) { falhou++; console.log(`  ✘ ${nome} -> ${err && err.message ? err.message : err}`); }
function verifica(nome, cond, detalhe) {
  if (cond) ok(nome); else falha(nome, detalhe || 'condição falsa');
}

// ---------------------------------------------------------------------------
// 1) Banco de teste (fonte) - construído do zero, NÃO é o banco real.
// ---------------------------------------------------------------------------
const origemDb = path.join(QA_DIR, 'origem.db');
{
  const d = new Database(origemDb);
  d.pragma('journal_mode = WAL');
  d.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);`);
  d.exec(`CREATE TABLE alunos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, turma TEXT NOT NULL);`);
  d.exec(`CREATE TABLE livros (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, autor TEXT NOT NULL, categoria TEXT NOT NULL, acervo INTEGER NOT NULL DEFAULT 1);`);
  d.exec(`CREATE TABLE emprestimos (id INTEGER PRIMARY KEY AUTOINCREMENT, alunoId INTEGER NOT NULL, livroId INTEGER NOT NULL, dataRetirada DATE NOT NULL);`);
  d.exec(`CREATE TABLE relatorios (id INTEGER PRIMARY KEY AUTOINCREMENT, mensagem TEXT NOT NULL);`);
  d.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', 'x');
  d.prepare('INSERT INTO alunos (nome, turma) VALUES (?, ?)').run('Ana', '6A');
  d.prepare('INSERT INTO alunos (nome, turma) VALUES (?, ?)').run('Beto', '7B');
  d.prepare('INSERT INTO livros (titulo, autor, categoria) VALUES (?, ?, ?)').run('Dom Casmurro', 'Machado', 'Romance');
  d.prepare('INSERT INTO emprestimos (alunoId, livroId, dataRetirada) VALUES (?, ?, ?)').run(1, 1, '2026-09-01');
  d.close();
}

// ---------------------------------------------------------------------------
// 2) Carrega o serviço de backup apontando para a pasta de QA.
//    Para isso, copiamos o serviço e injetamos o ROOT via variável de ambiente
//    não é possível sem alterar o módulo; então reimplementamos os caminhos
//    usando um pequeno "patch" por monkeypatch de path.join? Não: em vez disso,
//    testamos o módulo real criando um symlink de pasta de trabalho isolada.
// ---------------------------------------------------------------------------

// Em vez de hackear o serviço, testamos suas funções puras diretamente e
// duplicamos o fluxo de arquivo num diretório QA. As funções de I/O do serviço
// usam ROOT = ../ do módulo; para não afetar o projeto, montamos um "projeto
// espelho" em QA_DIR com a mesma estrutura de pastas (backups/ e biblioteca.db).
const MIRROR = path.join(QA_DIR, 'projeto');
fs.mkdirSync(MIRROR, { recursive: true });
fs.mkdirSync(path.join(MIRROR, 'services'), { recursive: true });
fs.mkdirSync(path.join(MIRROR, 'scripts'), { recursive: true });

// Copia os serviços para o espelho (o ROOT deles será o MIRROR).
for (const f of ['services/backup.js', 'services/backupScheduler.js']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(MIRROR, f));
}
// biblioteca.db do espelho = cópia da origem
fs.copyFileSync(origemDb, path.join(MIRROR, 'biblioteca.db'));
for (const suf of ['-wal', '-shm']) {
  const s = origemDb + suf;
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(MIRROR, 'biblioteca.db' + suf));
}
// node_modules não existe no espelho: aponta para o do projeto via require cache
// (o espelho exige 'better-sqlite3', então criamos um node_modules simbólico).
fs.mkdirSync(path.join(MIRROR, 'node_modules'), { recursive: true });
for (const dep of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
  const src = path.join(ROOT, 'node_modules', dep);
  const dst = path.join(MIRROR, 'node_modules', dep);
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    try { fs.symlinkSync(src, dst, 'junction'); } catch (_) { fs.cpSync(src, dst, { recursive: true }); }
  }
}

const backup = require(path.join(MIRROR, 'services', 'backup.js'));
const Database2 = require('better-sqlite3');

async function main() {
console.log('\n=== QA: Serviço de Backup (Etapa 4) ===');
console.log('Pasta de QA:', QA_DIR, '\n');

// ---------------------------------------------------------------------------
console.log('[1] Criação de backup consistente (.db)');
const conn = new Database2(backup.DB_PATH);
conn.pragma('journal_mode = WAL');
const meta = await backup.criarBackupArquivo(conn, 'manual');
verifica('backup criado com nome esperado', /^biblioteca-backup-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(meta.arquivo), meta.arquivo);
verifica('arquivo existe', fs.existsSync(path.join(backup.BACKUP_DIR, meta.arquivo)));
verifica('arquivo não vazio', fs.statSync(path.join(backup.BACKUP_DIR, meta.arquivo)).size > 0);
verifica('metadados de contagens corretos', meta.contagens.livros === 1 && meta.contagens.alunos === 2 && meta.contagens.emprestimos === 1, JSON.stringify(meta.contagens));

// ---------------------------------------------------------------------------
console.log('[2] Nome único (não sobrescreve)');
const meta2 = await backup.criarBackupArquivo(conn, 'manual');
verifica('segundo backup tem nome diferente', meta2.arquivo !== meta.arquivo, `${meta.arquivo} vs ${meta2.arquivo}`);

// ---------------------------------------------------------------------------
console.log('[3] Validação de backup válido');
const v = backup.validarBackupDb(path.join(backup.BACKUP_DIR, meta.arquivo));
verifica('backup válido é aceito', v.valido === true);
verifica('validação retorna contagens', v.meta && v.meta.alunos === 2);

// ---------------------------------------------------------------------------
console.log('[4] Validação rejeita arquivo vazio');
const vazio = path.join(QA_DIR, 'vazio.db');
fs.writeFileSync(vazio, Buffer.alloc(0));
const vv = backup.validarBackupDb(vazio);
verifica('arquivo vazio recusado com motivo', vv.valido === false && /vazio/i.test(vv.motivo), JSON.stringify(vv));

// ---------------------------------------------------------------------------
console.log('[5] Validação rejeita banco de outro sistema');
const outro = path.join(QA_DIR, 'outro.db');
{ const d = new Database(outro); d.exec('CREATE TABLE x (id INTEGER)'); d.close(); }
const vo = backup.validarBackupDb(outro);
verifica('banco sem tabelas essenciais recusado', vo.valido === false && /incompat/i.test(vo.motivo), JSON.stringify(vo));

// ---------------------------------------------------------------------------
console.log('[6] Validação rejeita arquivo corrompido');
const corrompido = path.join(QA_DIR, 'corrompido.db');
fs.writeFileSync(corrompido, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from('lixo lixo lixo lixo')]));
const vc = backup.validarBackupDb(corrompido);
verifica('arquivo corrompido recusado', vc.valido === false, JSON.stringify(vc));

// ---------------------------------------------------------------------------
console.log('[7] Validação de JSON antigo');
const vJsonOk = backup.validarBackupJson({ alunos: [{}], livros: [{}], emprestimos: [] });
verifica('JSON com listas é aceito', vJsonOk.valido === true);
const vJsonBad = backup.validarBackupJson({ foo: 1 });
verifica('JSON inválido recusado', vJsonBad.valido === false);

// ---------------------------------------------------------------------------
console.log('[8] Histórico e último backup');
const lista = backup.listarBackups();
verifica('histórico contém os 2 backups manuais', lista.filter(b => b.tipo === 'manual').length === 2, String(lista.length));
const ult = backup.ultimoBackup();
verifica('último backup identificado', ult && ult.arquivo === meta2.arquivo, ult && ult.arquivo);

// ---------------------------------------------------------------------------
console.log('[9] Retenção: mantém no máximo 10 automáticos e nunca apaga manuais');
for (let i = 0; i < 13; i++) { await backup.criarBackupArquivo(conn, 'automatico'); }
const manuais = backup.listarBackups().filter(b => b.tipo === 'manual');
verifica('manuais preservados (2) antes da retenção', manuais.length === 2, String(manuais.length));
// A retenção é aplicada pelos chamadores (rota/scheduler), não pela criação.
const removidos = backup.aplicarRetencao();
const autoDepois = backup.listarBackups().filter(b => b.tipo === 'automatico');
verifica('retenção limita automáticos a 10', autoDepois.length === 10, String(autoDepois.length));
verifica('retenção removeu 3 excedentes', removidos.removidos.length === 3, String(removidos.removidos.length));
verifica('retenção não removeu nenhum manual', backup.listarBackups().filter(b => b.tipo === 'manual').length === 2);

// ---------------------------------------------------------------------------
console.log('[10] Config do backup automático e gatilho de frequência');
backup.salvarConfig({ automatico: true, frequencia: 'diario', ultimaExecucao: null });
let cfg = backup.lerConfig();
verifica('config salva (automatico/diario)', cfg.automatico === true && cfg.frequencia === 'diario');
verifica('executa quando nunca rodou', backup.precisaExecutarAutomatico(cfg) === true);
backup.salvarConfig({ ultimaExecucao: new Date().toISOString() });
cfg = backup.lerConfig();
verifica('não executa de novo no mesmo dia (diário)', backup.precisaExecutarAutomatico(cfg) === false);
backup.salvarConfig({ frequencia: 'semanal' });
verifica('semanal recente não executa', backup.precisaExecutarAutomatico(backup.lerConfig()) === false);
const antigo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
backup.salvarConfig({ ultimaExecucao: antigo });
verifica('semanal antigo (>7 dias) executa', backup.precisaExecutarAutomatico(backup.lerConfig()) === true);

// ---------------------------------------------------------------------------
console.log('[11] Concorrência: bloqueia operações simultâneas');
backup.iniciarOperacao('backup');
let bloqueou = false;
try { backup.iniciarOperacao('restauracao'); } catch (e) { bloqueou = e.code === 'OPERACAO_EM_ANDAMENTO'; }
verifica('segunda operação é bloqueada', bloqueou);
verifica('operacaoAtual reporta o tipo', backup.operacaoAtual().tipo === 'backup');
backup.finalizarOperacao();
verifica('após finalizar, libera', backup.operacaoAtual() === null);

// ---------------------------------------------------------------------------
console.log('[12] Restauração consistente num banco de teste (simulação)');
// Simula o fluxo: origem (backup) -> pre-restore -> troca de arquivo.
const connFechar = conn;
// Cria pre-restore
const pre = await backup.criarBackupArquivo(connFechar, 'pre-restore');
verifica('pre-restore criado', pre.arquivo.startsWith('pre-restore-'), pre.arquivo);

// Altera o banco atual (simula dados novos)
connFechar.prepare('INSERT INTO alunos (nome, turma) VALUES (?, ?)').run('Novo', '8A');
const antes = connFechar.prepare('SELECT COUNT(*) c FROM alunos').get().c;
verifica('banco alterado para 3 alunos antes da restauração', antes === 3, String(antes));

// Restaura do backup original (meta.arquivo) por troca de arquivo
connFechar.pragma('wal_checkpoint(TRUNCATE)');
connFechar.close();
for (const suf of ['-wal', '-shm']) { const f = backup.DB_PATH + suf; if (fs.existsSync(f)) fs.unlinkSync(f); }
fs.copyFileSync(path.join(backup.BACKUP_DIR, meta.arquivo), backup.DB_PATH);
const connDepois = new Database2(backup.DB_PATH);
const depois = connDepois.prepare('SELECT COUNT(*) c FROM alunos').get().c;
verifica('restauração devolve o estado do backup (2 alunos)', depois === 2, String(depois));
const conteudo = connDepois.prepare('SELECT nome FROM alunos ORDER BY id').all().map(r => r.nome).join(',');
verifica('conteúdo restaurado íntegro (Ana,Beto)', conteudo === 'Ana,Beto', conteudo);
connDepois.close();

// ---------------------------------------------------------------------------
console.log('\n=== Resultado ===');
console.log(`Passou: ${passou} | Falhou: ${falhou}`);

// Limpeza dos temporários de QA
try { fs.rmSync(QA_DIR, { recursive: true, force: true }); console.log('Temporários de QA removidos.'); } catch (e) { console.log('Aviso ao limpar QA:', e.message); }

return falhou === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error('Erro inesperado no QA:', e); process.exit(1); });

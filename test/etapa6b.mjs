// test/etapa6b.mjs - Etapa 6B: testes isolados de matrícula + importação DED.
// NUNCA toca no biblioteca.db real: cria banco temporário em tmp dir.
// Uso: node test/etapa6b.mjs
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ded = require('../services/ded.js');

let passos = 0, falhas = 0;
function ok(cond, nome) {
  if (cond) { passos++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ FALHOU: ${nome}`); }
}
function secao(t) { console.log(`\n== ${t} ==`); }

// Banco temporário com o MESMO schema/migração de db.js (aditivo, idempotente).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-test-6b-'));
const db = new Database(path.join(dir, 'teste.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS alunos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    turma TEXT NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS emprestimos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alunoId INTEGER NOT NULL,
    livroId INTEGER NOT NULL,
    dataRetirada DATE NOT NULL,
    devolvido BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY (alunoId) REFERENCES alunos(id)
  );
`);
try { db.exec('ALTER TABLE alunos ADD COLUMN matricula TEXT'); } catch (e) {}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_alunos_matricula ON alunos(matricula) WHERE matricula IS NOT NULL`);
db.exec(`CREATE TABLE IF NOT EXISTS ded_turma_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turma_ded TEXT NOT NULL UNIQUE,
  turma_sistema TEXT,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ============================================================
// 1. MIGRAÇÃO
// ============================================================
secao('Migração preserva alunos antigos');
db.prepare("INSERT INTO alunos (nome, turma) VALUES ('Aluno Antigo', '3°A')").run();
const colunas = db.prepare("PRAGMA table_info(alunos)").all().map(c => c.name);
ok(colunas.includes('matricula'), 'coluna matricula existe');
const alunoAntigo = db.prepare("SELECT * FROM alunos WHERE nome = 'Aluno Antigo'").get();
ok(alunoAntigo && alunoAntigo.id > 0 && alunoAntigo.matricula === null, 'aluno antigo preservado com matricula NULL');

// Migração idempotente: rodar de novo não quebra.
let segundoTry = false;
try { db.exec('ALTER TABLE alunos ADD COLUMN matricula TEXT'); } catch (_) { segundoTry = true; }
ok(segundoTry, 'migração é idempotente (coluna já existente não recria)');

// ============================================================
// 2. NORMALIZAÇÃO DE MATRÍCULA
// ============================================================
secao('Normalização de matrícula');
ok(ded.normalizarMatricula(' 9268417 ').valor === '9268417', 'trim simples');
ok(ded.normalizarMatricula('0012345').valor === '0012345', 'zeros à esquerda preservados (texto)');
ok(ded.normalizarMatricula('000123').valor === '000123', '000123 preservado');
ok(ded.normalizarMatricula('ABC123').invalida === true, 'ABC123 inválida');
ok(ded.normalizarMatricula('123-456').invalida === true, '123-456 inválida');
ok(ded.normalizarMatricula('   ').valor === null && !ded.normalizarMatricula('   ').invalida, 'vazia => NULL (não inválida)');

// ============================================================
// 3. UNICIDADE
// ============================================================
secao('Unicidade de matrícula');
db.prepare("INSERT INTO alunos (nome, turma, matricula) VALUES ('Aluno A', '3°A', '0012345')").run();
let rejeitou = false;
try { db.prepare("INSERT INTO alunos (nome, turma, matricula) VALUES ('Aluno B', '3°B', '0012345')").run(); }
catch (e) { rejeitou = /UNIQUE/.test(e.message); }
ok(rejeitou, 'matrícula duplicada rejeitada pelo índice único');
ok(db.prepare("SELECT COUNT(*) c FROM alunos WHERE matricula='0012345'").get().c === 1, 'banco não corrompido (1 linha)');
// NULL pode repetir:
db.prepare("INSERT INTO alunos (nome, turma) VALUES ('Sem Matricula 1', '1°A')").run();
db.prepare("INSERT INTO alunos (nome, turma) VALUES ('Sem Matricula 2', '1°B')").run();
ok(true, 'múltiplos NULL permitidos (alunos antigos)');

// ============================================================
// 4. REIMPORTAÇÃO / PRESERVAÇÃO DE ID E HISTÓRICO
// ============================================================
secao('Reimportação preserva id, histórico e empréstimos');
db.exec("CREATE TABLE IF NOT EXISTS livros (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT)");
db.prepare("INSERT INTO livros (titulo) VALUES ('Livro Teste')").run();
const r10 = db.prepare("INSERT INTO alunos (nome, turma, matricula) VALUES ('João', '3°A', '1234567')").run();
const id10 = r10.lastInsertRowid;
db.prepare("INSERT INTO emprestimos (alunoId, livroId, dataRetirada) VALUES (?, 1, '2026-01-10')").run(id10);
const empAntes = db.prepare('SELECT * FROM emprestimos WHERE alunoId = ?').get(id10);

// Simula o UPDATE que a importação faz (mesmo statement de routes/ded.js):
db.prepare('UPDATE alunos SET nome = ?, turma = ? WHERE id = ?').run('João Silva', '3°B', id10);
const depois = db.prepare('SELECT * FROM alunos WHERE id = ?').get(id10);
ok(depois.id === id10, 'aluno.id preservado');
ok(depois.nome === 'João Silva', 'nome atualizado');
ok(depois.turma === '3°B', 'turma atualizada');
ok(depois.matricula === '1234567', 'matrícula preservada');
const empDepois = db.prepare('SELECT * FROM emprestimos WHERE alunoId = ?').get(id10);
ok(empDepois && empDepois.id === empAntes.id && empDepois.alunoId === id10, 'empréstimo intacto (mesmo id e alunoId)');

// ============================================================
// 5. PARSE / ENCODING / SEPARADORES
// ============================================================
secao('Parser DED');
const csv = ded.parseArquivo(ded.decodificarArquivo(Buffer.from('matrícula,nome,turma\n9268417,JOÃO SILVA,3º INFORMÁTICA EM INT 1', 'utf8')));
ok(csv.ok && csv.linhas.length === 1, 'CSV com cabeçalho parseado');
ok(csv.linhas[0].nome === 'JOÃO SILVA', 'acentos preservados (UTF-8)');

const bom = ded.parseArquivo(ded.decodificarArquivo(Buffer.from('\uFEFFmatrícula,nome,turma\n9268417,MAÍRA,3º X', 'utf8')));
ok(bom.ok && bom.linhas[0].nome === 'MAÍRA', 'BOM removido e acentos preservados');

const latin1 = ded.parseArquivo(ded.decodificarArquivo(Buffer.from('9268417,FRANCISCO AÇOR,3º X', 'latin1')));
ok(latin1.ok && latin1.linhas[0].nome === 'FRANCISCO AÇOR', 'fallback Latin-1 sem corromper');

const tsv = ded.parseArquivo(ded.decodificarArquivo(Buffer.from('matricula\tnome\tturma\n123\tANA BEATRIZ\t3X', 'utf8')));
ok(tsv.ok && tsv.separador === '\t' && tsv.linhas[0].nome === 'ANA BEATRIZ', 'TAB detectado');

const pvi = ded.parseArquivo(ded.decodificarArquivo(Buffer.from('matricula;nome;turma\n123;AÇÃO;3X', 'utf8')));
ok(pvi.ok && pvi.separador === ';' && pvi.linhas[0].nome === 'AÇÃO', 'ponto e vírgula detectado');

const semCab = ded.parseArquivo(ded.decodificarArquivo(Buffer.from('9268417,ANA BEATRIZ ARRUDA FIGUEIREDO,3º INFORMÁTICA EM INT 1', 'utf8')));
ok(semCab.ok && !semCab.comCabecalho && semCab.linhas[0].matricula === '9268417' && semCab.linhas[0].nome === 'ANA BEATRIZ ARRUDA FIGUEIREDO' && semCab.linhas[0].turmaDed === '3º INFORMÁTICA EM INT 1', 'sem cabeçalho: ordem matrícula,nome,turma');

const cabMaiusc = ded.parseArquivo(ded.decodificarArquivo(Buffer.from('MATRÍCULA,NOME,TURMA\n1,X,Y', 'utf8')));
ok(cabMaiusc.ok && cabMaiusc.comCabecalho && cabMaiusc.linhas[0].nome === 'X', 'cabeçalho em maiúsculas com acento reconhecido');

const vazio = ded.parseArquivo('');
ok(!vazio.ok && /vazio/i.test(vazio.erro), 'arquivo vazio rejeitado');

const espacos = ded.parseArquivo(ded.decodificarArquivo(Buffer.from(' 9268417 ,  ANA   BEATRIZ ARRUDA  , 3º X ', 'utf8')));
ok(espacos.ok && espacos.linhas[0].matricula === '9268417' && espacos.linhas[0].nome === 'ANA BEATRIZ ARRUDA', 'espaços extras normalizados');

// ============================================================
// 6. DUPLICIDADE NO ARQUIVO / MAPEAMENTO
// ============================================================
secao('Duplicidade no arquivo');
const dedDup = ded.parseArquivo(ded.decodificarArquivo(Buffer.from(
  '123456,JOÃO,3º INFORMÁTICA EM INT 1\n123456,JOÃO SILVA,3º INFORMÁTICA EM INT 2', 'utf8')));
const cont = new Map();
for (const l of dedDup.linhas) if (l.matricula) cont.set(l.matricula, (cont.get(l.matricula) || 0) + 1);
ok(cont.get('123456') === 2, 'duplicidade no arquivo detectada (2 ocorrências)');

secao('Turmas distintas');
const turmas = ded.turmasDistintas(dedDup.linhas);
ok(turmas.length === 2 && turmas.includes('3º INFORMÁTICA EM INT 1') && turmas.includes('3º INFORMÁTICA EM INT 2'), 'turmas do DED detectadas');

secao('Mapeamento persistente');
db.prepare("INSERT INTO ded_turma_map (turma_ded, turma_sistema) VALUES (?, ?)").run('3º INFORMÁTICA EM INT 1', '3°A');
const mapa = db.prepare("SELECT turma_sistema FROM ded_turma_map WHERE turma_ded = ?").get('3º INFORMÁTICA EM INT 1');
ok(mapa && mapa.turma_sistema === '3°A', 'mapeamento salvo e recuperável');
db.prepare(`INSERT INTO ded_turma_map (turma_ded, turma_sistema) VALUES (?, ?)
  ON CONFLICT(turma_ded) DO UPDATE SET turma_sistema = excluded.turma_sistema`).run('3º INFORMÁTICA EM INT 1', '3°B');
ok(db.prepare("SELECT turma_sistema FROM ded_turma_map WHERE turma_ded = ?").get('3º INFORMÁTICA EM INT 1').turma_sistema === '3°B', 'upsert atualiza mapeamento');

// ============================================================
// 7. INTEGRIDADE
// ============================================================
secao('Integridade');
ok(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'integrity_check ok no banco de teste');

db.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n========== RESULTADO: ${passos} passaram, ${falhas} falharam ==========`);
process.exit(falhas ? 1 : 0);

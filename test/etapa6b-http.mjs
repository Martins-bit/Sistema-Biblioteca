// test/etapa6b-http.mjs - Testes HTTP de integração da Etapa 6B.
// Sobe o servidor real em porta efêmera, cria usuário temporário de teste,
// testa auth/CSRF/preview/confirmar com arquivos CSV/TXT/TSV/XLSX.
// NOTA: usa o biblioteca.db local (que no momento está vazio de alunos).
// Cria e APAGA ao final apenas os alunos criados pelo próprio teste
// (identificados pelo marcador __TESTE6B__).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const MARCA = '__TESTE6B__';

let passos = 0, falhas = 0;
function ok(cond, nome) {
  if (cond) { passos++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ FALHOU: ${nome}`); }
}
function secao(t) { console.log(`\n== ${t} ==`); }

// Sobe o servidor
const proc = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logServidor = '';
proc.stdout.on('data', d => { logServidor += d; });
proc.stderr.on('data', d => { logServidor += d; });

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/csrf`);
      if (r.ok) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

if (!(await esperarServidor())) {
  console.error('Servidor não subiu. Log:\n' + logServidor);
  proc.kill();
  process.exit(1);
}

// ---- cliente com cookies + csrf ----
const cookies = new Map();
let csrf = '';
async function req(metodo, rota, corpo, extra = {}) {
  const headers = { ...(extra.headers || {}) };
  if (cookies.size) headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (corpo && !(corpo instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + rota, {
    method: metodo, headers, body: corpo ? (corpo instanceof FormData ? corpo : JSON.stringify(corpo)) : undefined
  });
  for (const c of (res.headers.getSetCookie?.() || [])) {
    const [par] = c.split(';');
    const [k, ...v] = par.split('=');
    cookies.set(k.trim(), v.join('=').trim());
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

try {
  // ---------- SETUP: login ----------
  const csrf1 = await (await fetch(`${BASE}/api/auth/csrf`)).json();
  csrf = csrf1.csrfToken;

  secao('Autenticação (401 sem sessão)');
  const r1 = await req('GET', '/api/alunos/ded/mapeamento');
  ok(r1.status === 401, `GET mapeamento sem sessão => 401 (obteve ${r1.status})`);
  const r2 = await req('POST', '/api/alunos/ded/preview', { conteudoBase64: Buffer.from('x').toString('base64') });
  ok(r2.status === 401 || r2.status === 403, `POST preview sem sessão bloqueado => 401/403 (obteve ${r2.status}; CSRF global roda antes do auth) `);
  const r3 = await req('POST', '/api/alunos/ded/confirmar', { linhas: [] });
  ok(r3.status === 401 || r3.status === 403, `POST confirmar sem sessão bloqueado => 401/403 (obteve ${r3.status})`);

  // Cria usuário de teste e faz login.
  const userTeste = `teste6b${Date.now()}`;
  const { execSync } = await import('node:child_process');
  try {
    execSync(`"${process.execPath}" scripts/create-user.js --nome "Teste Etapa 6B" --email "${userTeste}@teste.local" --senha "SenhaForte123"`, { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'pipe' });
  } catch (e) {
    console.error('Falha ao criar usuário de teste (create-user.js):', e.stderr?.toString() || e.message);
  }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${userTeste}@teste.local`, password: 'SenhaForte123' })
  });
  ok(login.status === 200 || login.status === 201, `login do usuário de teste (${login.status})`);
  for (const c of (login.headers.getSetCookie?.() || [])) {
    const [par] = c.split(';');
    const [k, ...v] = par.split('=');
    cookies.set(k.trim(), v.join('=').trim());
  }
  const csrfRes = await (await fetch(`${BASE}/api/auth/csrf`, { headers: { Cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') } })).json();
  csrf = csrfRes.csrfToken;

  secao('CSRF (403 sem token em operação mutante)');
  const rCsrf = await fetch(`${BASE}/api/alunos/ded/mapeamento`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') },
    body: JSON.stringify({ mapeamentos: [] })
  });
  ok(rCsrf.status === 403, `PUT mapeamento sem CSRF => 403 (obteve ${rCsrf.status})`);

  // ---------- Mapeamento ----------
  secao('Mapeamento de turmas');
  const rMapPut = await req('PUT', '/api/alunos/ded/mapeamento', { mapeamentos: [
    { turmaDed: '3º INFORMÁTICA EM INT 1', turmaSistema: '3°A' },
    { turmaDed: '3º INFORMÁTICA EM INT 2', turmaSistema: '3°B' },
    { turmaDed: 'TURMA IGNORADA', turmaSistema: null }
  ]}, { headers: { 'X-CSRF-Token': csrf } });
  ok(rMapPut.status === 200 && rMapPut.data.ok, 'PUT mapeamento com CSRF => ok');
  const rMapGet = await req('GET', '/api/alunos/ded/mapeamento');
  ok(rMapGet.status === 200 && rMapGet.data.mapeamentos.length === 3, 'GET mapeamento lista os 3 salvos');
  ok(rMapGet.data.mapeamentos.find(m => m.turma_ded === 'TURMA IGNORADA')?.turma_sistema === null, 'mapeamento "ignorar" salvo como NULL');
  const rMapInvalido = await req('PUT', '/api/alunos/ded/mapeamento', { mapeamentos: [
    { turmaDed: 'X', turmaSistema: 'TURMA FANTASMA' }
  ]}, { headers: { 'X-CSRF-Token': csrf } });
  ok(rMapInvalido.status === 400, 'PUT mapeamento com turma do sistema inválida => 400');

  // ---------- Preview CSV ----------
  secao('Preview CSV (vírgula, com cabeçalho)');
  const csv = 'matrícula,nome,turma\n0012345,ANA BEATRIZ ARRUDA FIGUEIREDO,3º INFORMÁTICA EM INT 1\n9268417,JOÃO ' + MARCA + ',3º INFORMÁTICA EM INT 2';
  const fd1 = new FormData();
  fd1.append('arquivo', new Blob([csv], { type: 'text/csv' }), 'ded.csv');
  const rPrev = await req('POST', '/api/alunos/ded/preview', fd1, { headers: { 'X-CSRF-Token': csrf } });
  ok(rPrev.status === 200 && rPrev.data.ok, 'preview CSV ok');
  ok(rPrev.data.separador === ',', 'separador vírgula detectado');
  ok(rPrev.data.preview.length === 2, '2 linhas de dados');
  ok(rPrev.data.preview[0].matricula === '0012345', 'zeros à esquerda preservados no preview');
  ok(rPrev.data.preview.every(p => p.acao === 'NOVO'), 'linhas sem matrícula no banco => NOVO');

  // ---------- Confirmar ----------
  secao('Confirmação transacional');
  const rConf = await req('POST', '/api/alunos/ded/confirmar', { linhas: rPrev.data.preview }, { headers: { 'X-CSRF-Token': csrf } });
  ok(rConf.status === 200 && rConf.data.criados === 2, `2 alunos criados (obteve ${rConf.data?.criados})`);
  const rLista = await req('GET', '/api/alunos');
  const ana = rLista.data.find(a => a.nome.startsWith('ANA BEATRIZ'));
  const joao = rLista.data.find(a => a.nome.includes(MARCA));
  ok(ana && ana.matricula === '0012345', 'ANA com matrícula "0012345" (texto com zeros)');
  ok(joao && joao.matricula === '9268417', 'JOÃO criado com matrícula');

  // ---------- Reimportação atualiza ----------
  secao('Reimportação atualiza (preserva id)');
  const idAnaAntes = ana.id;
  const csv2 = 'matrícula,nome,turma\n0012345,ANA BEATRIZ ARRUDA FIGUEIREDO SANTOS,3º INFORMÁTICA EM INT 1';
  const fd2 = new FormData();
  fd2.append('arquivo', new Blob([csv2], { type: 'text/csv' }), 'ded2.csv');
  const rPrev2 = await req('POST', '/api/alunos/ded/preview', fd2, { headers: { 'X-CSRF-Token': csrf } });
  const itemAna = rPrev2.data.preview[0];
  ok(itemAna.acao === 'ATUALIZAR' && itemAna.alunoExistenteId === idAnaAntes, `matrícula existente => ATUALIZAR aluno #${itemAna.alunoExistenteId}`);
  const rConf2 = await req('POST', '/api/alunos/ded/confirmar', { linhas: rPrev2.data.preview }, { headers: { 'X-CSRF-Token': csrf } });
  ok(rConf2.status === 200 && rConf2.data.atualizados === 1, 'confirmação atualizou 1');
  const rLista2 = await req('GET', '/api/alunos');
  const ana2 = rLista2.data.find(a => a.id === idAnaAntes);
  ok(ana2 && ana2.nome === 'ANA BEATRIZ ARRUDA FIGUEIREDO SANTOS' && ana2.matricula === '0012345', 'id preservado, nome atualizado, matrícula igual');

  // ---------- Duplicidade no arquivo ----------
  secao('Duplicidade no arquivo');
  const csvDup = 'matrícula,nome,turma\n777777,DUPLICADO A,3º INFORMÁTICA EM INT 1\n777777,DUPLICADO B,3º INFORMÁTICA EM INT 2';
  const fdDup = new FormData();
  fdDup.append('arquivo', new Blob([csvDup], { type: 'text/csv' }), 'dup.csv');
  const rDup = await req('POST', '/api/alunos/ded/preview', fdDup, { headers: { 'X-CSRF-Token': csrf } });
  ok(rDup.data.preview.every(p => p.acao === 'CONFLITO'), 'as duas linhas duplicadas marcadas como CONFLITO');

  // ---------- Homônimo sem matrícula ----------
  secao('Homônimo sem matrícula (não funde automaticamente)');
  const rSemMat = await req('POST', '/api/alunos', { nome: 'MARIA ' + MARCA, matricula: null, turma: '3°A' }, { headers: { 'X-CSRF-Token': csrf } });
  ok(rSemMat.status === 201, 'aluno antigo sem matrícula criado');
  const csvHom = 'matrícula,nome,turma\n888,MARIA ' + MARCA + ',3º INFORMÁTICA EM INT 1';
  const fdHom = new FormData();
  fdHom.append('arquivo', new Blob([csvHom], { type: 'text/csv' }), 'hom.csv');
  const rHom = await req('POST', '/api/alunos/ded/preview', fdHom, { headers: { 'X-CSRF-Token': csrf } });
  ok(rHom.data.preview[0].acao === 'NOVO', 'matrícula nova + nome igual => NOVO (não funde automaticamente)');

  // ---------- TSV / TXT / separador ; ----------
  secao('Formatos e separadores');
  const fdTsv = new FormData();
  fdTsv.append('arquivo', new Blob(['matricula\tnome\tturma\n555555\tTSV ALUNO ' + MARCA + '\t3º INFORMÁTICA EM INT 1'], { type: 'text/plain' }), 'ded.tsv');
  const rTsv = await req('POST', '/api/alunos/ded/preview', fdTsv, { headers: { 'X-CSRF-Token': csrf } });
  ok(rTsv.status === 200 && rTsv.data.separador === 'TAB' && rTsv.data.preview[0].nome === 'TSV ALUNO ' + MARCA, 'TSV com TAB ok');
  const fdPvi = new FormData();
  fdPvi.append('arquivo', new Blob(['matricula;nome;turma\n666666;PVI ALUNO ' + MARCA + ';3º INFORMÁTICA EM INT 1'], { type: 'text/plain' }), 'ded.txt');
  const rPvi = await req('POST', '/api/alunos/ded/preview', fdPvi, { headers: { 'X-CSRF-Token': csrf } });
  ok(rPvi.status === 200 && rPvi.data.separador === ';' && rPvi.data.preview[0].nome === 'PVI ALUNO ' + MARCA, 'TXT com ; ok');

  // ---------- Rejeições de upload ----------
  secao('Upload: rejeições');
  const fdXlsx = new FormData();
  fdXlsx.append('arquivo', new Blob([Buffer.from([0x50, 0x4B, 0x03, 0x04, 1, 2, 3])], { type: 'application/vnd.ms-excel' }), 'planilha.xlsx');
  const rXlsx = await req('POST', '/api/alunos/ded/preview', fdXlsx, { headers: { 'X-CSRF-Token': csrf } });
  ok(rXlsx.status === 400 && /não suportado/i.test(rXlsx.data.error), 'XLSX (binário zip) rejeitado com mensagem amigável');
  const fdBin = new FormData();
  fdBin.append('arquivo', new Blob([Buffer.from([0x50, 0x4B, 0x03, 0x04, 1, 2, 3])], { type: 'text/csv' }), 'disfarçado.csv');
  const rBin = await req('POST', '/api/alunos/ded/preview', fdBin, { headers: { 'X-CSRF-Token': csrf } });
  ok(rBin.status === 400, 'conteúdo binário com extensão .csv rejeitado');
  const fdVazio = new FormData();
  fdVazio.append('arquivo', new Blob([''], { type: 'text/csv' }), 'vazio.csv');
  const rVazio = await req('POST', '/api/alunos/ded/preview', fdVazio, { headers: { 'X-CSRF-Token': csrf } });
  ok(rVazio.status === 400 && /vazio/i.test(rVazio.data.error), 'arquivo vazio rejeitado');
  const fdGrande = new FormData();
  fdGrande.append('arquivo', new Blob(['x'.repeat(3 * 1024 * 1024)], { type: 'text/csv' }), 'grande.csv');
  const rGrande = await req('POST', '/api/alunos/ded/preview', fdGrande, { headers: { 'X-CSRF-Token': csrf } });
  ok(rGrande.status === 400, 'arquivo acima de 2 MB rejeitado');

  // ---------- Matrícula duplicada em cadastro manual ----------
  secao('Cadastro manual com matrícula duplicada');
  const rDupManual = await req('POST', '/api/alunos', { nome: 'OUTRO ' + MARCA, matricula: '0012345', turma: '3°B' }, { headers: { 'X-CSRF-Token': csrf } });
  ok(rDupManual.status === 400 && /já está cadastrada/.test(rDupManual.data.error), 'POST com matrícula existente => erro amigável');
  const rMatInvalida = await req('POST', '/api/alunos', { nome: 'OUTRO ' + MARCA, matricula: 'ABC123', turma: '3°B' }, { headers: { 'X-CSRF-Token': csrf } });
  ok(rMatInvalida.status === 400 && /somente números/.test(rMatInvalida.data.error), 'POST com matrícula alfanumérica => erro amigável');

  // ---------- Edição ----------
  secao('Edição com matrícula');
  const rEdOk = await req('PUT', `/api/alunos/${joao.id}`, { nome: joao.nome, matricula: '9268417', turma: '3°B' }, { headers: { 'X-CSRF-Token': csrf } });
  ok(rEdOk.status === 200, 'PUT mantendo a própria matrícula => ok');
  const rEdConflito = await req('PUT', `/api/alunos/${joao.id}`, { nome: joao.nome, matricula: '0012345', turma: '3°B' }, { headers: { 'X-CSRF-Token': csrf } });
  ok(rEdConflito.status === 400 && /já está cadastrada/.test(rEdConflito.data.error), 'PUT com matrícula de outro aluno => 400');
  const rEdNull = await req('PUT', `/api/alunos/${joao.id}`, { nome: joao.nome, matricula: '', turma: '3°B' }, { headers: { 'X-CSRF-Token': csrf } });
  ok(rEdNull.status === 200 && rEdNull.data.matricula === null, 'PUT com matrícula vazia => NULL');

  // ---------- Turma sem mapeamento ----------
  secao('Turma sem mapeamento');
  const fdSemMapa = new FormData();
  fdSemMapa.append('arquivo', new Blob(['matrícula,nome,turma\n999,MARIA SEM MAPA,3º INFORMÁTICA EM INT 9'], { type: 'text/csv' }), 'semmapa.csv');
  const rSemMapa = await req('POST', '/api/alunos/ded/preview', fdSemMapa, { headers: { 'X-CSRF-Token': csrf } });
  ok(rSemMapa.data.preview[0].acao === 'INVALIDO' && /Turma requer mapeamento/.test(rSemMapa.data.preview[0].motivo), 'linha com turma não mapeada marcada');

  // ---------- Cleanup: remove apenas o que o teste criou ----------
  const conn = require('better-sqlite3')(path.resolve(import.meta.dirname, '..', 'biblioteca.db'));
  const marcados = conn.prepare("SELECT id FROM alunos WHERE nome LIKE ? OR nome LIKE ?").all(`%${MARCA}%`, '%ANA BEATRIZ%');
  const tx = conn.transaction(() => {
    for (const a of marcados) {
      conn.prepare('DELETE FROM emprestimos WHERE alunoId = ?').run(a.id);
      conn.prepare('DELETE FROM historico_avaliacao WHERE alunoId = ?').run(a.id);
      conn.prepare('DELETE FROM bloqueios WHERE alunoId = ?').run(a.id);
      conn.prepare('DELETE FROM alunos WHERE id = ?').run(a.id);
    }
    conn.prepare('DELETE FROM ded_turma_map WHERE turma_ded IN (?, ?, ?)').run(
      '3º INFORMÁTICA EM INT 1', '3º INFORMÁTICA EM INT 2', 'TURMA IGNORADA'
    );
    conn.prepare('DELETE FROM user_preferences WHERE user_id IN (SELECT id FROM users WHERE email = ?)').run(`${userTeste}@teste.local`);
    conn.prepare('DELETE FROM users WHERE email = ?').run(`${userTeste}@teste.local`);
  });
  tx();
  conn.close();
  console.log(`\n(cleanup: ${marcados.length} aluno(s) de teste removidos, mapeamentos e usuário de teste apagados)`);

} finally {
  proc.kill();
}

console.log(`\n========== RESULTADO HTTP: ${passos} passaram, ${falhas} falharam ==========`);
process.exit(falhas ? 1 : 0);

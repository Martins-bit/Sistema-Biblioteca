// test/etapa7.mjs - Etapa 7: testes HTTP de empréstimos + reputação + matrícula.
// Roda num ESPELHO ISOLADO em tmpdir (nunca no biblioteca.db real):
// copia o projeto, symlink node_modules e sobe o servidor numa porta efêmera.
// Uso: node test/etapa7.mjs
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = path.join(os.tmpdir(), `biblioteca-etapa7-${Date.now()}`);
const PORT = '3777';
const BASE = `http://127.0.0.1:${PORT}`;

let passos = 0, falhas = 0;
function ok(cond, nome) {
  if (cond) { passos++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ FALHOU: ${nome}`); }
}
function secao(t) { console.log(`\n== ${t} ==`); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dia = (delta) => {
  const d = new Date(); d.setDate(d.getDate() + delta);
  return d.toISOString().split('T')[0];
};

function prepararEspelho() {
  fs.mkdirSync(MIRROR, { recursive: true });
  for (const item of ['server.js', 'db.js', 'middleware', 'routes', 'services', 'public', 'package.json', 'scripts']) {
    const src = path.join(ROOT, item);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(MIRROR, item), { recursive: true });
  }
  const nmSrc = path.join(ROOT, 'node_modules');
  const nmDst = path.join(MIRROR, 'node_modules');
  try { fs.symlinkSync(nmSrc, nmDst, 'junction'); } catch (_) { fs.cpSync(nmSrc, nmDst, { recursive: true }); }
}

// ---- servidor ----
prepararEspelho();
const proc = spawn(process.execPath, ['server.js'], {
  cwd: MIRROR,
  env: { ...process.env, PORT, SESSION_SECRET: 'etapa7-teste' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
proc.stdout.on('data', d => { log += d; });
proc.stderr.on('data', d => { log += d; });

async function esperarServidor() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/auth/csrf`);
      if (r.ok) return true;
    } catch (_) {}
    await sleep(250);
  }
  return false;
}

// ---- cliente com cookie + CSRF ----
const cookies = new Map();
let csrf = '';
async function req(metodo, rota, corpo, extra = {}) {
  const headers = { ...(extra.headers || {}) };
  if (cookies.size) headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (corpo && !(corpo instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + rota, {
    method: metodo, headers,
    body: corpo ? (corpo instanceof FormData ? corpo : JSON.stringify(corpo)) : undefined
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

function capturarSessao(res) {
  for (const c of (res.headers.getSetCookie?.() || [])) {
    const [par] = c.split(';');
    const [k, ...v] = par.split('=');
    cookies.set(k.trim(), v.join('=').trim());
  }
}

async function renovarCsrf() {
  csrf = (await (await fetch(`${BASE}/api/auth/csrf`, {
    headers: { Cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
  })).json()).csrfToken;
}

const emprestar = (alunoId, livroId, extra = {}) =>
  req('POST', '/api/emprestimos', { alunoId, livroId, ...extra }, { headers: { 'X-CSRF-Token': csrf } });
const devolver = (id, extra = {}) =>
  req('PUT', `/api/emprestimos/${id}`, extra, { headers: { 'X-CSRF-Token': csrf } });
const notaDe = async (alunoId) => (await req('GET', `/api/alunos/${alunoId}/reputacao`)).data;

// === PARTE 2 (testes funcionais) ===

try {
  secao('Setup');
  if (!(await esperarServidor())) {
    console.error('Servidor não subiu. Log:\n' + log);
    process.exit(1);
  }
  ok(true, 'servidor de espelho subiu em porta efêmera');

  const csrf1 = await (await fetch(`${BASE}/api/auth/csrf`)).json();
  csrf = csrf1.csrfToken;

  const userTeste = `etapa7${Date.now()}`;
  try {
    execSync(`"${process.execPath}" scripts/create-user.js --nome "Teste Etapa 7" --email "${userTeste}@teste.local" --senha "SenhaForte123"`, { cwd: MIRROR, stdio: 'pipe' });
  } catch (e) {
    console.error('Falha ao criar usuário de teste:', e.stderr?.toString() || e.message);
  }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${userTeste}@teste.local`, password: 'SenhaForte123' })
  });
  ok(login.status === 200 || login.status === 201, 'login do usuário de teste');
  capturarSessao(login);
  await renovarCsrf();

  // Dados: 2 alunos (um com matrícula), 1 livro de acervo 1, 1 livro de acervo alto
  const a1 = (await req('POST', '/api/alunos', { nome: 'ANA EMPRESTIMO', matricula: '0012345', turma: '3°A' }, { headers: { 'X-CSRF-Token': csrf } })).data;
  const a2 = (await req('POST', '/api/alunos', { nome: 'BRUNO EMPRESTIMO', matricula: null, turma: '3°B' }, { headers: { 'X-CSRF-Token': csrf } })).data;
  const l1 = (await req('POST', '/api/livros', { titulo: 'Livro Unico E7', autor: 'Autor E7', categoria: 'Teste', acervo: 1, isbn: '9788501111111' }, { headers: { 'X-CSRF-Token': csrf } })).data;
  const l2 = (await req('POST', '/api/livros', { titulo: 'Livro Multi E7', autor: 'Autor Multi', categoria: 'Teste', acervo: 10, isbn: null }, { headers: { 'X-CSRF-Token': csrf } })).data;
  ok(a1 && a1.id > 0 && a1.matricula === '0012345', 'aluno A criado com matrícula (texto, zeros preservados)');
  ok(a2 && a2.id > 0 && a2.matricula === null, 'aluno B criado sem matrícula');
  ok(l1 && l1.id > 0 && l1.isbn === '9788501111111', 'livro único criado com ISBN');
  ok(l2 && l2.id > 0, 'livro multi-exemplar criado');

  // ---------- Segurança ----------
  secao('Segurança (auth/CSRF)');
  cookies.clear();
  const r401 = await req('GET', '/api/emprestimos');
  ok(r401.status === 401, 'GET /api/emprestimos sem sessão => 401');
  const r403 = await req('POST', '/api/emprestimos', { alunoId: 1, livroId: 1 });
  ok(r403.status === 403, 'POST /api/emprestimos sem CSRF => 403');

  const rlogin2 = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${userTeste}@teste.local`, password: 'SenhaForte123' })
  });
  capturarSessao(rlogin2);
  await renovarCsrf();
  ok(true, 'sessão restaurada para os testes funcionais');

  // ---------- Empréstimo válido / datas ----------
  secao('Empréstimo válido e datas');
  const e1 = await emprestar(a1.id, l1.id, { dataRetirada: dia(-3) });
  ok(e1.status === 201, 'empréstimo válido => 201');
  ok(e1.data && e1.data.alunoMatricula === '0012345', 'resposta traz alunoMatricula (JOIN)');
  ok(e1.data && e1.data.livroIsbn === '9788501111111', 'resposta traz livroIsbn (JOIN)');
  ok(e1.data && e1.data.dataLimite === dia(4), `dataLimite padrão = retirada + 7 (${e1.data && e1.data.dataLimite})`);

  const eLimiteRuim = await emprestar(a2.id, l2.id, { dataRetirada: dia(-2), dataLimite: dia(-10) });
  ok(eLimiteRuim.status === 400 && /posterior/.test(eLimiteRuim.data.error), 'dataLimite <= dataRetirada => 400 amigável');
  const eDataRuim = await emprestar(a2.id, l2.id, { dataRetirada: 'não-é-data' });
  ok(eDataRuim.status === 400 && /AAAA-MM-DD/.test(eDataRuim.data.error), 'dataRetirada inválida => 400');
  const eFuturo = await emprestar(a2.id, l2.id, { dataRetirada: dia(2) });
  ok(eFuturo.status === 400 && /futuro/.test(eFuturo.data.error), 'dataRetirada no futuro => 400');

  secao('IDs e inexistentes');
  ok((await emprestar(999999, l2.id, {})).status === 404, 'aluno inexistente => 404');
  ok((await emprestar(a2.id, 999999, {})).status === 404, 'livro inexistente => 404');
  ok((await emprestar('abc', l2.id, {})).status === 400, 'alunoId inválido ("abc") => 400');
  ok((await emprestar(a2.id, 0, {})).status === 400, 'livroId inválido (0) => 400');

  secao('Indisponibilidade e duplicidade');
  const eDup = await emprestar(a1.id, l1.id, {});
  ok(eDup.status === 400 && /já possui um empréstimo ativo/.test(eDup.data.error), 'mesmo aluno+livro ativo => 400 (anti-duplicado)');
  const eIndisp = await emprestar(a2.id, l1.id, {});
  ok(eIndisp.status === 400 && /Não há cópias disponíveis/.test(eIndisp.data.error), 'livro sem cópias para outro aluno => 400');

  // === PARTE 3 (devolução/bloqueio/cancelamento) ===

  secao('Devolução e datas');
  ok((await devolver(e1.data.id, { dataDevolucao: dia(-10) })).status === 400, 'devolução antes da retirada => 400');
  const devFut = await devolver(e1.data.id, { dataDevolucao: dia(2) });
  ok(devFut.status === 400 && /futuro/.test(devFut.data.error), 'devolução no futuro => 400');

  const notaAntes = (await notaDe(a1.id)).nota;
  const dOk = await devolver(e1.data.id, { dataDevolucao: dia(-1), estadoDevolucao: 'Ótimo' });
  ok(dOk.status === 200 && dOk.data.devolvido === 1, 'devolução antes do prazo => 200/devolvido');
  const repDepois = await notaDe(a1.id);
  ok(repDepois.devolvidosAntes >= 1, 'devolução adiantada registrada como bônus (+0,08)');
  ok(repDepois.nota === notaAntes && notaAntes === 5, 'nota permanece no teto 5,0 (clamp — já estava máxima)');
  ok((await devolver(e1.data.id, { dataDevolucao: dia(0) })).status === 400, 'devolver 2x o mesmo empréstimo => 400');

  secao('Estado de conservação');
  const e2 = (await emprestar(a1.id, l1.id, { dataRetirada: dia(-1), estadoSaida: 'Ótimo' })).data;
  const antes2 = (await notaDe(a1.id)).nota;
  await devolver(e2.id, { dataDevolucao: dia(0), estadoDevolucao: 'Regular' });
  const depois2 = (await notaDe(a1.id)).nota;
  ok(depois2 < antes2, `devolver em estado pior penalizou (${antes2} -> ${depois2})`);
  const e3 = (await emprestar(a1.id, l1.id, { dataRetirada: dia(-1), estadoSaida: 'Bom' })).data;
  await devolver(e3.id, { dataDevolucao: dia(0), estadoDevolucao: 'Bom' });
  const depois3 = (await notaDe(a1.id)).nota;
  ok(depois3 >= depois2, 'devolver no mesmo estado não penaliza (recuperação por bônus)');

  secao('Atraso e bloqueio');
  let a2nota = (await notaDe(a2.id)).nota;
  for (let i = 0; i < 5 && a2nota >= 3; i++) {
    const ee = (await emprestar(a2.id, l2.id, { dataRetirada: dia(-40), dataLimite: dia(-33), estadoSaida: 'Bom' })).data;
    await devolver(ee.id, { dataDevolucao: dia(0), estadoDevolucao: 'Bom' });
    a2nota = (await notaDe(a2.id)).nota;
  }
  ok(a2nota < 3, `atrasos grandes derrubaram a nota abaixo de 3,0 (${a2nota})`);
  const eBloq = await emprestar(a2.id, l2.id, { dataRetirada: dia(0) });
  ok(eBloq.status === 403 && /bloqueado/i.test(eBloq.data.error), 'aluno bloqueado => 403 com mensagem amigável');
  const listaAlunos = (await req('GET', '/api/alunos')).data;
  const bruno = listaAlunos.find(a => a.id === a2.id);
  ok(bruno && bruno.bloqueado === true, 'listagem de alunos marca bloqueado (integração reputação)');

  secao('Cancelamento');
  const e4 = (await emprestar(a1.id, l2.id, { dataRetirada: dia(0) })).data;
  ok((await req('DELETE', `/api/emprestimos/${e4.id}`, null, { headers: { 'X-CSRF-Token': csrf } })).status === 200, 'cancelar empréstimo ativo => 200');
  ok((await req('DELETE', `/api/emprestimos/${e1.data.id}`, null, { headers: { 'X-CSRF-Token': csrf } })).status === 400, 'cancelar empréstimo já devolvido => 400');
  ok((await req('DELETE', '/api/emprestimos/abc', null, { headers: { 'X-CSRF-Token': csrf } })).status === 400, 'cancelar com ID inválido => 400');

  secao('Regressão: importação DED intacta');
  const mapaOk = await req('PUT', '/api/alunos/ded/mapeamento', { mapeamentos: [{ turmaDed: 'TURMA E7 REG', turmaSistema: '3°A' }] }, { headers: { 'X-CSRF-Token': csrf } });
  ok(mapaOk.status === 200, 'rota DED de mapeamento responde normalmente');

  console.log(`\n========== RESULTADO ETAPA 7: ${passos} passaram, ${falhas} falharam ==========`);
} finally {
  proc.kill();
  try { fs.rmSync(MIRROR, { recursive: true, force: true }); } catch (_) {}
}
process.exit(falhas ? 1 : 0);
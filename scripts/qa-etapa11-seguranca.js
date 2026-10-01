// scripts/qa-etapa11-seguranca.js — Etapa 11 (espelho isolado, nunca biblioteca.db real)
// Vetores novos: XSS persistente, limites, CSRF em alunos/livros, headers, sessao.
// Uso: node scripts/qa-etapa11-seguranca.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIRROR = path.join(os.tmpdir(), `qa-etapa11-${Date.now()}`);
const PORT = process.env.QA_ETAPA11_PORT || '3991';
const BASE = `http://127.0.0.1:${PORT}`;
let passou = 0, falhou = 0;
const ok = (n) => { passou++; console.log(`  ✔ ${n}`); };
const no = (n, d) => { falhou++; console.log(`  ✘ ${n} -> ${d}`); };
const verifica = (n, c, d) => (c ? ok(n) : no(n, d === undefined ? 'falso' : d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function prepararEspelho() {
  fs.mkdirSync(MIRROR, { recursive: true });
  for (const it of ['server.js', 'db.js', 'middleware', 'routes', 'services', 'public', 'package.json', 'scripts'])
    if (fs.existsSync(path.join(ROOT, it))) fs.cpSync(path.join(ROOT, it), path.join(MIRROR, it), { recursive: true });
  try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(MIRROR, 'node_modules'), 'junction'); }
  catch (_) { fs.cpSync(path.join(ROOT, 'node_modules'), path.join(MIRROR, 'node_modules'), { recursive: true }); }
}
async function main() {
  console.log('\n=== QA Etapa 11 (espelho isolado) ===');
  prepararEspelho();
  require(path.join(MIRROR, 'scripts', 'create-user.js')).criarUsuario({ nome: 'Auditor', email: 'auditor@escola.exemplo', senha: 'Auditor123' });
  const srv = spawn(process.execPath, ['server.js'], { cwd: MIRROR, env: { ...process.env, PORT, SESSION_SECRET: 'qa-etapa11' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  let subiu = false;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`${BASE}/api/auth/session`); if (r.status === 401 || r.ok) { subiu = true; break; } } catch (_) {} }
  if (!subiu) { console.log('Servidor nao subiu:\n', log); srv.kill(); process.exit(1); }
  let cookie = '', csrf = null;
  async function req(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrf && !opts.semCsrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(`${BASE}${url}`, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined });
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) if (/^connect\.sid=/.test(c)) cookie = c.split(';')[0];
    let data = null; try { data = await res.json(); } catch (_) {}
    return { status: res.status, data, headers: res.headers };
  }
  async function csrfLoad() { const r = await req('/api/auth/csrf'); csrf = r.data && r.data.csrfToken ? r.data.csrfToken : null; }
  try {
    console.log('\n[D] Escrita sem sessao');
    verifica('POST /api/alunos sem sessao => 401/403', [401, 403].includes((await req('/api/alunos', { method: 'POST', json: { nome: 'X', turma: '3°A' }, semCsrf: true })).status));
    verifica('POST /api/livros sem sessao => 401/403', [401, 403].includes((await req('/api/livros', { method: 'POST', json: { titulo: 'X', autor: 'Y', categoria: 'Z' }, semCsrf: true })).status));
    console.log('\n[A0] Login');
    await csrfLoad();
    const lg = await req('/api/auth/login', { method: 'POST', json: { email: 'auditor@escola.exemplo', password: 'Auditor123' } });
    verifica('login => 200', lg.status === 200 && lg.data && lg.data.ok, JSON.stringify(lg.data));
    verifica('sem password_hash', !(lg.data.user && 'password_hash' in lg.data.user));
    await csrfLoad(); // login regenera a sessao => recarrega o token CSRF novo
    console.log('\n[G] Sessao');
    const raw = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'auditor@escola.exemplo', password: 'Auditor123' }) });
    const sid = (raw.headers.getSetCookie ? raw.headers.getSetCookie() : []).find((c) => /^connect\.sid=/.test(c)) || '';
    verifica('cookie HttpOnly', /httponly/i.test(sid), sid.slice(0, 60) || '(vazio)');
    verifica('cookie SameSite', /samesite/i.test(sid), sid.slice(0, 60) || '(vazio)');
    console.log('\n[C] CSRF autenticado');
    verifica('POST aluno sem CSRF => 403', (await req('/api/alunos', { method: 'POST', json: { nome: 'S', turma: '3°A' }, semCsrf: true })).status === 403);
    verifica('POST livro sem CSRF => 403', (await req('/api/livros', { method: 'POST', json: { titulo: 'S', autor: 'A', categoria: 'C' }, semCsrf: true })).status === 403);
    console.log('\n[A] XSS persistente recusado');
    verifica('aluno <script> => 400', (await req('/api/alunos', { method: 'POST', json: { nome: '<script>alert(1)</script>', turma: '3°A' } })).status === 400);
    verifica('aluno <img onerror> => 400', (await req('/api/alunos', { method: 'POST', json: { nome: '<img src=x onerror=alert(1)>', turma: '3°A' } })).status === 400);
    verifica('livro <svg> => 400', (await req('/api/livros', { method: 'POST', json: { titulo: '<svg onload=alert(1)>', autor: 'A', categoria: 'C' } })).status === 400);
    verifica('autor com <b> => 400', (await req('/api/livros', { method: 'POST', json: { titulo: 'Ok', autor: 'A<b>x</b>', categoria: 'C' } })).status === 400);
    const alunoOk = await req('/api/alunos', { method: 'POST', json: { nome: "Ana Maria D'Avila-Souza", turma: '3°A' } });
    verifica('nome legitimo acentuado => 201', alunoOk.status === 201, String(alunoOk.status));
    const livroOk = await req('/api/livros', { method: 'POST', json: { titulo: 'Dom Casmurro (2a ed.)', autor: 'Machado de Assis', categoria: 'Literatura' } });
    verifica('livro legitimo => 201', livroOk.status === 201, String(livroOk.status));
    console.log('\n[B] Limites de tamanho');
    verifica('nome 5000 chars => 400', (await req('/api/alunos', { method: 'POST', json: { nome: 'A'.repeat(5000), turma: '3°A' } })).status === 400);
    verifica('titulo 5000 chars => 400', (await req('/api/livros', { method: 'POST', json: { titulo: 'T'.repeat(5000), autor: 'A', categoria: 'C' } })).status === 400);
    console.log('\n[E] Limite de upload backup = 50MB');
    const srcBk = fs.readFileSync(path.join(MIRROR, 'routes', 'backup.js'), 'utf8');
    verifica('fileSize 50MB no codigo', /fileSize:\s*50\s*\*\s*1024\s*\*\s*1024/.test(srcBk));
    console.log('\n[F] Headers Helmet');
    const h = await req('/api/turmas');
    verifica('GET /api/turmas => 200', h.status === 200, String(h.status));
    verifica('nosniff', (h.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff', h.headers.get('x-content-type-options'));
    verifica('x-frame-options', !!h.headers.get('x-frame-options'), h.headers.get('x-frame-options'));
    verifica('csp presente', !!(h.headers.get('content-security-policy') || ''));
    console.log('\n[R] PUT tambem valida');
    if (alunoOk.data && alunoOk.data.id) verifica('PUT aluno <script> => 400', (await req(`/api/alunos/${alunoOk.data.id}`, { method: 'PUT', json: { nome: '<script>x</script>', turma: '3°A' } })).status === 400);
    if (livroOk.data && livroOk.data.id) verifica('PUT livro <> => 400', (await req(`/api/livros/${livroOk.data.id}`, { method: 'PUT', json: { titulo: '<img src=x>', autor: 'A', categoria: 'C' } })).status === 400);
  } finally {
    srv.kill(); await sleep(600);
    for (let t = 0; t < 5; t++) { try { fs.rmSync(MIRROR, { recursive: true, force: true }); console.log('\nEspelho removido.'); break; } catch (e) { if (t === 4) console.log('Aviso:', e.message); else await sleep(400); } }
  }
  console.log(`\n=== Resultado Etapa 11 ===\nPassou: ${passou} | Falhou: ${falhou}`);
  process.exit(falhou === 0 ? 0 : 1);
}
main().catch((e) => { console.error('Erro QA11:', e); process.exit(1); });

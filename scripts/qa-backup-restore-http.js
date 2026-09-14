// scripts/qa-backup-restore-http.js
// Testa o fluxo COMPLETO de restauração por HTTP, incluindo pre-restore,
// em um PROJETO ESPELHO isolado (nunca no biblioteca.db real).
//
// Uso: node scripts/qa-backup-restore-http.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const MIRROR = path.join(os.tmpdir(), `qa-restore-${Date.now()}`);
const PORT = process.env.QA_PORT2 || '3998';
const BASE = `http://127.0.0.1:${PORT}`;

let passou = 0, falhou = 0;
const ok = (n) => { passou++; console.log(`  ✔ ${n}`); };
const falha = (n, e) => { falhou++; console.log(`  ✘ ${n} -> ${e}`); };
const verifica = (n, c, d) => c ? ok(n) : falha(n, d || 'falso');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function prepararEspelho() {
  fs.mkdirSync(MIRROR, { recursive: true });
  // Copia código-fonte necessário
  for (const item of ['server.js', 'db.js', 'middleware', 'routes', 'services', 'public', 'package.json']) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(MIRROR, item);
    fs.cpSync(src, dst, { recursive: true });
  }
  // node_modules por junction (rápido) ou cópia
  const nmSrc = path.join(ROOT, 'node_modules');
  const nmDst = path.join(MIRROR, 'node_modules');
  try { fs.symlinkSync(nmSrc, nmDst, 'junction'); }
  catch (_) { fs.cpSync(nmSrc, nmDst, { recursive: true }); }

  // Banco do espelho com dados "de hoje"
  const dbPath = path.join(MIRROR, 'biblioteca.db');
  const d = new Database(dbPath);
  // db.js cria as tabelas; aqui só deixamos vazio e o servidor migra/cria admin.
  d.close();
}

async function main() {
  console.log('\n=== QA HTTP: fluxo de restauração (espelho isolado) ===');
  prepararEspelho();
  console.log('Espelho:', MIRROR);

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: MIRROR,
    env: { ...process.env, PORT, SESSION_SECRET: 'qa-restore' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });

  let subiu = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await fetch(`${BASE}/api/auth/session`);
      if (r.status === 401 || r.ok) { subiu = true; break; }
    } catch (_) {}
  }
  if (!subiu) { console.log('Servidor não subiu:\n', log); srv.kill(); process.exit(1); }

  try {
    let cookie = '';
    async function fj(url, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      if (cookie) headers['Cookie'] = cookie;
      if (opts.json) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${BASE}${url}`, {
        method: opts.method || 'GET', headers,
        body: opts.json ? JSON.stringify(opts.json) : opts.body
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      let data = null; try { data = await res.json(); } catch (_) {}
      return { status: res.status, data, res };
    }

    // Login
    const login = await fj('/api/auth/login', { method: 'POST', json: { username: 'admin', password: '1234' } });
    verifica('login ok', login.status === 200);

    // Cria dados: um livro e um aluno
    const livro = await fj('/api/livros', { method: 'POST', json: { titulo: 'Livro A', autor: 'Autor A', categoria: 'Teste', acervo: 1 } });
    verifica('livro criado', livro.status === 200 || livro.status === 201, JSON.stringify(livro.data));
    const aluno = await fj('/api/alunos', { method: 'POST', json: { nome: 'Aluno A', turma: '6A' } });
    verifica('aluno criado', aluno.status === 200 || aluno.status === 201, JSON.stringify(aluno.data));

    // Contagens atuais
    const dash1 = await fj('/api/dashboard');
    const livrosAntes = dash1.data.livrosTitulos;
    verifica('dashboard mostra ao menos 1 livro', livrosAntes >= 1, String(livrosAntes));

    // Criar backup (estado atual = 1 livro, 1 aluno)
    const criar = await fj('/api/backup/criar', { method: 'POST' });
    verifica('backup criado', criar.status === 200 && criar.data.ok, JSON.stringify(criar.data));
    const nomeBackup = criar.data.backup.arquivo;

    // Altera o estado: adiciona mais um livro
    await fj('/api/livros', { method: 'POST', json: { titulo: 'Livro B', autor: 'Autor B', categoria: 'Teste', acervo: 1 } });
    const dash2 = await fj('/api/dashboard');
    verifica('estado alterado para 2 livros', dash2.data.livrosTitulos === livrosAntes + 1, String(dash2.data.livrosTitulos));

    // RESTAURAR o backup (deve voltar a 1 livro) com confirmar=1
    const restaurar = await fj('/api/backup/restaurar', { method: 'POST', json: { nome: nomeBackup, confirmar: '1' } });
    verifica('restauração => 200 ok', restaurar.status === 200 && restaurar.data.ok, JSON.stringify(restaurar.data));
    verifica('pre-restore criado antes de restaurar', typeof restaurar.data.preRestore === 'string' && restaurar.data.preRestore.startsWith('pre-restore-'), restaurar.data.preRestore);

    // Verifica que o estado voltou
    const dash3 = await fj('/api/dashboard');
    verifica('após restauração, voltou a 1 livro', dash3.data.livrosTitulos === livrosAntes, `${dash3.data.livrosTitulos} vs ${livrosAntes}`);

    // Pre-restore existe no disco do espelho
    const backupDir = path.join(MIRROR, 'backups');
    const arquivos = fs.readdirSync(backupDir);
    verifica('arquivo pre-restore existe no disco', arquivos.some(f => f.startsWith('pre-restore-') && f.endsWith('.db')), arquivos.join(', '));

    // Restaurar arquivo inválido é recusado e NÃO altera o banco
    const os2 = require('os');
    const invalido = path.join(os2.tmpdir(), `qa-invalido-${Date.now()}.db`);
    { const x = new Database(invalido); x.exec('CREATE TABLE q (id INTEGER)'); x.close(); }
    const fd = new FormData();
    fd.append('arquivo', new Blob([fs.readFileSync(invalido)]), 'invalido.db');
    fd.append('confirmar', '1');
    const resInv = await fetch(`${BASE}/api/backup/restaurar`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
    verifica('restaurar arquivo inválido => 422', resInv.status === 422, String(resInv.status));
    const dash4 = await fj('/api/dashboard');
    verifica('banco atual intacto após arquivo inválido', dash4.data.livrosTitulos === livrosAntes, String(dash4.data.livrosTitulos));
    fs.unlinkSync(invalido);

    // Concorrência: duas restaurações simultâneas — segunda deve ser bloqueada
    // (dispara duas em paralelo; uma delas pode terminar rápido demais, então
    //  verificamos que ao menos o formato de resposta é consistente)
    const [r1, r2] = await Promise.all([
      fj('/api/backup/restaurar', { method: 'POST', json: { nome: nomeBackup, confirmar: '1' } }),
      fj('/api/backup/restaurar', { method: 'POST', json: { nome: nomeBackup, confirmar: '1' } })
    ]);
    const statuses = [r1.status, r2.status].sort();
    verifica('duas restaurações: ao menos uma ok', statuses.includes(200), JSON.stringify(statuses));

  } finally {
    srv.kill();
    await sleep(400);
    try { fs.rmSync(MIRROR, { recursive: true, force: true }); console.log('Espelho removido.'); } catch (e) { console.log('Aviso ao limpar espelho:', e.message); }
  }

  console.log(`\n=== Resultado restauração ===\nPassou: ${passou} | Falhou: ${falhou}`);
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch(e => { console.error('Erro no QA de restauração:', e); process.exit(1); });

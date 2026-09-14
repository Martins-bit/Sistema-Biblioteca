// scripts/qa-backup-http.js
// Teste de integração HTTP das rotas de backup (Etapa 4).
//
// SEGURANÇA: sobe o servidor real em uma porta de teste e executa apenas
// operações NÃO destrutivas sobre o banco real:
//   - login com o admin padrão;
//   - GET /api/backup/status, /lista, /config;
//   - POST /api/backup/criar (cria um backup; NÃO apaga nada);
//   - download de um arquivo de backup;
//   - validação de arquivo inválido / vazio / de outro sistema;
//   - checagem de autenticação (sem sessão => 401).
// A RESTAURAÇÃO NÃO é exercitada aqui (ela modificaria o biblioteca.db real);
// ela é coberta no harness services-level (scripts/qa-backup.js) sobre um banco
// de teste isolado.
//
// Uso: node scripts/qa-backup-http.js

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.QA_PORT || '3999';
const BASE = `http://127.0.0.1:${PORT}`;

let passou = 0, falhou = 0;
function ok(n) { passou++; console.log(`  ✔ ${n}`); }
function falha(n, e) { falhou++; console.log(`  ✘ ${n} -> ${e}`); }
function verifica(n, cond, det) { cond ? ok(n) : falha(n, det || 'falso'); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n=== QA HTTP: rotas de backup ===');
  const nodeExe = process.execPath;
  const srv = spawn(nodeExe, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSION_SECRET: 'qa-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d.toString(); });
  srv.stderr.on('data', d => { srvLog += d.toString(); });

  // Espera o servidor subir
  let subiu = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await fetch(`${BASE}/api/auth/session`);
      if (r.status === 401 || r.ok) { subiu = true; break; }
    } catch (_) {}
  }
  if (!subiu) {
    console.log('Servidor não subiu. Log:\n', srvLog);
    srv.kill();
    process.exit(1);
  }

  try {
    // Cookie jar simples
    let cookie = '';
    async function fetchJson(url, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      if (cookie) headers['Cookie'] = cookie;
      if (opts.json) { headers['Content-Type'] = 'application/json'; }
      const res = await fetch(`${BASE}${url}`, {
        method: opts.method || 'GET',
        headers,
        body: opts.json ? JSON.stringify(opts.json) : opts.body
      });
      const setC = res.headers.get('set-cookie');
      if (setC) cookie = setC.split(';')[0];
      let data = null;
      try { data = await res.json(); } catch (_) {}
      return { status: res.status, data, res };
    }

    console.log('[A] Autenticação obrigatória');
    const semAuth = await fetchJson('/api/backup/status');
    verifica('status sem sessão => 401', semAuth.status === 401, String(semAuth.status));
    const semAuthCriar = await fetchJson('/api/backup/criar', { method: 'POST' });
    verifica('criar sem sessão => 401', semAuthCriar.status === 401, String(semAuthCriar.status));
    const semAuthLista = await fetchJson('/api/backup/lista');
    verifica('lista sem sessão => 401', semAuthLista.status === 401, String(semAuthLista.status));

    console.log('[B] Login');
    const login = await fetchJson('/api/auth/login', { method: 'POST', json: { username: 'admin', password: '1234' } });
    verifica('login admin ok', login.status === 200 && login.data && login.data.ok, JSON.stringify(login.data));

    console.log('[C] Status / histórico / config');
    const st = await fetchJson('/api/backup/status');
    verifica('status com sessão => 200', st.status === 200, String(st.status));
    verifica('status retorna config', st.data && typeof st.data.config === 'object');
    verifica('status retorna pasta backups/', st.data && st.data.pasta === 'backups/');

    const lista0 = await fetchJson('/api/backup/lista');
    verifica('lista => 200 com array', lista0.status === 200 && Array.isArray(lista0.data.backups));

    const cfg0 = await fetchJson('/api/backup/config');
    verifica('config => 200', cfg0.status === 200 && 'automatico' in cfg0.data);

    console.log('[D] Criar backup (não destrutivo)');
    const antes = lista0.data.backups.length;
    const criar = await fetchJson('/api/backup/criar', { method: 'POST' });
    verifica('criar backup => 200 ok', criar.status === 200 && criar.data.ok === true, JSON.stringify(criar.data));
    verifica('mensagem "Backup concluído com sucesso."', criar.data.message === 'Backup concluído com sucesso.');
    verifica('backup criado tem arquivo .db', criar.data.backup && /\.db$/.test(criar.data.backup.arquivo));

    const lista1 = await fetchJson('/api/backup/lista');
    verifica('histórico cresceu em 1', lista1.data.backups.length === antes + 1, `${antes} -> ${lista1.data.backups.length}`);
    verifica('último backup agora está definido', !!(await fetchJson('/api/backup/status')).data.ultimoBackup);
    verifica('listagem não inclui arquivos .meta.json', !lista1.data.backups.some(b => /\.meta\.json$/.test(b.arquivo)));

    console.log('[E] Download de backup interno');
    const nome = criar.data.backup.arquivo;
    const dl = await fetch(`${BASE}/api/backup/arquivo/${encodeURIComponent(nome)}`, { headers: { Cookie: cookie } });
    verifica('download => 200', dl.status === 200, String(dl.status));
    const buf = Buffer.from(await dl.arrayBuffer());
    verifica('download não vazio', buf.length > 0);
    verifica('download é um SQLite válido', buf.toString('utf8', 0, 15) === 'SQLite format 3');

    console.log('[F] Validação de arquivos inválidos');
    // arquivo vazio
    const fd1 = new FormData();
    fd1.append('arquivo', new Blob([Buffer.alloc(0)]), 'vazio.db');
    const v1 = await fetch(`${BASE}/api/backup/validar`, { method: 'POST', headers: { Cookie: cookie }, body: fd1 });
    verifica('arquivo vazio => 422', v1.status === 422, String(v1.status));
    const v1j = await v1.json();
    verifica('mensagem de backup inválido', /não é um backup válido/i.test(v1j.error || ''), JSON.stringify(v1j));

    // banco de outro sistema
    const Database = require('better-sqlite3');
    const os = require('os'); const fs = require('fs');
    const outroPath = path.join(os.tmpdir(), `qa-outro-${Date.now()}.db`);
    { const d = new Database(outroPath); d.exec('CREATE TABLE z (id INTEGER)'); d.close(); }
    const fd2 = new FormData();
    fd2.append('arquivo', new Blob([fs.readFileSync(outroPath)]), 'outro.db');
    const v2 = await fetch(`${BASE}/api/backup/validar`, { method: 'POST', headers: { Cookie: cookie }, body: fd2 });
    verifica('banco de outro sistema => 422', v2.status === 422, String(v2.status));
    fs.unlinkSync(outroPath);

    // backup válido
    const fd3 = new FormData();
    fd3.append('arquivo', new Blob([buf]), nome);
    const v3 = await fetch(`${BASE}/api/backup/validar`, { method: 'POST', headers: { Cookie: cookie }, body: fd3 });
    const v3j = await v3.json();
    verifica('backup válido => 200 valido=true', v3.status === 200 && v3j.valido === true, JSON.stringify(v3j));
    verifica('validação retorna contagens', v3j.contagens && typeof v3j.contagens.livros !== 'undefined');

    console.log('[G] Config do backup automático');
    const put = await fetchJson('/api/backup/config', { method: 'PUT', json: { automatico: false, frequencia: 'semanal' } });
    verifica('PUT config => 200', put.status === 200 && put.data.ok === true, JSON.stringify(put.data));
    verifica('frequência atualizada para semanal', put.data.config.frequencia === 'semanal');
    const putBad = await fetchJson('/api/backup/config', { method: 'PUT', json: { frequencia: 'cada-minuto' } });
    verifica('frequência inválida => 400', putBad.status === 400, String(putBad.status));
    // restaura config para padrão
    await fetchJson('/api/backup/config', { method: 'PUT', json: { automatico: false, frequencia: 'diario' } });

    console.log('[H] Restauração exige confirmação');
    const semConf = await fetchJson('/api/backup/restaurar', { method: 'POST', json: { nome } });
    verifica('restaurar sem confirmar => 400', semConf.status === 400, String(semConf.status));

    console.log('[I] Apagar tudo exige confirmação');
    const delSemConf = await fetchJson('/api/backup', { method: 'DELETE' });
    verifica('DELETE sem confirmar => 400', delSemConf.status === 400, String(delSemConf.status));

  } finally {
    srv.kill();
    await sleep(300);
  }

  console.log(`\n=== Resultado HTTP ===\nPassou: ${passou} | Falhou: ${falhou}`);
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch(e => { console.error('Erro no QA HTTP:', e); process.exit(1); });

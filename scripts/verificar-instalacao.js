// scripts/verificar-instalacao.js — Etapa 12: checagem de prontidão (100% NÃO destrutiva).
// Não escreve no banco, não cria usuários, não altera nenhum arquivo.
// Uso: node scripts/verificar-instalacao.js
const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

async function main() {
let ok = 0, falhas = 0;
const passa = (n) => { ok++; console.log(`  ✔ ${n}`); };
const reprova = (n, d) => { falhas++; console.log(`  ✘ ${n}${d ? ` -> ${d}` : ''}`); };
const checa = (n, c, d) => (c ? passa(n) : reprova(n, d));
let avisos = 0;
const aviso = (n, d) => { avisos++; console.log(`  ! ${n}${d ? ` -> ${d}` : ''}`); };

// 1. Versão do Node (better-sqlite3 13 exige Node >= 22)
const major = Number(process.versions.node.split('.')[0]);
checa(`Node.js ${process.version} (>= 22)`, major >= 22, 'instale o Node.js LTS 22+ em https://nodejs.org');

// 2. Arquivos essenciais
for (const f of ['server.js', 'db.js', 'package.json', 'public/login.html', 'public/index.html',
  'public/assets/js/app.js', 'public/assets/js/vendor/qrcode.min.js',
  'public/assets/js/vendor/html5-qrcode.min.js', 'routes/auth.js', 'routes/backup.js',
  'services/backup.js', 'services/isbn.js', 'middleware/requireAuth.js',
  'middleware/csrf.js', 'scripts/create-user.js', '.env.example']) {
  checa(`arquivo ${f}`, fs.existsSync(path.join(ROOT, f)));
}
// 3. Pastas essenciais
for (const d of ['routes', 'services', 'middleware', 'scripts', 'public', 'test']) {
  checa(`pasta ${d}/`, fs.existsSync(path.join(ROOT, d)));
}
// 4. Dependências instaladas (sem instalar nada)
checa('pasta node_modules/', fs.existsSync(path.join(ROOT, 'node_modules')), 'rode: npm install');
try {
  const bs = require(path.join(ROOT, 'node_modules', 'better-sqlite3', 'package.json'));
  checa(`better-sqlite3 ${bs.version} carregável`, true);
} catch (e) { reprova('better-sqlite3 carregável', 'rode: npm install'); }
// 5. Sintaxe dos arquivos críticos
for (const f of ['server.js', 'db.js', 'routes/backup.js', 'scripts/create-user.js']) {
  try { execFileSync(process.execPath, ['--check', f], { cwd: ROOT }); passa(`sintaxe ${f}`); }
  catch (e) { reprova(`sintaxe ${f}`); }
}
// 6. Porta: livre, OU ocupada pelo PRÓPRIO sistema (ok), ou por outro programa (erro)
const porta = Number(process.env.PORT || 3000);
const respondendo = await new Promise((resolve) => {
  const req = require('http').get({ host: '127.0.0.1', port: porta, path: '/login.html', timeout: 800 }, (r) => {
    r.resume();
    resolve(r.statusCode === 200);
  });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});
if (respondendo) {
  passa(`porta ${porta} ocupada pelo próprio Sistema da Biblioteca (servidor já ativo)`);
} else {
  const livre = await new Promise((resolve) => {
    const s = net.connect(porta, '127.0.0.1');
    s.on('connect', () => { s.end(); resolve(false); });
    s.on('error', () => resolve(true));
    setTimeout(() => { try { s.destroy(); } catch (_) {} resolve(true); }, 1500);
  });
  checa(`porta ${porta} livre`, livre, 'outro programa está usando a porta (feche-o ou use PORT=3001)');
}
// 7. Banco: SOMENTE LEITURA (readonly:true + PRAGMA integrity_check)
const dbPath = path.join(ROOT, 'biblioteca.db');
if (!fs.existsSync(dbPath)) {
  passa('biblioteca.db ainda não existe (será criado no 1º npm start)');
} else {
  try {
    const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
    const db = new Database(dbPath, { readonly: true });
    const integ = db.prepare('PRAGMA integrity_check').get().integrity_check;
    checa('biblioteca.db íntegro (PRAGMA integrity_check = ok)', integ === 'ok', String(integ));
    for (const t of ['users', 'alunos', 'livros', 'emprestimos']) {
      try { console.log(`    · ${t}: ${db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c} registro(s)`); }
      catch (_) { console.log(`    · ${t}: (tabela ausente — será criada no 1º start)`); }
    }
    db.close();
  } catch (e) { reprova('leitura do biblioteca.db', e.message); }
}
// 8. Arquivos de inicialização da Etapa 13/13.1 (launcher/atalho/encerramento)
for (const f of ['INICIAR-BIBLIOTECA.bat', 'ENCERRAR-BIBLIOTECA.bat',
  'CRIAR-ATALHO.bat',
  'scripts/criar-atalho.ps1', 'scripts/encerrar-servidor.ps1']) {
  checa(`arquivo ${f}`, fs.existsSync(path.join(ROOT, f)));
}
// 9. Endereço principal http://biblioteca.localhost (Etapa 13.1)
//    O navegador resolve "*.localhost" para 127.0.0.1 sozinho (RFC 6761):
//    NÃO precisa de hosts nem de administrador. O Windows (getaddrinfo) pode
//    não resolver o nome (ENOTFOUND) — por isso o teste fala com 127.0.0.1:80,
//    que é por onde o navegador chega, e confirma que quem responde somos nós.
if (respondendo) {
  const porta80 = await new Promise((resolve) => {
    const req = require('http').get({ host: '127.0.0.1', port: 80, path: '/login.html', timeout: 800 }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => resolve(r.statusCode === 200 && d.includes('Sistema da Biblioteca')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  if (porta80) passa('porta 80 ativa -> http://biblioteca.localhost abre sem :3000');
  else aviso('porta 80 não responde agora', 'normal se outro programa usa a porta 80; http://localhost:3000 segue valendo');
} else {
  console.log('  · servidor desligado — http://biblioteca.localhost será usado quando o sistema iniciar (porta 80)');
}
// Resíduo opcional da Etapa 13 antiga: linha com "biblioteca.local" no hosts.
try {
  const hosts = fs.readFileSync(
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts'),
    'utf8'
  );
  if (/(^|[^\w.-])biblioteca\.local(\s|#|$)/m.test(hosts)) {
    aviso('linha antiga "biblioteca.local" no hosts (Etapa 13)', 'opcional: pode ser removida — o sistema agora usa biblioteca.localhost');
  }
} catch (_) {}

console.log(`\n=== Verificação: ${ok} OK | ${falhas} problema(s)${avisos ? ` | ${avisos} aviso(s)` : ''} ===`);
process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error('Erro na verificação:', e.message); process.exit(1); });

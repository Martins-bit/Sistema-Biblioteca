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
// 6. Porta 3000 livre?
const porta = Number(process.env.PORT || 3000);
const livre = await new Promise((resolve) => {
  const s = net.connect(porta, '127.0.0.1');
  s.on('connect', () => { s.end(); resolve(false); });
  s.on('error', () => resolve(true));
  setTimeout(() => { try { s.destroy(); } catch (_) {} resolve(true); }, 1500);
});
checa(`porta ${porta} livre`, livre, 'outro programa está usando a porta (feche-o ou use PORT=3001)');
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
console.log(`\n=== Verificação: ${ok} OK | ${falhas} problema(s) ===`);
process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error('Erro na verificação:', e.message); process.exit(1); });

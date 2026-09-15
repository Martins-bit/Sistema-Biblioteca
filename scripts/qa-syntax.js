// scripts/qa-syntax.js - verifica a sintaxe de arquivos JS (CommonJS e ES modules)
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const comuns = ['db.js', 'server.js', 'routes/auth.js', 'routes/me.js', 'services/auth.js',
  'middleware/csrf.js', 'middleware/requireAuth.js', 'scripts/create-user.js'];
const esm = ['public/assets/js/app.js'];

let falhas = 0;
for (const f of comuns) {
  try { execFileSync(process.execPath, ['--check', f], { cwd: path.join(__dirname, '..') }); console.log('OK  ', f); }
  catch (e) { falhas++; console.log('ERRO', f, '\n', e.stdout ? e.stdout.toString() : e.message); }
}
for (const f of esm) {
  const tmp = path.join(os.tmpdir(), `chk-${Date.now()}.mjs`);
  fs.copyFileSync(path.join(__dirname, '..', f), tmp);
  try { execFileSync(process.execPath, ['--check', tmp]); console.log('OK  ', f); }
  catch (e) { falhas++; console.log('ERRO', f, '\n', e.stdout ? e.stdout.toString() : e.message); }
  fs.unlinkSync(tmp);
}
console.log(falhas === 0 ? '\nTodos OK' : `\n${falhas} arquivo(s) com erro`);
process.exit(falhas === 0 ? 0 : 1);


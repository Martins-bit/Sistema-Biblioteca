// scripts/create-user.js
// Cadastro ADMINISTRATIVO de bibliotecárias (Etapa 5).
//
// NÃO há cadastro público no sistema: novas contas são criadas por este script,
// executado localmente por quem administra o servidor.
//
// Uso interativo:
//   node scripts/create-user.js
//
// Uso não interativo (CI/administração):
//   node scripts/create-user.js --nome "Bárbara" --email barbara@escola.exemplo --senha "SenhaForte1"
//
// Segurança:
// - a senha é lida de forma oculta no modo interativo;
// - a senha NUNCA é impressa nem gravada em arquivo — apenas o hash;
// - valida e-mail/senha e impede e-mail duplicado.

const readline = require('readline');
const db = require('../db');
const auth = require('../services/auth');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--nome') out.nome = argv[++i];
    else if (a === '--email') out.email = argv[++i];
    else if (a === '--senha') out.senha = argv[++i];
  }
  return out;
}

function perguntar(rl, texto) {
  return new Promise((resolve) => rl.question(texto, (r) => resolve(r)));
}

// Lê a senha sem ecoar na tela (quando o terminal suporta).
function perguntarSenha(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    process.stdout.write(texto);
    const onData = (char) => {
      const s = char.toString();
      if (s === '\n' || s === '\r' || s === '\u0004') {
        stdin.removeListener('data', onData);
      }
    };
    stdin.on('data', onData);
    rl.question('', (resposta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(resposta);
    });
  });
}

function criarUsuario({ nome, email, senha }) {
  // Validações de servidor (nunca confiar apenas no frontend).
  const valNome = auth.validarNome(nome);
  if (!valNome.ok) throw new Error(valNome.motivo);

  const emailNorm = auth.normalizarEmail(email);
  if (!auth.emailValido(emailNorm)) throw new Error('E-mail inválido.');

  const valSenha = auth.validarSenha(senha);
  if (!valSenha.ok) throw new Error(valSenha.motivo);

  const conn = db();
  const existente = conn.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(emailNorm);
  if (existente) throw new Error('Já existe um usuário com este e-mail.');

  const hash = auth.hashSenha(senha);
  // Mantém `username` preenchido (compatibilidade interna) derivando do e-mail.
  const username = emailNorm.split('@')[0].replace(/[^a-z0-9._-]/g, '') || 'usuario';
  const usernameFinal = conn.prepare('SELECT id FROM users WHERE username = ?').get(username)
    ? `${username}${Date.now().toString().slice(-4)}`
    : username;

  // Insere com lista de colunas explícita; o número de valores acompanha a lista.
  const colunas = ['username', 'nome', 'email', 'password_hash'];
  const valores = [usernameFinal, valNome.valor, emailNorm, hash];
  const placeholders = colunas.map(() => '?').join(', ');
  const sql = `INSERT INTO users (${colunas.join(', ')}, ativo) VALUES (${placeholders}, 1)`;
  const info = conn.prepare(sql).run(...valores);

  // Preferências padrão para o novo usuário.
  conn.prepare('INSERT OR IGNORE INTO user_preferences (user_id, cor_principal, tema) VALUES (?, ?, ?)')
    .run(info.lastInsertRowid, 'padrao', 'claro');

  return { id: Number(info.lastInsertRowid), nome: valNome.valor, email: emailNorm };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let nome = args.nome;
  let email = args.email;
  let senha = args.senha;

  const interativo = !nome || !email || !senha;

  if (interativo) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!nome) nome = await perguntar(rl, 'Nome: ');
      if (!email) email = await perguntar(rl, 'E-mail: ');
      rl.close();
      if (!senha) senha = await perguntarSenha('Senha: ');
    } finally {
      try { rl.close(); } catch (_) {}
    }
  }

  try {
    const u = criarUsuario({ nome, email, senha });
    console.log('\n✅ Usuário criado com sucesso!');
    console.log(`   id:    ${u.id}`);
    console.log(`   nome:  ${u.nome}`);
    console.log(`   email: ${u.email}`);
    console.log('   (a senha não é exibida nem armazenada em texto puro)\n');
  } catch (err) {
    console.error('\n❌ Não foi possível criar o usuário:', err.message, '\n');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { criarUsuario };

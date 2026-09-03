const Database = require('better-sqlite3');
const path = require('path');
const bcryptjs = require('bcryptjs');

console.log('Inicializando banco de dados SQLite...');

try {
  // Caminho para o arquivo do banco de dados
  const dbPath = path.join(__dirname, 'biblioteca.db');

  // Abrir conexão com o banco de dados
  const db = new Database(dbPath);

  console.log(`Banco de dados aberto: ${dbPath}`);

  // Criar tabela de usuários (para autenticação)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Criar tabela de alunos
  db.exec(`
    CREATE TABLE IF NOT EXISTS alunos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      turma TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Criar tabela de livros
  db.exec(`
    CREATE TABLE IF NOT EXISTS livros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      autor TEXT NOT NULL,
      categoria TEXT NOT NULL,
      acervo INTEGER NOT NULL DEFAULT 1,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Criar tabela de empréstimos
  db.exec(`
    CREATE TABLE IF NOT EXISTS emprestimos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alunoId INTEGER NOT NULL,
      livroId INTEGER NOT NULL,
      dataRetirada DATE NOT NULL,
      dataLimite DATE,
      devolvido BOOLEAN NOT NULL DEFAULT 0,
      dataDevolucao DATE,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alunoId) REFERENCES alunos(id),
      FOREIGN KEY (livroId) REFERENCES livros(id)
    )
  `);

  try {
    db.exec('ALTER TABLE emprestimos ADD COLUMN dataLimite DATE');
  } catch (e) {
    // Coluna já existe
  }

  // ---- Migrations: estado de conservação do livro nos empréstimos ----
  // Estado/observação registrados na SAÍDA (empréstimo)
  try {
    db.exec("ALTER TABLE emprestimos ADD COLUMN estadoSaida TEXT");
  } catch (e) { /* Coluna já existe */ }
  try {
    db.exec("ALTER TABLE emprestimos ADD COLUMN obsSaida TEXT");
  } catch (e) { /* Coluna já existe */ }
  // Estado/observação registrados na DEVOLUÇÃO
  try {
    db.exec("ALTER TABLE emprestimos ADD COLUMN estadoDevolucao TEXT");
  } catch (e) { /* Coluna já existe */ }
  try {
    db.exec("ALTER TABLE emprestimos ADD COLUMN obsDevolucao TEXT");
  } catch (e) { /* Coluna já existe */ }

  // ---- Migration: capa do livro (URL da imagem) ----
  try {
    db.exec("ALTER TABLE livros ADD COLUMN capaUrl TEXT");
  } catch (e) { /* Coluna já existe */ }

  // Criar tabela de relatórios/notificações
  db.exec(`
    CREATE TABLE IF NOT EXISTS relatorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mensagem TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Tabelas criadas ou já existiam.');

  // Criar usuário admin padrão se não existir
  const adminUsername = 'admin';
  const adminPassword = '1234'; // Senha padrão mencionada no README

  // Verificar se o usuário admin já existe
  const adminCheck = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername);

  if (!adminCheck) {
    // Criar hash da senha
    const saltRounds = 10;
    const passwordHash = bcryptjs.hashSync(adminPassword, saltRounds);

    // Inserir usuário admin
    const insertAdmin = db.prepare(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)'
    ).run(adminUsername, passwordHash);

    console.log(`Usuário admin criado com ID: ${insertAdmin.lastInsertRowid}`);
  } else {
    console.log('Usuário admin já existe.');
  }

  // Fechar conexão (em uma aplicação real, você manteria a conexão aberta)
  // Mas para este arquivo de inicialização, podemos fechá-la
  // Na prática, outras partes da aplicação criariam suas próprias conexões
  // ou usaríamos um pool de conexões, mas melhor-sqlite3 é síncrono e baseado em arquivo

  console.log('✅ Inicialização do banco de dados concluída com sucesso!');

  // Exportar uma função para obter a conexão compartilhada (singleton).
  // Antes cada chamada abria uma nova conexão sem fechá-la (vazamento de handles);
  // agora reutilizamos uma única instância — a API de uso (db().prepare(...)) é mantida.
  let sharedDb = null;
  module.exports = function() {
    if (!sharedDb || !sharedDb.open) {
      sharedDb = new Database(dbPath);
      sharedDb.pragma('journal_mode = WAL');
    }
    return sharedDb;
  };

} catch (error) {
  console.error('❌ Erro ao inicializar o banco de dados:');
  console.error(error.message);
  process.exit(1);
}
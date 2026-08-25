const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

console.log('Testando conexão com o banco de dados SQLite...');

const logPath = path.join(__dirname, 'db-test.log');
const logs = [];

function log(message, isError = false) {
  const entry = `[${new Date().toISOString()}] ${message}`;
  logs.push(entry);
  if (isError) {
    console.error(message);
  } else {
    console.log(message);
  }
}

try {
  const dbPath = path.join(__dirname, 'biblioteca.db');
  log(`Caminho do banco: ${dbPath}`);

  const db = new Database(dbPath);
  log('✅ Conexão com SQLite estabelecida com sucesso!');

  db.exec(`
    CREATE TABLE IF NOT EXISTS teste_conexao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  log('Tabela de teste criada ou já existia.');

  const insertStmt = db.prepare('INSERT INTO teste_conexao (nome) VALUES (?)');
  const result = insertStmt.run('Teste de conexão - ' + new Date().toISOString());
  log(`Registro inserido com ID: ${result.lastInsertRowid}`);

  const selectStmt = db.prepare('SELECT * FROM teste_conexao WHERE id = ?');
  const row = selectStmt.get(result.lastInsertRowid);
  log('Registro lido do banco:', row);

  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  log(`👤 Usuários cadastrados: ${userCount.cnt}`);

  const adminUser = db.prepare('SELECT id, username FROM users WHERE username = ?').get('admin');
  log(`👤 Usuário admin: ${adminUser ? `ID ${adminUser.id} (${adminUser.username})` : 'NÃO ENCONTRADO'}`);

  const alunoCount = db.prepare('SELECT COUNT(*) as cnt FROM alunos').get();
  const livroCount = db.prepare('SELECT COUNT(*) as cnt FROM livros').get();
  log(`📚 Livros cadastrados: ${livroCount.cnt}`);
  log(`🎓 Alunos cadastrados: ${alunoCount.cnt}`);

  db.close();
  log('✅ Teste de conexão com o banco de dados concluído com sucesso!');

} catch (error) {
  log(`❌ ERRO: ${error.message}`, true);
  log(`Código do erro: ${error.code || 'N/A'}`, true);
  if (error.code === 'SQLITE_CANTOPEN') {
    log('💡 Dica: Verifique se o arquivo biblioteca.db existe e tem permissão de acesso', true);
  } else if (error.code === 'SQLITE_NOTADB' || error.code === 'SQLITE_CORRUPT') {
    log('💡 Dica: O arquivo pode estar corrompido - tente deletar e recriar', true);
  } else if (error.code === 'MODULE_NOT_FOUND') {
    log('💡 Dica: Instale as dependências com: npm install better-sqlite3', true);
  }
} finally {
  fs.writeFileSync(logPath, logs.join('\n'));
  console.log(`\n📝 Log salvo em: ${logPath}`);
}

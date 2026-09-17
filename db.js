const Database = require('better-sqlite3');
const path = require('path');

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

  // ---- Etapa 6B: matrícula do aluno (identificador de negócio) ----
  // TEXT (não INTEGER) para preservar zeros à esquerda (ex.: '0012345').
  // Opcional: alunos antigos permanecem com NULL e continuam funcionando.
  try {
    db.exec('ALTER TABLE alunos ADD COLUMN matricula TEXT');
  } catch (e) { /* Coluna já existe */ }

  // Índice único PARCIAL: apenas matrículas preenchidas são únicas.
  // NULL (aluno antigo sem matrícula) pode repetir quantas vezes existir.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alunos_matricula
    ON alunos(matricula)
    WHERE matricula IS NOT NULL
  `);

  // ---- Etapa 6B: mapeamento persistente de turmas do DED -> turmas do sistema ----
  // turma_sistema = NULL significa "ignorar esta turma do DED".
  // NUNCA é preenchido automaticamente por similaridade — só por confirmação
  // explícita da bibliotecária na importação.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ded_turma_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      turma_ded TEXT NOT NULL UNIQUE,
      turma_sistema TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  try {
    db.exec("ALTER TABLE livros ADD COLUMN isbn TEXT");
  } catch (e) { /* Coluna já existe */ }

  // ---- Migration: classificação, gênero e localização física do livro ----
  try {
    db.exec("ALTER TABLE livros ADD COLUMN classificacao TEXT");
  } catch (e) { /* Coluna já existe */ }
  try {
    db.exec("ALTER TABLE livros ADD COLUMN genero TEXT");
  } catch (e) { /* Coluna já existe */ }
  try {
    db.exec("ALTER TABLE livros ADD COLUMN localizacaoLetra TEXT");
  } catch (e) { /* Coluna já existe */ }
  try {
    db.exec("ALTER TABLE livros ADD COLUMN localizacaoNumero INTEGER");
  } catch (e) { /* Coluna já existe */ }

  // ---- Migration: e-mail do usuário (login por e-mail) ----
  try {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  } catch (e) { /* Coluna já existe */ }

  // ---- Migration (Etapa 5): nome de exibição, status e timestamps do usuário ----
  // Perfis individuais: cada bibliotecária tem nome/e-mail/senha próprios.
  try {
    db.exec("ALTER TABLE users ADD COLUMN nome TEXT");
  } catch (e) { /* Coluna já existe */ }
  try {
    db.exec("ALTER TABLE users ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1");
  } catch (e) { /* Coluna já existe */ }
  try {
    db.exec("ALTER TABLE users ADD COLUMN atualizado_em DATETIME");
  } catch (e) { /* Coluna já existe */ }

  // Índice único de e-mail (case-insensitive). Criado após a coluna existir.
  // Usa COLLATE NOCASE para impedir duplicidade independente de maiúsculas.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email COLLATE NOCASE)");

  // ---- Etapa 5: preferências individuais por usuário (tema/cor principal) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      cor_principal TEXT,
      tema TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ---- Migração (correção Etapa 5): recupera as opções de personalização ----
  // que existiam ANTES da Etapa 5 (paleta, cores personalizadas, plano de fundo,
  // opacidade/desfoque e identidade). Agora persistidas POR USUÁRIO no banco.
  // Todas ADITIVAS e idempotentes (try/catch em coluna já existente).
  const colunasPref = [
    'paleta TEXT',                          // chave da paleta rápida (ex.: 'azul')
    'cor_destaque TEXT',                    // hex da cor de destaque
    'cor_fundo TEXT',                       // hex da cor de fundo da tela
    'cor_card TEXT',                        // hex da cor dos cards
    'wallpaper TEXT',                       // 'none' | chave de gradiente | 'custom'
    'wallpaper_imagem TEXT',                // dataURL da imagem enviada (base64)
    'wallpaper_opacidade INTEGER',          // 30..100
    'wallpaper_blur INTEGER',               // 0..20
    'biblioteca_nome TEXT',                 // identidade: nome da biblioteca
    'responsavel_nome TEXT'                 // identidade: nome da responsável
  ];
  for (const col of colunasPref) {
    try { db.exec(`ALTER TABLE user_preferences ADD COLUMN ${col}`); } catch (e) { /* já existe */ }
  }

  // ---- Etapa 5: auditoria leve (quem registrou ações compartilhadas) ----
  // NÃO separa os dados por usuário — apenas registra autoria para histórico.
  for (const tabela of ['emprestimos', 'livros', 'alunos']) {
    for (const coluna of ['criadoPorUserId', 'atualizadoPorUserId']) {
      try {
        db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} INTEGER`);
      } catch (e) { /* Coluna já existe */ }
    }
  }

  // ---- Tabela de bloqueios de alunos (nota < 3,0 => bloqueio de 21 dias) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS bloqueios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alunoId INTEGER NOT NULL,
      dataInicio DATE NOT NULL,
      dataFim DATE NOT NULL,
      motivo TEXT NOT NULL,
      notaNoBloqueio REAL NOT NULL,
      encerrado BOOLEAN NOT NULL DEFAULT 0,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alunoId) REFERENCES alunos(id)
    )
  `);

  // ---- Histórico da avaliação (por que a nota mudou / bloqueios) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS historico_avaliacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alunoId INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      notaAnterior REAL,
      notaNova REAL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alunoId) REFERENCES alunos(id)
    )
  `);

  // Criar tabela de relatórios/notificações
  db.exec(`
    CREATE TABLE IF NOT EXISTS relatorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mensagem TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Tabelas criadas ou já existiam.');

  // ---- Etapa 5: NÃO criamos mais usuário com credenciais padrão (admin/1234) ----
  // Contas reais (Bárbara, Natali, ...) são criadas por fluxo administrativo:
  //   node scripts/create-user.js
  //
  // Aqui apenas MIGRAMOS bases antigas de forma não destrutiva:
  //  - preenche `nome` a partir do username quando estiver vazio;
  //  - garante um e-mail para contas antigas que não tinham (sem inventar
  //    credenciais novas e sem tocar na senha existente).
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  if (totalUsers === 0) {
    console.log('⚠️  Nenhum usuário cadastrado. Crie uma conta com: node scripts/create-user.js');
  } else {
    // Preenche `nome` vazio a partir do username (compatibilidade suave)
    db.prepare(
      "UPDATE users SET nome = username WHERE (nome IS NULL OR nome = '') AND username IS NOT NULL"
    ).run();

    // Contas antigas sem e-mail: usa username@biblioteca.local só para não
    // deixar o e-mail nulo (o e-mail real deve ser definido pelo admin depois).
    const semEmail = db.prepare("SELECT id, username FROM users WHERE email IS NULL OR email = ''").all();
    const setEmail = db.prepare('UPDATE users SET email = ? WHERE id = ?');
    for (const u of semEmail) {
      const base = String(u.username || `usuario${u.id}`).toLowerCase().replace(/[^a-z0-9._-]/g, '');
      try {
        setEmail.run(`${base}@biblioteca.local`, u.id);
        console.log(`E-mail provisório vinculado ao usuário ${u.id}: ${base}@biblioteca.local`);
      } catch (e) {
        console.error(`Não foi possível vincular e-mail provisório ao usuário ${u.id}:`, e.message);
      }
    }
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
  function getDb() {
    if (!sharedDb || !sharedDb.open) {
      sharedDb = new Database(dbPath);
      sharedDb.pragma('journal_mode = WAL');
    }
    return sharedDb;
  }

  // Fecha a conexão compartilhada (usado pela restauração de backup, que
  // precisa substituir o arquivo do banco com segurança antes de reabrir).
  getDb.fechar = function() {
    if (sharedDb && sharedDb.open) {
      try { sharedDb.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
      try { sharedDb.close(); } catch (_) {}
    }
    sharedDb = null;
  };

  // Reabre a conexão (o próximo getDb() a recria). A API de uso é mantida.
  getDb.reabrir = function() {
    getDb.fechar();
    return getDb();
  };

  module.exports = getDb;

} catch (error) {
  console.error('❌ Erro ao inicializar o banco de dados:');
  console.error(error.message);
  process.exit(1);
}
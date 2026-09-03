// server.js - servidor Express: sessão, API e arquivos estáticos (front-end)
const path = require('path');
const express = require('express');
const session = require('express-session');

require('./db'); // garante que o banco e o usuário admin padrão sejam criados

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const alunosRoutes = require('./routes/alunos');
const livrosRoutes = require('./routes/livros');
const emprestimosRoutes = require('./routes/emprestimos');
const turmasRoutes = require('./routes/turmas');
const dashboardRoutes = require('./routes/dashboard');
const rankingRoutes = require('./routes/ranking');
const relatoriosRoutes = require('./routes/relatorios');
const backupRoutes = require('./routes/backup');
const estatisticasRoutes = require('./routes/estatisticas');

const app = express();
const PORT = process.env.PORT || 3000;

// Secret da sessão: SEMPRE via variável de ambiente em produção.
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-' + require('crypto').randomBytes(32).toString('hex');

// Origens permitidas (desenvolvimento). Em produção, defina ALLOWED_ORIGINS.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001').split(',');

app.use(express.json());

// Middleware CORS para desenvolvimento e compatibilidade de origens
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8 // sessão dura 8 horas
  }
}));

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/alunos', requireAuth, alunosRoutes);
app.use('/api/livros', requireAuth, livrosRoutes);
app.use('/api/emprestimos', requireAuth, emprestimosRoutes);
app.use('/api/turmas', requireAuth, turmasRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/ranking', requireAuth, rankingRoutes);
app.use('/api/relatorios', requireAuth, relatoriosRoutes);
app.use('/api/estatisticas', requireAuth, estatisticasRoutes);
app.use('/api/backup', requireAuth, backupRoutes);

// Front-end estático (HTML, CSS, JS)
// Cache curto: evita que usuários fiquem presos em versões antigas do app.js/combobox.js
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache'); // sempre revalida com ETag
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n📚 Sistema da Biblioteca rodando em http://localhost:${PORT}\n`);
});

// Suporte adicional para a porta 3001 caso tente acessar por ela
try {
  const altPort = (PORT === 3000) ? 3001 : 3000;
  const altServer = app.listen(altPort, '0.0.0.0', () => {
    console.log(`📚 Acesso secundário disponível em http://localhost:${altPort}\n`);
  });
  altServer.on('error', () => {
    // Ignora silenciosamente se a porta já estiver em uso
  });
} catch (e) {}

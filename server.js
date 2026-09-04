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

// Secret da sessão: via variável de ambiente em produção.
// Em dev, usamos um secret PERSISTENTE em arquivo: se ele mudar a cada
// reinício, todos os cookies de sessão ficam inválidos e o usuário cai
// em loop de redirecionamento entre login e index.
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  const fs = require('fs');
  const secretFile = path.join(__dirname, '.session-secret');
  try {
    SESSION_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } catch (_) {}
  if (!SESSION_SECRET) {
    SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');
    try { fs.writeFileSync(secretFile, SESSION_SECRET); } catch (_) {}
  }
}

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

// IMPORTANTE: ouvir em APENAS UMA porta.
// Duas portas = dois servidores independentes com memórias de sessão
// diferentes => o login "não cola" e a página fica alternando
// entre login.html e index.html em loop.
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n📚 Sistema da Biblioteca rodando em http://localhost:${PORT}\n`);
});

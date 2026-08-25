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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(session({
  secret: 'troque-esta-chave-secreta-antes-de-usar-em-produção',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8 // sessão dura 8 horas
  }
}));

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/alunos', requireAuth, alunosRoutes);
app.use('/api/livros', requireAuth, livrosRoutes);
app.use('/api/emprestimos', requireAuth, emprestimosRoutes);

// Front-end estático (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`\nSistema da Biblioteca rodando em http://localhost:${PORT}\n`);
});

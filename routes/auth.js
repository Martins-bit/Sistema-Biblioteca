// routes/auth.js - Autenticação: login por e-mail, logout e sessão.
//
// Etapa 5:
// - login APENAS por e-mail + senha;
// - mensagem genérica em qualquer falha ("E-mail ou senha inválidos.");
// - proteção contra força bruta (rate limit);
// - session regeneration no login (evita session fixation);
// - Google OAuth removido;
// - cadastro público removido (contas via scripts/create-user.js).

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const db = require('../db');
const auth = require('../services/auth');
const { garantirToken } = require('../middleware/csrf');

// Mensagem única para qualquer falha de autenticação (evita enumeração).
const MSG_CREDENCIAIS = 'E-mail ou senha inválidos.';

// Rate limit do login: muitas tentativas seguidas => HTTP 429.
// Não bloqueia a conta permanentemente; apenas desacelera a origem.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                  // 10 tentativas por janela por IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' });
  }
});

// GET /api/auth/csrf - devolve o token CSRF da sessão (cria a sessão se preciso).
router.get('/csrf', (req, res) => {
  const token = garantirToken(req);
  // Garante que a sessão (e o token) sejam persistidos antes de responder.
  req.session.save(() => {
    res.json({ csrfToken: token });
  });
});

// POST /api/auth/login - body: { email, password }
router.post('/login', loginLimiter, (req, res) => {
  const email = auth.normalizarEmail(req.body && req.body.email);
  const password = req.body && req.body.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'Informe o e-mail e a senha.' });
  }
  if (!auth.emailValido(email)) {
    // Mesma resposta genérica: não revelamos detalhes de formato/validade.
    return res.status(401).json({ error: MSG_CREDENCIAIS });
  }

  try {
    const conn = db();
    const user = conn.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);

    // Compara mesmo quando o usuário não existe (evita timing/enumeração).
    const hashFalso = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8fvS1WQ0z8wW9b8h9m3nJbDfC0Xq6u';
    const conferiu = auth.senhaConfere(password, user ? user.password_hash : hashFalso);

    if (!user || !conferiu) {
      console.warn('[auth] login falhou');
      return res.status(401).json({ error: MSG_CREDENCIAIS });
    }

    if (user.ativo === 0) {
      return res.status(403).json({ error: 'Esta conta está desativada. Procure a administração.' });
    }

    // Session regeneration: evita session fixation.
    req.session.regenerate((err) => {
      if (err) {
        console.error('[auth] erro ao regenerar sessão:', err.message);
        return res.status(500).json({ error: 'Erro interno do servidor' });
      }
      req.session.userId = user.id;
      req.session.nome = user.nome || user.username || null;
      // Novo token CSRF para a nova sessão.
      garantirToken(req);
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[auth] erro ao salvar sessão:', saveErr.message);
          return res.status(500).json({ error: 'Erro interno do servidor' });
        }
        console.log('[auth] login realizado');
        res.json({ ok: true, user: auth.usuarioPublico(user) });
      });
    });
  } catch (error) {
    console.error('[auth] erro no login:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Cadastro público REMOVIDO (Etapa 5).
// Novas contas são criadas apenas por fluxo administrativo local:
//   node scripts/create-user.js
// Mantemos a rota respondendo 404/405 de forma explícita para não deixar
// endpoints antigos abertos.
router.post('/register', (req, res) => {
  res.status(403).json({ error: 'Cadastro público desativado. Contas são criadas pela administração.' });
});

// POST /api/auth/logout - destrói a sessão.
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[auth] erro no logout:', err.message);
      return res.status(500).json({ error: 'Erro ao fazer logout' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/session - verifica se há sessão ativa.
router.get('/session', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false });
  }
  try {
    const user = db().prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.ativo === 0) {
      return res.status(401).json({ ok: false });
    }
    res.json({ ok: true, user: auth.usuarioPublico(user) });
  } catch (error) {
    console.error('[auth] erro ao verificar sessão:', error.message);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
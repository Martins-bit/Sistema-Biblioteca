// routes/auth.js - Rotas de autenticação (login por e-mail/username, cadastro e Google OAuth)
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcryptjs = require('bcryptjs');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Login
// Aceita { email, password } OU { username, password } (compatibilidade)
router.post('/login', (req, res) => {
  const { email, username, password } = req.body;
  const identificador = String(email || username || '').trim();

  if (!identificador || !password) {
    return res.status(400).json({ error: 'E-mail/usuário e senha são obrigatórios' });
  }

  if (identificador.includes('@') && !EMAIL_RE.test(identificador)) {
    return res.status(400).json({ error: 'E-mail inválido. Verifique e tente novamente.' });
  }

  try {
    const user = identificador.includes('@')
      ? db().prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(identificador.toLowerCase(), identificador)
      : db().prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identificador, identificador.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const passwordMatch = bcryptjs.compareSync(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    // Salvar usuário na sessão
    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, email: user.email || null }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Cadastro de novo usuário (e-mail + senha)
router.post('/register', (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ error: 'Informe um e-mail válido' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
  }

  const emailLimpo = String(email).trim().toLowerCase();
  const nomeUsuario = String(username || emailLimpo.split('@')[0]).trim();

  try {
    const existe = db().prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(emailLimpo, nomeUsuario);
    if (existe) {
      return res.status(409).json({ error: 'Já existe um usuário com este e-mail ou nome de usuário' });
    }

    const hash = bcryptjs.hashSync(String(password), 10);
    const result = db().prepare(
      'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)'
    ).run(nomeUsuario, hash, emailLimpo);

    req.session.userId = result.lastInsertRowid;
    req.session.username = nomeUsuario;

    res.status(201).json({
      ok: true,
      user: { id: result.lastInsertRowid, username: nomeUsuario, email: emailLimpo }
    });
  } catch (error) {
    console.error('Erro no cadastro:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ---- Login com Google (OAuth 2.0 Authorization Code) ----
// Configuração via variáveis de ambiente (NUNCA no código):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL, BASE_URL
// Sem as variáveis configuradas, o botão do Google fica desabilitado no frontend
// e esta rota responde com redirecionamento de volta ao login com erro.

function googleConfigurado() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function callbackUrl(req) {
  return process.env.GOOGLE_CALLBACK_URL ||
    `${process.env.BASE_URL || req.protocol + '://' + req.get('host')}/api/auth/google/callback`;
}

// GET /api/auth/google - inicia o fluxo OAuth
router.get('/google', (req, res) => {
  if (!googleConfigurado()) {
    return res.redirect('/login.html?erro=google-nao-configurado');
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(req),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account'
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

// GET /api/auth/google/callback - troca o código por tokens e cria a sessão
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/login.html?erro=google-cancelado');
  if (!code || !googleConfigurado()) return res.redirect('/login.html?erro=google-nao-configurado');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl(req),
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/login.html?erro=google-token');

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await infoRes.json();
    if (!profile.email) return res.redirect('/login.html?erro=google-perfil');

    const conn = db();
    let user = conn.prepare('SELECT * FROM users WHERE email = ?').get(profile.email.toLowerCase());

    if (!user) {
      // Primeiro acesso via Google: cria o usuário (sem senha local)
      const hash = bcryptjs.hashSync(require('crypto').randomBytes(24).toString('hex'), 10);
      const r = conn.prepare(
        'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)'
      ).run(profile.email.split('@')[0], hash, profile.email.toLowerCase());
      user = { id: r.lastInsertRowid, username: profile.email.split('@')[0], email: profile.email.toLowerCase() };
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/index.html');
  } catch (err) {
    console.error('Erro no login Google:', err);
    res.redirect('/login.html?erro=google-falhou');
  }
});

// GET /api/auth/google/status - informa ao frontend se o Google está configurado
router.get('/google/status', (req, res) => {
  res.json({ habilitado: googleConfigurado() });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao fazer logout' });
    }
    res.clearCookie('connect.sid'); // Nome padrão do cookie do express-session
    res.json({ ok: true });
  });
});

// Verificar sessão
router.get('/session', (req, res) => {
  if (req.session.userId) {
    res.json({
      ok: true,
      user: { id: req.session.userId, username: req.session.username }
    });
  } else {
    res.status(401).json({ ok: false });
  }
});

// Trocar senha
router.post('/change-password', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
  }

  try {
    const user = db().prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const passwordMatch = bcryptjs.compareSync(currentPassword, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    const newPasswordHash = bcryptjs.hashSync(newPassword, 10);

    db().prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(newPasswordHash, req.session.userId);

    res.json({ ok: true, message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Erro ao trocar senha:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;
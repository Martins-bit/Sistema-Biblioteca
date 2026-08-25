// routes/auth.js - Rotas de autenticação
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcryptjs = require('bcryptjs');

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username e senha são obrigatórios' });
  }
  
  try {
    const user = db().prepare('SELECT * FROM users WHERE username = ?').get(username);
    
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
      user: { id: user.id, username: user.username } 
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
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
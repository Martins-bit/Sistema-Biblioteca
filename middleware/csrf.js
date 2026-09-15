// middleware/csrf.js
// Proteção CSRF baseada em token de sessão (synchronizer token), compatível
// com a arquitetura atual (express-session + fetch com credentials).
//
// Como funciona:
// - O token fica guardado na SESSÃO (nunca exposto como cookie manipulável).
// - GET /api/auth/csrf devolve o token para o frontend (mesmo-origem, sessão).
// - Toda requisição mutante (POST/PUT/PATCH/DELETE) em /api precisa enviar o
//   token no header `X-CSRF-Token` igual ao da sessão.
// - Comparação em tempo constante.
//
// Rotas isentas: login e o próprio endpoint que entrega o token (o usuário
// ainda não tem sessão no login; a emissão do token cria a sessão).

const crypto = require('crypto');

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Rotas onde o CSRF é dispensado (login precisa funcionar antes de haver token).
const ISENTAS = new Set([
  '/api/auth/login',
  '/api/auth/csrf'
]);

function garantirToken(req) {
  if (!req.session) return null;
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function iguais(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function csrfProtection(req, res, next) {
  // Só protege a API.
  if (!req.path.startsWith('/api')) return next();
  if (!METODOS_MUTANTES.has(req.method)) return next();
  if (ISENTAS.has(req.path)) return next();

  const tokenSessao = garantirToken(req);
  const tokenEnviado =
    req.get('X-CSRF-Token') ||
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token');

  if (!tokenSessao || !tokenEnviado || !iguais(tokenSessao, tokenEnviado)) {
    return res.status(403).json({ error: 'Requisição inválida (falha de verificação CSRF).' });
  }
  return next();
}

module.exports = { csrfProtection, garantirToken };

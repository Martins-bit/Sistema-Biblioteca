// middleware/requireAuth.js - Middleware de autenticação
function requireAuth(req, res, next) {
  // Verifica se o usuário está autenticado através da sessão
  if (req.session && req.session.userId) {
    return next();
  }
  
  // Se não estiver autenticado, retorna erro 401
  return res.status(401).json({ 
    error: 'Acesso não autorizado. Faça login para continuar.' 
  });
}

module.exports = requireAuth;
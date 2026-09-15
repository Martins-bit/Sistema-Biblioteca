// services/auth.js
// Utilitários de autenticação: validação e hash de senha, validação/normalização
// de e-mail e o "shape" público do usuário (nunca expor password_hash).
//
// Regras:
// - e-mail: obrigatório, trim, lowercase, formato válido;
// - senha: mínimo 8 caracteres, ao menos 1 letra e 1 número;
// - senha nunca em texto puro — sempre bcryptjs.

const bcryptjs = require('bcryptjs');

// Validação de e-mail deliberadamente simples (não tenta cobrir todos os casos
// exóticos do RFC): usuário@domínio.tld, sem espaços.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SENHA_MIN = 8;
const SALT_ROUNDS = 10;

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function emailValido(email) {
  const e = normalizarEmail(email);
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}

// Retorna { ok: true } ou { ok: false, motivo }
function validarSenha(senha) {
  const s = String(senha || '');
  if (s.length < SENHA_MIN) {
    return { ok: false, motivo: `A senha deve ter pelo menos ${SENHA_MIN} caracteres.` };
  }
  if (!/[A-Za-zÀ-ÿ]/.test(s)) {
    return { ok: false, motivo: 'A senha deve conter pelo menos uma letra.' };
  }
  if (!/[0-9]/.test(s)) {
    return { ok: false, motivo: 'A senha deve conter pelo menos um número.' };
  }
  return { ok: true };
}

function hashSenha(senha) {
  return bcryptjs.hashSync(String(senha), SALT_ROUNDS);
}

function senhaConfere(senha, hash) {
  if (!hash) return false;
  try {
    return bcryptjs.compareSync(String(senha), hash);
  } catch (_) {
    return false;
  }
}

// Objeto público do usuário (SEM password_hash).
function usuarioPublico(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome || row.username || null,
    email: row.email || null,
    ativo: row.ativo === undefined ? true : !!row.ativo,
    criado_em: row.criado_em || null,
    atualizado_em: row.atualizado_em || null
  };
}

// Valida um nome de exibição.
function validarNome(nome) {
  const n = String(nome || '').trim();
  if (n.length < 2) return { ok: false, motivo: 'O nome deve ter pelo menos 2 caracteres.' };
  if (n.length > 80) return { ok: false, motivo: 'O nome deve ter no máximo 80 caracteres.' };
  // Sem apenas espaços; permite letras, acentos, espaços, hífen, apóstrofo e ponto.
  if (!/^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .'\-]*$/.test(n)) {
    return { ok: false, motivo: 'O nome contém caracteres não permitidos.' };
  }
  return { ok: true, valor: n };
}

module.exports = {
  EMAIL_RE,
  SENHA_MIN,
  normalizarEmail,
  emailValido,
  validarSenha,
  hashSenha,
  senhaConfere,
  usuarioPublico,
  validarNome
};

// routes/me.js - Perfil do próprio usuário autenticado (Etapa 5).
//
// IMPORTANTE: o usuário é SEMPRE identificado por req.session.userId.
// Nunca aceitamos um user_id enviado pelo frontend para editar a conta.
//
// Endpoints:
//   GET  /api/me                 -> dados do perfil + preferências
//   PUT  /api/me/profile         -> altera o nome de exibição
//   PUT  /api/me/email           -> altera o e-mail (exige senha atual)
//   PUT  /api/me/password        -> altera a senha (exige senha atual)
//   GET  /api/me/preferences     -> lê preferências
//   PUT  /api/me/preferences     -> grava preferências (cor principal / tema)

const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../services/auth');

// Cores principais permitidas (chave -> definição). Guardamos a CHAVE no banco,
// não o hex, para permitir ajustar o tom sem migrar dados.
const CORES_PRINCIPAIS = {
  padrao: { nome: 'Padrão', primary: '#22C55E', dark: '#15803D' },
  azul:   { nome: 'Azul',   primary: '#3B82F6', dark: '#1D4ED8' },
  rosa:   { nome: 'Rosa',   primary: '#EC4899', dark: '#BE185D' },
  verde:  { nome: 'Verde',  primary: '#22C55E', dark: '#15803D' },
  roxo:   { nome: 'Roxo',   primary: '#8B5CF6', dark: '#6D28D9' }
};

const TEMAS = ['claro', 'escuro', 'sistema'];

// Paletas rápidas (as mesmas que existiam antes da Etapa 5).
// Mapeiam para um par primary/dark para aplicar sem guardar hex fixo.
const PALETAS = {
  verde:    { nome: 'Verde Esmeralda', primary: '#22C55E', dark: '#15803D' },
  azul:     { nome: 'Azul Oceano',     primary: '#3B82F6', dark: '#1D4ED8' },
  roxo:     { nome: 'Roxo Real',       primary: '#8B5CF6', dark: '#6D28D9' },
  rosa:     { nome: 'Rosa Vibrante',   primary: '#EC4899', dark: '#BE185D' },
  laranja:  { nome: 'Laranja Solar',   primary: '#F97316', dark: '#C2410C' },
  vermelho: { nome: 'Vermelho Rubi',   primary: '#EF4444', dark: '#B91C1C' },
  ciano:    { nome: 'Ciano Tropical',  primary: '#06B6D4', dark: '#0E7490' },
  indigo:   { nome: 'Índigo Noturno',  primary: '#6366F1', dark: '#4338CA' }
};

// Wallpapers em gradiente (as mesmas opções que existiam antes da Etapa 5).
const WALLPAPERS = {
  none:       { nome: 'Nenhum',              css: null },
  grad_verde: { nome: 'Gradiente Verde',     css: 'linear-gradient(135deg, #d1fae5, #a7f3d0, #6ee7b7)' },
  grad_azul:  { nome: 'Gradiente Azul',      css: 'linear-gradient(135deg, #dbeafe, #bfdbfe, #93c5fd)' },
  grad_rose:  { nome: 'Gradiente Rosé',      css: 'linear-gradient(135deg, #fce7f3, #fbcfe8, #f9a8d4)' },
  grad_ambar: { nome: 'Gradiente Âmbar',     css: 'linear-gradient(135deg, #fef3c7, #fde68a, #fcd34d)' },
  grad_biblio:{ nome: 'Biblioteca Clássica', css: 'linear-gradient(180deg, #fef3c7 0%, #fde68a 50%, #d97706 100%)' },
  custom:     { nome: 'Minha imagem',        css: null }
};

// Valida um hex de cor (#RGB ou #RRGGBB).
function hexValido(v) {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

function getUsuario(conn, userId) {
  return conn.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function getPreferencias(conn, userId) {
  let pref = conn.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
  if (!pref) {
    // Cria preferências padrão na primeira leitura (idempotente).
    conn.prepare('INSERT OR IGNORE INTO user_preferences (user_id, cor_principal, tema) VALUES (?, ?, ?)')
      .run(userId, 'padrao', 'claro');
    pref = conn.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId);
  }
  return pref;
}

// Converte a linha do banco no objeto público consumido pelo frontend.
// Aplica padrões para colunas ainda nulas (bases migradas da Etapa 5 inicial).
function preferenciasPublicas(pref) {
  const p = pref || {};
  const corKey = CORES_PRINCIPAIS[p.cor_principal] ? p.cor_principal : 'padrao';
  const paletaKey = PALETAS[p.paleta] ? p.paleta : null;
  const wallKey = WALLPAPERS[p.wallpaper] ? p.wallpaper : 'none';
  const corBase = CORES_PRINCIPAIS[corKey];

  // Cor de destaque: usa a personalizada se válida; senão a da paleta/cor principal.
  const paletaCor = paletaKey ? PALETAS[paletaKey] : null;
  const destaque = hexValido(p.cor_destaque)
    ? p.cor_destaque
    : (paletaCor ? paletaCor.primary : corBase.primary);
  const destaqueDark = paletaCor ? paletaCor.dark : corBase.dark;

  return {
    cor_principal: corKey,
    tema: TEMAS.includes(p.tema) ? p.tema : 'claro',
    paleta: paletaKey,
    cor_destaque: destaque,
    cor_fundo: hexValido(p.cor_fundo) ? p.cor_fundo : null,
    cor_card: hexValido(p.cor_card) ? p.cor_card : null,
    wallpaper: wallKey === 'custom' && !p.wallpaper_imagem ? 'none' : wallKey,
    wallpaper_css: wallKey === 'custom' ? null : (WALLPAPERS[wallKey] ? WALLPAPERS[wallKey].css : null),
    wallpaper_imagem: p.wallpaper_imagem || null,
    wallpaper_opacidade: Number.isInteger(p.wallpaper_opacidade) ? p.wallpaper_opacidade : 85,
    wallpaper_blur: Number.isInteger(p.wallpaper_blur) ? p.wallpaper_blur : 0,
    biblioteca_nome: p.biblioteca_nome || null,
    responsavel_nome: p.responsavel_nome || null,
    // Catálogos (para o frontend montar a UI sem hard-code).
    cores: CORES_PRINCIPAIS,
    paletas: PALETAS,
    wallpapers: WALLPAPERS,
    temaAplicado: { primary: destaque, dark: destaqueDark }
  };
}

// ---------------------------------------------------------------------------
// GET /api/me - perfil + preferências do usuário autenticado.
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  try {
    const conn = db();
    const user = getUsuario(conn, req.session.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const pref = getPreferencias(conn, user.id);
    res.json({ user: auth.usuarioPublico(user), preferences: preferenciasPublicas(pref) });
  } catch (error) {
    console.error('[me] erro ao carregar perfil:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/me/profile - altera o nome de exibição.
// ---------------------------------------------------------------------------
router.put('/profile', (req, res) => {
  const { nome } = req.body || {};
  const val = auth.validarNome(nome);
  if (!val.ok) return res.status(400).json({ error: val.motivo });

  try {
    const conn = db();
    const user = getUsuario(conn, req.session.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    conn.prepare('UPDATE users SET nome = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
      .run(val.valor, user.id);
    req.session.nome = val.valor;
    console.log('[me] nome alterado');
    res.json({ ok: true, message: 'Nome atualizado com sucesso.', user: auth.usuarioPublico(getUsuario(conn, user.id)) });
  } catch (error) {
    console.error('[me] erro ao alterar nome:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/me/email - altera o e-mail (exige senha atual).
// Body: { email, senhaAtual }
// ---------------------------------------------------------------------------
router.put('/email', (req, res) => {
  const { email, senhaAtual } = req.body || {};
  const novoEmail = auth.normalizarEmail(email);

  if (!auth.emailValido(novoEmail)) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }
  if (!senhaAtual) {
    return res.status(400).json({ error: 'Informe a senha atual.' });
  }

  try {
    const conn = db();
    const user = getUsuario(conn, req.session.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Mensagem genérica em caso de senha incorreta.
    if (!auth.senhaConfere(senhaAtual, user.password_hash)) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }

    if (auth.normalizarEmail(user.email) === novoEmail) {
      return res.status(400).json({ error: 'O novo e-mail é igual ao atual.' });
    }

    // E-mail único (índice COLLATE NOCASE) — checagem explícita para mensagem clara.
    const emUso = conn.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id <> ?').get(novoEmail, user.id);
    if (emUso) {
      return res.status(409).json({ error: 'Este e-mail já está em uso.' });
    }

    try {
      conn.prepare('UPDATE users SET email = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?').run(novoEmail, user.id);
    } catch (e) {
      // Violação de unicidade (corrida) — trata como conflito.
      return res.status(409).json({ error: 'Este e-mail já está em uso.' });
    }

    console.log('[me] e-mail alterado');
    res.json({ ok: true, message: 'E-mail atualizado com sucesso.', user: auth.usuarioPublico(getUsuario(conn, user.id)) });
  } catch (error) {
    console.error('[me] erro ao alterar e-mail:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/me/password - altera a senha (exige senha atual).
// Body: { senhaAtual, novaSenha, confirmarNovaSenha }
// ---------------------------------------------------------------------------
router.put('/password', (req, res) => {
  const { senhaAtual, novaSenha, confirmarNovaSenha, newPassword, currentPassword } = req.body || {};
  const atual = senhaAtual || currentPassword;
  const nova = novaSenha || newPassword;
  const confirmar = confirmarNovaSenha !== undefined ? confirmarNovaSenha : nova;

  if (!atual) return res.status(400).json({ error: 'Informe a senha atual.' });
  if (nova !== confirmar) {
    return res.status(400).json({ error: 'A confirmação da nova senha não confere.' });
  }
  const val = auth.validarSenha(nova);
  if (!val.ok) return res.status(400).json({ error: val.motivo });

  try {
    const conn = db();
    const user = getUsuario(conn, req.session.userId);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    if (!auth.senhaConfere(atual, user.password_hash)) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }
    if (auth.senhaConfere(nova, user.password_hash)) {
      return res.status(400).json({ error: 'A nova senha deve ser diferente da atual.' });
    }

    const hash = auth.hashSenha(nova);
    conn.prepare('UPDATE users SET password_hash = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?')
      .run(hash, user.id);

    console.log('[me] senha alterada');

    // Regera a sessão para invalidar qualquer sessão antiga e manter a atual segura.
    req.session.regenerate((err) => {
      if (err) {
        // A senha já foi alterada; não falhamos a operação por isso.
        console.error('[me] erro ao regenerar sessão após troca de senha:', err.message);
        return res.json({ ok: true, message: 'Senha alterada com sucesso.' });
      }
      req.session.userId = user.id;
      req.session.nome = user.nome || null;
      req.session.save((saveErr) => {
        if (saveErr) console.error('[me] erro ao salvar sessão:', saveErr.message);
        res.json({ ok: true, message: 'Senha alterada com sucesso.' });
      });
    });
  } catch (error) {
    console.error('[me] erro ao alterar senha:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/me/preferences
// ---------------------------------------------------------------------------
router.get('/preferences', (req, res) => {
  try {
    const conn = db();
    const pref = getPreferencias(conn, req.session.userId);
    res.json(preferenciasPublicas(pref));
  } catch (error) {
    console.error('[me] erro ao ler preferências:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/me/preferences - salva as preferências de personalização do usuário.
// Body (todos opcionais):
//   { cor_principal, tema, paleta, cor_destaque, cor_fundo, cor_card,
//     wallpaper, wallpaper_imagem, wallpaper_opacidade, wallpaper_blur,
//     biblioteca_nome, responsavel_nome }
// A linha é identificada SEMPRE pelo req.session.userId (nunca por id do front).
// ---------------------------------------------------------------------------
router.put('/preferences', (req, res) => {
  const body = req.body || {};

  // Valida cada campo presente (mensagem clara em caso de valor inválido).
  if (body.cor_principal !== undefined && !CORES_PRINCIPAIS[body.cor_principal]) {
    return res.status(400).json({ error: 'Cor principal inválida.' });
  }
  if (body.tema !== undefined && !TEMAS.includes(body.tema)) {
    return res.status(400).json({ error: 'Tema inválido.' });
  }
  if (body.paleta !== undefined && body.paleta !== null && !PALETAS[body.paleta]) {
    return res.status(400).json({ error: 'Paleta inválida.' });
  }
  if (body.wallpaper !== undefined && !WALLPAPERS[body.wallpaper]) {
    return res.status(400).json({ error: 'Plano de fundo inválido.' });
  }
  for (const campo of ['cor_destaque', 'cor_fundo', 'cor_card']) {
    if (body[campo] !== undefined && body[campo] !== null && !hexValido(body[campo])) {
      return res.status(400).json({ error: `Cor inválida em ${campo}.` });
    }
  }
  // Imagem enviada como dataURL (limite ~2MB para não inflar o banco).
  if (body.wallpaper_imagem !== undefined && body.wallpaper_imagem !== null) {
    const img = String(body.wallpaper_imagem);
    if (!/^data:image\//i.test(img)) {
      return res.status(400).json({ error: 'Imagem de fundo inválida.' });
    }
    if (img.length > 2 * 1024 * 1024) {
      return res.status(413).json({ error: 'Imagem muito grande (máx. ~2MB).' });
    }
  }
  for (const campo of ['wallpaper_opacidade', 'wallpaper_blur']) {
    if (body[campo] !== undefined && body[campo] !== null && !Number.isInteger(body[campo])) {
      return res.status(400).json({ error: `Valor inválido em ${campo}.` });
    }
  }
  for (const campo of ['biblioteca_nome', 'responsavel_nome']) {
    if (body[campo] !== undefined && body[campo] !== null && String(body[campo]).length > 80) {
      return res.status(400).json({ error: `${campo} excede 80 caracteres.` });
    }
  }

  try {
    const conn = db();
    const userId = req.session.userId;
    const atual = getPreferencias(conn, userId); // garante que a linha existe
    const escolha = (k) => (body[k] !== undefined ? body[k] : atual[k]);

    const novo = {
      cor_principal: body.cor_principal !== undefined ? body.cor_principal : (atual.cor_principal || 'padrao'),
      tema: body.tema !== undefined ? body.tema : (atual.tema || 'claro'),
      paleta: escolha('paleta'),
      cor_destaque: escolha('cor_destaque'),
      cor_fundo: escolha('cor_fundo'),
      cor_card: escolha('cor_card'),
      wallpaper: body.wallpaper !== undefined ? body.wallpaper : (atual.wallpaper || 'none'),
      // Limpar imagem: enviar wallpaper != 'custom' OU wallpaper_imagem = null.
      wallpaper_imagem: body.wallpaper === 'custom'
        ? (body.wallpaper_imagem !== undefined ? body.wallpaper_imagem : atual.wallpaper_imagem)
        : (body.wallpaper_imagem !== undefined ? body.wallpaper_imagem : (body.wallpaper !== undefined ? null : atual.wallpaper_imagem)),
      wallpaper_opacidade: body.wallpaper_opacidade !== undefined ? body.wallpaper_opacidade : (atual.wallpaper_opacidade ?? 85),
      wallpaper_blur: body.wallpaper_blur !== undefined ? body.wallpaper_blur : (atual.wallpaper_blur ?? 0),
      biblioteca_nome: escolha('biblioteca_nome'),
      responsavel_nome: escolha('responsavel_nome')
    };

    conn.prepare(`
      UPDATE user_preferences SET
        cor_principal = ?, tema = ?, paleta = ?, cor_destaque = ?, cor_fundo = ?, cor_card = ?,
        wallpaper = ?, wallpaper_imagem = ?, wallpaper_opacidade = ?, wallpaper_blur = ?,
        biblioteca_nome = ?, responsavel_nome = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(
      novo.cor_principal, novo.tema, novo.paleta, novo.cor_destaque, novo.cor_fundo, novo.cor_card,
      novo.wallpaper, novo.wallpaper_imagem, novo.wallpaper_opacidade, novo.wallpaper_blur,
      novo.biblioteca_nome, novo.responsavel_nome, userId
    );

    const pref = getPreferencias(conn, userId);
    res.json({ ok: true, message: 'Preferências salvas.', preferences: preferenciasPublicas(pref) });
  } catch (error) {
    console.error('[me] erro ao salvar preferências:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Exporta os catálogos para reuso/migração (o frontend os recebe via /api/me).
module.exports = router;
module.exports.CORES_PRINCIPAIS = CORES_PRINCIPAIS;
module.exports.PALETAS = PALETAS;
module.exports.WALLPAPERS = WALLPAPERS;

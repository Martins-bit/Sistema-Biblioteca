// scripts/qa-auth-http.js
// QA de integração HTTP da Etapa 5 (login por e-mail, perfis, preferências,
// compartilhamento dos dados e segurança), rodando num ESPELHO ISOLADO
// (nunca no biblioteca.db real).
//
// Uso: node scripts/qa-auth-http.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MIRROR = path.join(os.tmpdir(), `qa-auth-${Date.now()}`);
const PORT = process.env.QA_PORT || '3987';
const BASE = `http://127.0.0.1:${PORT}`;

let passou = 0, falhou = 0;
const ok = (n) => { passou++; console.log(`  ✔ ${n}`); };
const falha = (n, e) => { falhou++; console.log(`  ✘ ${n} -> ${e}`); };
const verifica = (n, c, d) => c ? ok(n) : falha(n, d === undefined ? 'falso' : d);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function prepararEspelho() {
  fs.mkdirSync(MIRROR, { recursive: true });
  for (const item of ['server.js', 'db.js', 'middleware', 'routes', 'services', 'public', 'package.json', 'scripts']) {
    const src = path.join(ROOT, item);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(MIRROR, item), { recursive: true });
  }
  const nmSrc = path.join(ROOT, 'node_modules');
  const nmDst = path.join(MIRROR, 'node_modules');
  try { fs.symlinkSync(nmSrc, nmDst, 'junction'); } catch (_) { fs.cpSync(nmSrc, nmDst, { recursive: true }); }
}

// Cria duas usuárias no espelho usando o script administrativo real.
function criarUsuarias() {
  const criar = require(path.join(MIRROR, 'scripts', 'create-user.js')).criarUsuario;
  return {
    barbara: criar({ nome: 'Bárbara', email: 'barbara@escola.exemplo', senha: 'Barbara123' }),
    natali: criar({ nome: 'Natali', email: 'natali@escola.exemplo', senha: 'Natali123' })
  };
}

async function main() {
  console.log('\n=== QA HTTP Etapa 5 (espelho isolado) ===');
  prepararEspelho();
  console.log('Espelho:', MIRROR);
  const usuarios = criarUsuarias();
  console.log('Usuárias criadas:', usuarios.barbara.email, '/', usuarios.natali.email);

  const srv = spawn(process.execPath, ['server.js'], {
    cwd: MIRROR, env: { ...process.env, PORT, SESSION_SECRET: 'qa-etapa5' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);

  let subiu = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await fetch(`${BASE}/api/auth/session`);
      if (r.status === 401 || r.ok) { subiu = true; break; }
    } catch (_) {}
  }
  if (!subiu) { console.log('Servidor não subiu:\n', log); srv.kill(); process.exit(1); }

  try {
    // Cliente com cookie-jar e CSRF por sessão.
    function novoCliente() {
      let cookie = '', csrf = null;
      async function req(url, opts = {}) {
        const headers = { ...(opts.headers || {}) };
        if (cookie) headers['Cookie'] = cookie;
        if (opts.json) headers['Content-Type'] = 'application/json';
        const method = (opts.method || 'GET').toUpperCase();
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && csrf && !opts.semCsrf) headers['X-CSRF-Token'] = csrf;
        const res = await fetch(`${BASE}${url}`, { method, headers, body: opts.json ? JSON.stringify(opts.json) : opts.body, redirect: 'manual' });
        const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        for (const c of all) { if (/^connect\.sid=/.test(c)) cookie = c.split(';')[0]; }
        let data = null; try { data = await res.json(); } catch (_) {}
        return { status: res.status, data, res };
      }
      async function refreshCsrf() {
        const c = await req('/api/auth/csrf');
        csrf = c.data && c.data.csrfToken;
        return csrf;
      }
      async function login(email, senha) {
        await refreshCsrf();
        const body = { email: email, password: senha };
        const r = await req('/api/auth/login', { method: 'POST', json: body });
        if (r.status === 200) await refreshCsrf();
        return r;
      }
      return { req: req, login: login, refreshCsrf: refreshCsrf, csrf: csrf };
    }

    // --------------------------------------------------------------------
    console.log('\n[A] Autenticação / enumeração');
    const anon = novoCliente();
    verifica('status sem sessão => 401', (await anon.req('/api/backup/status')).status === 401);
    verifica('/api/me sem sessão => 401', (await anon.req('/api/me')).status === 401);

    const cliA = novoCliente();
    const rLoginOk = await cliA.login('barbara@escola.exemplo', 'Barbara123');
    verifica('login válido => 200 ok', rLoginOk.status === 200 && rLoginOk.data.ok, JSON.stringify(rLoginOk.data));
    verifica('login não retorna password_hash', rLoginOk.data.user && !('password_hash' in rLoginOk.data.user), JSON.stringify(rLoginOk.data.user));
    verifica('login retorna nome/e-mail', rLoginOk.data.user.nome === 'Bárbara' && rLoginOk.data.user.email === 'barbara@escola.exemplo');

    const cliB = novoCliente();
    const loginErrado = await cliB.login('barbara@escola.exemplo', 'SenhaErrada1');
    const loginInexistente = await cliB.login('naoexiste@escola.exemplo', 'Qualquer123');
    verifica('senha incorreta => 401', loginErrado.status === 401);
    verifica('e-mail inexistente => 401', loginInexistente.status === 401);
    verifica('mensagem idêntica (não enumera)',
      loginErrado.data.error === loginInexistente.data.error,
      `"${loginErrado.data.error}" vs "${loginInexistente.data.error}"`);
    verifica('mensagem é "E-mail ou senha inválidos."', loginErrado.data.error === 'E-mail ou senha inválidos.');

    // --------------------------------------------------------------------
    console.log('\n[B] Perfil');
    const me = await cliA.req('/api/me');
    verifica('GET /api/me => 200 com user+preferences', me.status === 200 && me.data.user && me.data.preferences);
    verifica('/api/me não expõe password_hash', !('password_hash' in me.data.user));

    // Alterar nome
    const rNome = await cliA.req('/api/me/profile', { method: 'PUT', json: { nome: 'Bárbara Souza' } });
    verifica('alterar nome => ok', rNome.status === 200 && rNome.data.user.nome === 'Bárbara Souza', JSON.stringify(rNome.data));
    const meNome = await cliA.req('/api/me');
    verifica('nome persiste', meNome.data.user.nome === 'Bárbara Souza');
    // Nome inválido
    const rNomeRuim = await cliA.req('/api/me/profile', { method: 'PUT', json: { nome: 'X' } });
    verifica('nome curto recusado => 400', rNomeRuim.status === 400);

    // --------------------------------------------------------------------
    console.log('\n[C] Alterar e-mail');
    const rEmailSenhaErrada = await cliA.req('/api/me/email', { method: 'PUT', json: { email: 'nova@escola.exemplo', senhaAtual: 'senhaerrada' } });
    verifica('e-mail com senha errada => 401', rEmailSenhaErrada.status === 401);
    const rEmailDup = await cliA.req('/api/me/email', { method: 'PUT', json: { email: 'natali@escola.exemplo', senhaAtual: 'Barbara123' } });
    verifica('e-mail já em uso => 409', rEmailDup.status === 409);
    const rEmailOk = await cliA.req('/api/me/email', { method: 'PUT', json: { email: 'barbara.souza@escola.exemplo', senhaAtual: 'Barbara123' } });
    verifica('alterar e-mail => ok', rEmailOk.status === 200 && rEmailOk.data.user.email === 'barbara.souza@escola.exemplo', JSON.stringify(rEmailOk.data));
    await cliA.refreshCsrf();
    // Login com novo e-mail funciona
    const cliNovoEmail = novoCliente();
    const loginNovo = await cliNovoEmail.login('barbara.souza@escola.exemplo', 'Barbara123');
    verifica('login com novo e-mail funciona', loginNovo.status === 200 && loginNovo.data.ok);
    // Login com e-mail antigo não funciona
    const cliEmailAntigo = novoCliente();
    const loginAntigo = await cliEmailAntigo.login('barbara@escola.exemplo', 'Barbara123');
    verifica('login com e-mail antigo falha', loginAntigo.status === 401);

    // --------------------------------------------------------------------
    console.log('\n[D] Alterar senha');
    const rSenhaAtualErrada = await cliA.req('/api/me/password', { method: 'PUT', json: { senhaAtual: 'errada', novaSenha: 'NovaSenha123', confirmarNovaSenha: 'NovaSenha123' } });
    verifica('senha atual incorreta => 401', rSenhaAtualErrada.status === 401);
    const rSenhaConfere = await cliA.req('/api/me/password', { method: 'PUT', json: { senhaAtual: 'Barbara123', novaSenha: 'NovaSenha123', confirmarNovaSenha: 'Diferente123' } });
    verifica('confirmação diferente => 400', rSenhaConfere.status === 400);
    const rSenhaFraca = await cliA.req('/api/me/password', { method: 'PUT', json: { senhaAtual: 'Barbara123', novaSenha: 'abcdefgh', confirmarNovaSenha: 'abcdefgh' } });
    verifica('nova senha sem número => 400', rSenhaFraca.status === 400);
    const rSenhaOk = await cliA.req('/api/me/password', { method: 'PUT', json: { senhaAtual: 'Barbara123', novaSenha: 'NovaSenha123', confirmarNovaSenha: 'NovaSenha123' } });
    verifica('alterar senha => ok', rSenhaOk.status === 200, JSON.stringify(rSenhaOk.data));
    await cliA.refreshCsrf();
    // Nova senha funciona
    const cliNova = novoCliente();
    const loginNovaSenha = await cliNova.login('barbara.souza@escola.exemplo', 'NovaSenha123');
    verifica('nova senha funciona', loginNovaSenha.status === 200 && loginNovaSenha.data.ok);
    // Senha antiga não funciona
    const cliAntiga = novoCliente();
    const loginSenhaAntiga = await cliAntiga.login('barbara.souza@escola.exemplo', 'Barbara123');
    verifica('senha antiga não funciona', loginSenhaAntiga.status === 401);

    // --------------------------------------------------------------------
    console.log('\n[E] Preferências individuais');
    const prefSemLogin = await cliB.req('/api/me/preferences');
    verifica('preferências sem sessão => 401', prefSemLogin.status === 401, String(prefSemLogin.status));
    // Cliente de Bárbara escolhe azul; Natali escolhe rosa.
    const loginB = await cliB.login('natali@escola.exemplo', 'Natali123');
    verifica('Natali loga', loginB.status === 200);
    const prefB = await cliB.req('/api/me/preferences');
    verifica('preferências padrão existem após login', prefB.status === 200 && !!prefB.data.cor_principal, JSON.stringify(prefB.data));
    const setB = await cliA.req('/api/me/preferences', { method: 'PUT', json: { cor_principal: 'azul', tema: 'escuro' } });
    verifica('Bárbara salva azul/escuro', setB.status === 200 && setB.data.preferences.cor_principal === 'azul' && setB.data.preferences.tema === 'escuro', JSON.stringify(setB.data.preferences));
    const setN = await cliB.req('/api/me/preferences', { method: 'PUT', json: { cor_principal: 'rosa', tema: 'claro' } });
    verifica('Natali salva rosa/claro', setN.status === 200 && setN.data.preferences.cor_principal === 'rosa');
    // Independência: reler cada uma
    const prefAdepois = await cliA.req('/api/me/preferences');
    const prefNdepois = await cliB.req('/api/me/preferences');
    verifica('preferências independentes (Bárbara=azul)', prefAdepois.data.cor_principal === 'azul', JSON.stringify(prefAdepois.data));
    verifica('preferências independentes (Natali=rosa)', prefNdepois.data.cor_principal === 'rosa', JSON.stringify(prefNdepois.data));
    // Cor inválida
    const setInvalida = await cliA.req('/api/me/preferences', { method: 'PUT', json: { cor_principal: 'turquesa' } });
    verifica('cor inválida => 400', setInvalida.status === 400);

    // --------------------------------------------------------------------
    console.log('\n[E2] Personalização COMPLETA (opções recuperadas da versão anterior)');
    const completo = {
      cor_principal: 'azul', tema: 'escuro', paleta: 'azul',
      cor_destaque: '#123456', cor_fundo: '#0a0a0a', cor_card: '#111',
      wallpaper: 'grad_azul', wallpaper_opacidade: 70, wallpaper_blur: 5,
      biblioteca_nome: 'Biblioteca da Bárbara', responsavel_nome: 'Bárbara'
    };
    const setCompleto = await cliA.req('/api/me/preferences', { method: 'PUT', json: completo });
    verifica('salva personalização completa => 200', setCompleto.status === 200, JSON.stringify(setCompleto.data));
    const pc = setCompleto.data.preferences || {};
    verifica('paleta persistida', pc.paleta === 'azul', pc.paleta);
    verifica('cor_fundo persistida', pc.cor_fundo === '#0a0a0a', pc.cor_fundo);
    verifica('wallpaper persistido', pc.wallpaper === 'grad_azul', pc.wallpaper);
    verifica('wallpaper_opacidade persistida', pc.wallpaper_opacidade === 70, String(pc.wallpaper_opacidade));
    verifica('wallpaper_blur persistido', pc.wallpaper_blur === 5, String(pc.wallpaper_blur));
    verifica('biblioteca_nome persistida', pc.biblioteca_nome === 'Biblioteca da Bárbara', pc.biblioteca_nome);
    verifica('catálogo de paletas enviado', !!(pc.paletas && pc.paletas.azul), 'sem paletas');
    verifica('catálogo de wallpapers enviado', !!(pc.wallpapers && pc.wallpapers.grad_azul), 'sem wallpapers');

    const releitura = await cliA.req('/api/me/preferences');
    verifica('persiste no banco (nova leitura)', releitura.data.paleta === 'azul' && releitura.data.cor_fundo === '#0a0a0a');

    const prefN2 = await cliB.req('/api/me/preferences');
    verifica('Natali mantém SUA cor (rosa)', prefN2.data.cor_principal === 'rosa', prefN2.data.cor_principal);
    verifica('Natali não recebeu paleta da Bárbara', prefN2.data.paleta !== 'azul', String(prefN2.data.paleta));
    verifica('Natali não recebeu nome de biblioteca da Bárbara', prefN2.data.biblioteca_nome !== 'Biblioteca da Bárbara', String(prefN2.data.biblioteca_nome));

    verifica('paleta invalida => 400', (await cliA.req('/api/me/preferences', { method: 'PUT', json: { paleta: 'inexistente' } })).status === 400);
    verifica('wallpaper invalido => 400', (await cliA.req('/api/me/preferences', { method: 'PUT', json: { wallpaper: 'xyz' } })).status === 400);
    verifica('cor_fundo invalida => 400', (await cliA.req('/api/me/preferences', { method: 'PUT', json: { cor_fundo: 'azulzinho' } })).status === 400);
    verifica('imagem nao-dataURL => 400', (await cliA.req('/api/me/preferences', { method: 'PUT', json: { wallpaper: 'custom', wallpaper_imagem: 'http://x/y.png' } })).status === 400);
    const imgOk = await cliA.req('/api/me/preferences', { method: 'PUT', json: { wallpaper: 'custom', wallpaper_imagem: 'data:image/png;base64,iVBORw0KG=' } });
    verifica('wallpaper custom com dataURL => 200', imgOk.status === 200 && imgOk.data.preferences.wallpaper === 'custom', JSON.stringify(imgOk.data));

    // --------------------------------------------------------------------
    console.log('\n[F] Dados da biblioteca são compartilhados');
    const livro = await cliA.req('/api/livros', { method: 'POST', json: { titulo: 'Livro Compartilhado', autor: 'Autor', categoria: 'Teste', acervo: 1 } });
    verifica('Bárbara cadastra livro', livro.status === 200 || livro.status === 201, JSON.stringify(livro.data));
    const listaN = await cliB.req('/api/livros');
    const achou = Array.isArray(listaN.data) && listaN.data.some(l => l.titulo === 'Livro Compartilhado');
    verifica('Natali enxerga o livro cadastrado por Bárbara', achou);

    // --------------------------------------------------------------------
    console.log('\n[G] Segurança: outro perfil / CSRF / injeção / XSS');
    // Não é possível informar user_id: as rotas usam a sessão.
    const tentativaOutro = await cliA.req('/api/me/profile', { method: 'PUT', json: { nome: 'Hack', user_id: usuarios.natali.id } });
    const meDepoisHack = await cliA.req('/api/me');
    verifica('user_id do frontend é ignorado (Bárbara altera a si mesma apenas)', meDepoisHack.data.user.id === usuarios.barbara.id, String(meDepoisHack.data.user.id));
    const nataliIntacta = await cliB.req('/api/me');
    verifica('perfil da Natali não foi afetado', nataliIntacta.data.user.nome === 'Natali', nataliIntacta.data.user.nome);

    // CSRF: requisição mutante sem token => 403
    const semCsrf = await cliA.req('/api/me/profile', { method: 'PUT', json: { nome: 'Sem CSRF' }, semCsrf: true });
    verifica('PUT sem token CSRF => 403', semCsrf.status === 403, String(semCsrf.status));

    // SQL injection simples no login
    const cliInj = novoCliente();
    const inj = await cliInj.login("barbara.souza@escola.exemplo' OR '1'='1", 'x');
    verifica('SQL injection no login não autentica', inj.status === 401, String(inj.status));

    // XSS básico: nome com script não é aceito
    const xss = await cliA.req('/api/me/profile', { method: 'PUT', json: { nome: '<script>alert(1)</script>' } });
    verifica('nome com script recusado => 400', xss.status === 400, String(xss.status));

    // --------------------------------------------------------------------
    console.log('\n[H] Logout');
    const rLogout = await cliA.req('/api/auth/logout', { method: 'POST' });
    verifica('logout => ok', rLogout.status === 200 && rLogout.data.ok);
    const apolLogout = await cliA.req('/api/me');
    verifica('após logout, /api/me => 401', apolLogout.status === 401, String(apolLogout.status));

    // --------------------------------------------------------------------
    // Rate limit por ÚLTIMO (ele bloqueia o IP do teste para logins).
    console.log('\n[I] Rate limit (brute force)');
    const cliRL = novoCliente();
    let recebeu429 = false;
    for (let i = 0; i < 16; i++) {
      const r = await cliRL.login('barbara.souza@escola.exemplo', 'Errada' + i + 'x');
      if (r.status === 429) { recebeu429 = true; break; }
    }
    verifica('rate limit dispara HTTP 429', recebeu429);

  } finally {
    srv.kill();
    await sleep(600);
    // Windows pode manter o handle do SQLite por um instante; tenta novamente.
    for (let t = 0; t < 5; t++) {
      try { fs.rmSync(MIRROR, { recursive: true, force: true }); console.log('\nEspelho removido.'); break; }
      catch (e) { if (t === 4) console.log('Aviso ao limpar:', e.message); else await sleep(400); }
    }
  }

  console.log(`\n=== Resultado ===\nPassou: ${passou} | Falhou: ${falhou}`);
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch(e => { console.error('Erro no QA:', e); process.exit(1); });

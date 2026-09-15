export default async function run(page, ui) {
  const out = { pageChecks: {}, consoleErrors: [], failures: [] };
  page.on('pageerror', (e) => out.consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text()); });

  try {
    // ---- Tela de login ----
    out.loginTitle = await page.title();
    out.pageChecks.temEmail = await page.locator('#email').count();
    out.pageChecks.emailType = await page.getAttribute('#email', 'type');
    out.pageChecks.temSenha = await page.locator('#password').count();
    out.pageChecks.temToggleSenha = await page.locator('#toggleSenha').count();
    const bodyTxt = await page.locator('body').innerText();
    out.pageChecks.semGoogle = !/google/i.test(bodyTxt);
    out.pageChecks.semCredenciaisPadrao = !/admin|1234|admin@biblioteca/i.test(bodyTxt);
    out.pageChecks.temAsideDecorativo = await page.locator('.aside').count();
    out.pageChecks.temBotaoEntrar = await page.locator('#loginBtn').count();

    // tenta login com credencial errada -> mensagem genérica
    await page.fill('#email', 'ninguem@escola.exemplo');
    await page.fill('#password', 'Errada12345');
    await page.click('#loginBtn');
    await page.waitForTimeout(1500);
    out.msgErroLogin = await page.locator('#loginMsg').innerText().catch(() => '');

    // Login correto
    await page.fill('#email', 'barbara@escola.exemplo');
    await page.fill('#password', 'Barbara123');
    await page.click('#loginBtn');
    await page.waitForSelector('#secBackup, .sidebar', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    out.url = page.url();

    // ---- App principal: perfil + personalização ----
    out.pageChecks.temNavPerfil = await page.locator('#navMeuPerfil').count();
    out.pageChecks.temAvatarBtn = await page.locator('#perfilBtn').count();
    out.helloText = await page.locator('#helloText').innerText().catch(() => null);
    out.avatarNome = await page.locator('.avatar .name').innerText().catch(() => null);

    // Abre Meu Perfil
    await page.click('#perfilBtn').catch(() => {});
    await page.waitForTimeout(1200);
    out.pageChecks.modalPerfilVisivel = await page.locator('#modalPerfil').isVisible().catch(() => false);
    out.perfil = {
      nome: await page.locator('#perfilNome').innerText().catch(() => null),
      email: await page.locator('#perfilEmail').innerText().catch(() => null),
      status: await page.locator('#perfilStatus').innerText().catch(() => null)
    };
    // Fecha
    await page.click('[data-close-modal="#modalPerfil"]').catch(() => {});
    await page.waitForTimeout(400);

    // Abre Personalização (botão 🎨)
    await page.click('#btnPersonalizarTema').catch(() => {});
    await page.waitForTimeout(800);
    out.pageChecks.modalPersonalizacaoVisivel = await page.locator('#modalPersonalizacao').isVisible().catch(() => false);
    out.pageChecks.temSelectCor = await page.locator('#prefCorPrincipal').count();
    out.pageChecks.temSelectTema = await page.locator('#prefTema').count();
    // Escolhe azul + escuro
    await page.selectOption('#prefCorPrincipal', 'azul').catch(() => {});
    await page.selectOption('#prefTema', 'escuro').catch(() => {});
    await page.waitForTimeout(1200);
    out.corAplicada = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    out.temaAtributo = await page.evaluate(() => document.documentElement.getAttribute('data-tema'));

    // Recarrega e confere persistência (preferência veio do servidor)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    out.aposReload_cor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    out.aposReload_tema = await page.evaluate(() => document.documentElement.getAttribute('data-tema'));
    out.aposReload_avatar = await page.locator('.avatar .name').innerText().catch(() => null);

  } catch (e) {
    out.failures.push(String(e));
  }
  return out;
}

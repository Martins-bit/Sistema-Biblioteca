export default async function run(page, ui) {
  const out = { net404: [], apiMe: [], consoleErrors: [], checks: {}, leaks: {} };
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() === 404) out.net404.push(u);
    if (u.includes('/api/me')) out.apiMe.push({ url: u.replace('http://127.0.0.1:3132', ''), status: r.status() });
  });
  page.on('pageerror', (e) => out.consoleErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') out.consoleErrors.push(m.text()); });

  try {
    // Login
    await page.fill('#email', 'barbara@escola.exemplo');
    await page.fill('#password', 'Barbara123');
    await page.click('#loginBtn');
    await page.waitForSelector('#perfilBtn', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // 1) Meu Perfil (avatar) - NAO pode dar 404
    await page.click('#perfilBtn');
    await page.waitForTimeout(1200);
    out.checks.perfilAbrePeloAvatar = await page.locator('#modalPerfil').isVisible().catch(() => false);
    out.checks.perfilNome = await page.locator('#perfilNome').innerText().catch(() => null);
    out.checks.perfilEmail = await page.locator('#perfilEmail').innerText().catch(() => null);
    out.checks.perfilStatus = await page.locator('#perfilStatus').innerText().catch(() => null);
    await page.click('[data-close-modal="#modalPerfil"]').catch(() => {});
    await page.waitForTimeout(400);

    // 1b) Meu Perfil pelo item de menu
    await page.click('#navMeuPerfil');
    await page.waitForTimeout(1000);
    out.checks.perfilAbrePeloMenu = await page.locator('#modalPerfil').isVisible().catch(() => false);
    await page.click('[data-close-modal="#modalPerfil"]').catch(() => {});
    await page.waitForTimeout(400);

    // 2) Abre a Personalização completa
    await page.click('#btnPersonalizarTema');
    await page.waitForTimeout(800);
    out.checks.modalPersonalizacaoVisivel = await page.locator('#modalPersonalizacao').isVisible().catch(() => false);
    out.checks.temPaletas = await page.locator('#themePalettesContainer .theme-palette-card').count();
    out.checks.temWallpapers = await page.locator('#themeWallpapersContainer .theme-wallpaper-card').count();
    out.checks.temColorPrimary = await page.locator('#themeColorPrimary').count();
    out.checks.temColorBg = await page.locator('#themeColorBg').count();
    out.checks.temColorCard = await page.locator('#themeColorCard').count();
    out.checks.temUpload = await page.locator('#themeWallpaperFileInput').count();
    out.checks.temOpacity = await page.locator('#themeBgOpacity').count();
    out.checks.temBlur = await page.locator('#themeBgBlur').count();
    out.checks.temLibraryName = await page.locator('#themeLibraryName').count();
    out.checks.temLibrarianName = await page.locator('#themeLibrarianName').count();
    out.checks.temRestoreBtn = await page.locator('#btnRestaurarTemaPadrao').count();

    // 3) Escolhe paleta 'roxo' + wallpaper 'grad_rose'
    await page.click('#themePalettesContainer [data-palette="roxo"]');
    await page.waitForTimeout(400);
    await page.click('#themeWallpapersContainer [data-wallpaper="grad_rose"]');
    await page.waitForTimeout(400);
    out.checks.corAplicadaRoxo = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    out.checks.temBgAplicado = await page.evaluate(() => document.body.classList.contains('has-custom-bg'));

    // 4) Identidade + opacidade
    await page.fill('#themeLibraryName', 'Biblioteca Escolar Central');
    await page.fill('#themeLibrarianName', 'Bárbara Souza');
    await page.waitForTimeout(300);

    // 5) Salva
    await page.click('#btnSalvarTema');
    await page.waitForTimeout(1500);
    out.checks.modalFechouAoSalvar = !(await page.locator('#modalPersonalizacao').isVisible().catch(() => true));

    // 6) Recarrega a página e confere persistência vinda do SERVIDOR
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    out.leaks.corAposReload = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    out.leaks.bgAposReload = await page.evaluate(() => document.body.classList.contains('has-custom-bg'));
    out.leaks.helloAposReload = await page.locator('#helloText').innerText().catch(() => null);

    // 7) Confere no banco via API (fonte da verdade)
    out.leaks.prefAPI = await page.evaluate(async () => {
      const r = await fetch('/api/me/preferences', { credentials: 'include' });
      const d = await r.json();
      return { paleta: d.paleta, wallpaper: d.wallpaper, biblioteca_nome: d.biblioteca_nome, responsavel_nome: d.responsavel_nome, cor_principal: d.cor_principal };
    });
  } catch (e) {
    out.checks.erro = String(e);
  }
  return out;
}

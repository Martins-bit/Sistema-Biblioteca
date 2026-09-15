export default async function run(page, ui) {
  const out = { net404: [], api: [], errors: [], results: {} };
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() === 404) out.net404.push(u);
    if (u.includes('/api/me')) out.api.push({ url: u.replace('http://127.0.0.1:3151', ''), status: r.status() });
  });
  page.on('pageerror', (e) => out.errors.push(String(e.message)));

  try {
    await page.fill('#email', 'admin@biblioteca.local');
    await page.fill('#password', '1234');
    await page.click('#loginBtn');
    await page.waitForSelector('#perfilBtn', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    out.results.url = page.url();

    // Clica em Meu Perfil (avatar) — não deve dar 404
    await page.click('#perfilBtn');
    await page.waitForTimeout(1200);
    out.results.modalPerfil = await page.locator('#modalPerfil').isVisible().catch(() => false);
    out.results.nome = await page.locator('#perfilNome').innerText().catch(() => null);
    out.results.email = await page.locator('#perfilEmail').innerText().catch(() => null);

    // Abre personalização completa
    await page.click('[data-close-modal="#modalPerfil"]').catch(() => {});
    await page.waitForTimeout(300);
    await page.click('#btnPersonalizarTema');
    await page.waitForTimeout(800);
    out.results.paletas = await page.locator('#themePalettesContainer .theme-palette-card').count();
    out.results.wallpapers = await page.locator('#themeWallpapersContainer .theme-wallpaper-card').count();
    out.results.temCorBg = await page.locator('#themeColorBg').count();
    out.results.temUpload = await page.locator('#themeWallpaperFileInput').count();
    out.results.temIdentidade = await page.locator('#themeLibraryName').count();
  } catch (e) {
    out.results.error = String(e);
  }
  return out;
}

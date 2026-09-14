export default async function run(page, ui) {
  const out = {};
  const netlog = [];
  page.on('response', (r) => { if (r.url().includes('/api/backup')) netlog.push({ url: r.url().replace('http://127.0.0.1:3123', ''), status: r.status() }); });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  const SP = String.fromCharCode(32);
  const limpar = (s) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean).join(' | ');

  try {
    await page.fill('#email', 'admin');
    await page.fill('#password', '1234');
    await page.click('#loginBtn');
    await page.waitForSelector('#secBackup', { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => { const e = document.querySelector('#backupUltimo'); return e && e.innerText !== 'Carregando\u2026'; }, { timeout: 10000 }).catch(() => {});
    out.ultimoInicial = await page.locator('#backupUltimo').innerText().catch(() => null);

    await page.click('.nav-item[data-nav="relatorios"]').catch((e) => { out.navErr = String(e); });
    await page.waitForTimeout(800);
    out.btnVisivel = await page.locator('#criarBackupBtn').isVisible().catch(() => null);

    await page.click('#criarBackupBtn');
    await page.waitForTimeout(3500);
    out.ultimoAposCriar = await page.locator('#backupUltimo').innerText().catch(() => null);
    out.detalheAposCriar = await page.locator('#backupUltimoDetalhe').innerText().catch(() => null);
    out.historicoAposCriar = limpar(await page.locator('#backupHistorico').innerText().catch(() => ''));
    out.internosAposCriar = limpar(await page.locator('#backupInternos').innerText().catch(() => ''));
    out.toast = await page.locator('#toast').innerText().catch(() => null);

    out.checkboxVisivel = await page.locator('#backupAutomatico').isVisible().catch(() => null);
    await page.check('#backupAutomatico').catch((e) => { out.checkErr = String(e); });
    await page.waitForTimeout(1200);
    out.configFetch = await page.evaluate(async () => {
      const r = await fetch('/api/backup/config', { credentials: 'include' });
      return await r.json();
    });
    await page.uncheck('#backupAutomatico').catch(() => {});

    out.netlog = netlog;
    out.consoleErrors = errs.filter(e => !/401/.test(e));
  } catch (e) { out.error = String(e); }
  return out;
}

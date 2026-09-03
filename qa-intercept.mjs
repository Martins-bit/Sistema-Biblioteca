export default async function (page, url) {
  const capturas = [];
  await page.route('**/app.js*', async (route) => {
    const resp = await route.fetch();
    const body = await resp.text();
    capturas.push({
      url: resp.url(),
      status: resp.status(),
      temInitPasso: body.includes('__initPasso'),
      temProxyCliente: body.includes('proxyCliente'),
      bytes: body.length,
      etag: resp.headers()['etag'] || '',
      cc: resp.headers()['cache-control'] || ''
    });
    await route.fulfill({ response: resp, body });
  });
  await page.goto('http://localhost:3000/login.html', { waitUntil: 'load' });
  await page.fill('#username', 'admin');
  await page.fill('input[type="password"]', '1234');
  await Promise.all([page.waitForURL('**/index.html**', { timeout: 15000 }).catch(() => null), page.click('button[type="submit"]')]);
  await page.waitForTimeout(2500);
  const estado = await page.evaluate(() => ({
    initPasso: typeof window.__initPasso !== 'undefined' ? window.__initPasso : '(ausente)',
    opcoesAluno: document.querySelectorAll('#emprestimoAluno option').length,
    linhasTabela: document.querySelectorAll('#livrosBody tr').length
  }));
  return { capturas, estado };
}
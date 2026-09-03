export default async function run(page, ui) {
  const results = {};
  // 1. Login
  await page.fill('#username', 'admin');
  await page.fill('#password', '1234');
  await Promise.all([
    page.waitForURL('**/index.html', { timeout: 10000 }),
    page.click('#loginBtn')
  ]);
  results.loginRedirect = true;
  await page.waitForTimeout(1500);

  // 2. Verificar topbar com usuário logado
  results.userInfo = await page.evaluate(() => {
    const el = document.querySelector('.avatar .name');
    return el ? el.textContent : null;
  });

  // 3. Abrir dropdown de aluno no empréstimo (combobox)
  await page.click('[data-nav="emprestimos"]').catch(() => { });
  await page.waitForTimeout(800);
  results.cbAlunoVisivel = await page.evaluate(() => {
    const inp = document.querySelector('#emprestimoAluno');
    return !!inp && inp.offsetParent !== null;
  });

  // 4. Gerar relatório
  await page.click('[data-nav="relatorios"]').catch(() => { });
  await page.waitForTimeout(500);
  const gerarBtn = await page.$('#gerarRelatorioBtn');
  if (gerarBtn) { await gerarBtn.click(); await page.waitForTimeout(800); }
  results.reportHTML = await page.evaluate(() => {
    const el = document.querySelector('#reportArea');
    return el ? el.innerText.slice(0, 300) : null;
  });

  return results;
}

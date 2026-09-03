export default async function run(page, ui) {
  const results = {};
  await page.fill('#username', 'admin');
  await page.fill('#password', '1234');
  await Promise.all([
    page.waitForURL('**/index.html', { timeout: 10000 }),
    page.click('#loginBtn')
  ]);
  await page.waitForTimeout(1500);

  results.navLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[data-nav]')).map(a => ({
      nav: a.getAttribute('data-nav'),
      visivel: a.offsetParent !== null
    }))
  );

  await page.evaluate(() => {
    const link = document.querySelector('a[data-nav="emprestimos"]');
    if (link) link.click();
  });
  await page.waitForTimeout(800);

  results.sectionVisivel = await page.evaluate(() => {
    const sec = document.querySelector('#secEmprestimos');
    return sec ? getComputedStyle(sec).display !== 'none' : false;
  });

  results.combobox = await page.evaluate(() => {
    const inp = document.querySelector('#emprestimoAluno');
    if (!inp) return { erro: 'input não encontrado' };
    const opcoes = inp.tagName === 'SELECT' ? inp.options.length : null;
    return { tag: inp.tagName, opcoes, valor: inp.value };
  });

  const cbInput = await page.$('#emprestimoAluno');
  if (cbInput && await cbInput.isVisible()) {
    await cbInput.click();
    await page.waitForTimeout(400);
    results.listaAberta = await page.evaluate(() => {
      const lista = document.querySelector('.cb-list');
      return lista ? { visivel: getComputedStyle(lista).display !== 'none', itens: lista.querySelectorAll('.cb-item').length } : { lista: 'não encontrada' };
    });
  }

  return results;
}

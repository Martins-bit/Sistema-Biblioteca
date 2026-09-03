export default async function run(page, ui) {
  const results = { erros: [] };
  page.on('pageerror', e => results.erros.push('pageerror: ' + e.message));

  // 1. Login
  await page.fill('#username', 'admin');
  await page.fill('#password', '1234');
  await Promise.all([
    page.waitForURL('**/index.html', { timeout: 10000 }),
    page.click('#loginBtn')
  ]);
  await page.waitForTimeout(1500);

  // 2. Ir para Empréstimos
  await page.evaluate(() => document.querySelector('a[data-nav="emprestimos"]').click());
  await page.waitForTimeout(800);

  // 3. Abrir combobox de aluno e verificar opções carregadas
  results.cbAluno = await page.evaluate(() => {
    const sel = document.querySelector('#emprestimoAluno');
    const api = sel.__combobox;
    if (!api) return { erro: 'combobox não inicializado' };
    return { opcoesNoSelect: sel.options.length, valorAtual: sel.value };
  });

  // abrir dropdown pelo box visível
  await page.evaluate(() => document.querySelector('#emprestimoAluno').__combobox.fechar());
  const cbBox = await page.locator('#emprestimoAluno').locator('..').locator('.cb-box');
  await cbBox.click();
  await page.waitForTimeout(400);
  results.dropdownAberto = await page.evaluate(() => {
    const wrap = document.querySelector('#emprestimoAluno').closest('.cb-wrap');
    const list = wrap.querySelector('.cb-list');
    return {
      aberto: wrap.classList.contains('open'),
      itens: list.querySelectorAll('.cb-item').length,
      busca: !!wrap.querySelector('.cb-search')
    };
  });

  // 4. Buscar "Maria" e clicar no item
  await page.fill('.cb-wrap.open .cb-search', 'Maria');
  await page.waitForTimeout(300);
  results.filtrado = await page.evaluate(() =>
    document.querySelector('.cb-wrap.open .cb-list').querySelectorAll('.cb-item').length
  );
  await page.click('.cb-wrap.open .cb-item');
  await page.waitForTimeout(300);
  results.alunoSelecionado = await page.evaluate(() => {
    const sel = document.querySelector('#emprestimoAluno');
    return { valor: sel.value, label: sel.__combobox ? undefined : null };
  });

  return results;
}

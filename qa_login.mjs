// qa_login.mjs — valida o fluxo de login do Sistema Biblioteca
export default async function run(page, ui) {
  const out = [];
  await ui.fill('@e1', 'admin');
  await ui.fill('@e2', '1234');
  await ui.click('@e3');
  await page.waitForTimeout(1500);
  out.push(page.url());
  out.push(await page.evaluate(() => document.body.innerText.slice(0, 800)));
  return out;
}

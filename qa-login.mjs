export default async function run(page, ui) {
  const before = await ui.snapshot();
  const user = before.match(/@(e\d+) textbox "Usuário ou e-mail"/)?.[1];
  const pass = before.match(/@(e\d+) textbox "Senha"/)?.[1];
  const btn = before.match(/@(e\d+) button "Entrar"/)?.[1];
  if (!user || !pass || !btn) return { error: 'campos não encontrados', before };
  await ui.fill(user, 'admin');
  await ui.fill(pass, '1234');
  await ui.click(btn);
  await page.waitForTimeout(1500);
  const after = await ui.snapshot({ full: true });
  return { url: page.url(), after };
}

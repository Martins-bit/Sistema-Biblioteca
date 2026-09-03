export default async function run(page, ui) {
  const login = await ui.snapshot();
  const refs = login.split('\n').filter(l => /textbox|button/.test(l)).join('\n');
  const user = login.match(/@(e\d+)[^\n]*Usuário/)?.[1];
  const pass = login.match(/@(e\d+)[^\n]*Senha/)?.[1];
  const btn = login.match(/@(e\d+)[^\n]*Entrar/)?.[1];
  await ui.fill(user, 'admin'); await ui.fill(pass, '1234'); await ui.click(btn);
  await page.waitForTimeout(1500);
  const depois = await ui.snapshot();
  const nav = depois.split('\n').filter(l => /link|navigation|tab/.test(l)).slice(0, 20).join('\n');
  return { refs, nav: nav || depois.slice(0, 800) };
}

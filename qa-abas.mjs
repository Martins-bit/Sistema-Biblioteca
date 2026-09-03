export default async function run(page, ui) {
  const login = await ui.snapshot();
  const user = login.match(/@(e\d+) textbox "Usuário ou e-mail"/)?.[1];
  const pass = login.match(/@(e\d+) textbox "Senha"/)?.[1];
  const btn = login.match(/@(e\d+) button "Entrar"/)?.[1];
  await ui.fill(user, 'admin'); await ui.fill(pass, '1234'); await ui.click(btn);
  await page.waitForTimeout(1200);
  const results = [];
  for (const aba of ['👨 Alunos', '📖 Livros', '� Estante', '�🔄 Empréstimos', '📊 Relatórios', '🏆 Ranking']) {
    const snap = await ui.snapshot({ full: true });
    const ref = snap.match(new RegExp('@(e\\d+) link "' + aba + '"'))?.[1];
    if (!ref) { results.push({ aba, erro: 'link não encontrado' }); continue; }
    await ui.click(ref);
    await page.waitForTimeout(900);
    const tree = await ui.snapshot({ full: true });
    const linhas = tree.split('\n').filter(l => /heading|erro|Error|tbody|row "/.test(l)).slice(0, 8).join(' | ');
    results.push({ aba, resumo: linhas || tree.slice(0, 300) });
  }
  return results;
}

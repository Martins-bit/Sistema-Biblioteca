// test-qa.mjs
export default async function run(page, ui) {
  const results = {};

  // 1. Fill login
  await page.fill('#username', 'admin');
  await page.fill('#password', '1234');
  await page.click('#loginBtn');
  await page.waitForNavigation().catch(() => { });
  await page.waitForTimeout(1000);
  results.loggedIn = page.url().includes('index.html');

  // 2. Navegar para Livros e Popular
  await page.click('.nav-item[data-nav="livros"]');
  await page.waitForTimeout(500);
  await page.click('#livrosPopularBtn');
  await page.waitForTimeout(500);
  results.livrosCadastrados = await page.evaluate(() => document.querySelectorAll('#livrosBody tr').length);

  // 3. Navegar para Alunos e Cadastrar
  await page.click('.nav-item[data-nav="alunos"]');
  await page.waitForTimeout(500);
  await page.fill('#alunoNome', 'Carlos Eduardo');
  await page.fill('#alunoTurma', '8ºB');
  await page.click('#alunoForm button[type="submit"]');
  await page.waitForTimeout(500);
  results.alunosCadastrados = await page.evaluate(() => document.querySelectorAll('#alunosBody tr').length);

  // 4. Testar Prateleira Virtual
  await page.click('.nav-item[data-nav="prateleira"]');
  await page.waitForTimeout(500);
  results.prateleiraVisible = await page.evaluate(() => {
    const sec = document.querySelector('#secPrateleira');
    return sec && sec.classList.contains('active');
  });
  results.spinesCount = await page.evaluate(() => document.querySelectorAll('.spine-book').length);

  // Alternar para modo Catálogo (Grid)
  await page.click('#btnViewGrid');
  await page.waitForTimeout(300);
  results.gridCardsCount = await page.evaluate(() => document.querySelectorAll('.book-card').length);

  // 5. Testar Detalhes do Livro na Prateleira
  await page.click('.book-card');
  await page.waitForTimeout(300);
  results.modalDetalhesAberto = await page.evaluate(() => document.querySelector('#modalDetalhesLivro').classList.contains('show'));
  await page.click('#modalDetalhesLivro .modal-close-btn');
  await page.waitForTimeout(300);

  // 6. Testar Empréstimo com Vencimento (simular atraso para testar notificações)
  await page.click('.nav-item[data-nav="emprestimos"]');
  await page.waitForTimeout(300);

  // Simular inserção de empréstimo vencido no state
  await page.evaluate(() => {
    const aluno = JSON.parse(localStorage.getItem('biblioteca_alunos_v1') || '[]')[0];
    const livro = JSON.parse(localStorage.getItem('biblioteca_livros_v1') || '[]')[0];
    const emprestimos = JSON.parse(localStorage.getItem('biblioteca_emprestimos_v1') || '[]');
    emprestimos.push({
      id: 'emp_teste_atrasado',
      alunoId: aluno.id,
      livroId: livro.id,
      dataRetirada: '2025-01-01',
      dataLimite: '2025-01-08',
      devolvido: false,
      dataDevolucao: ''
    });
    localStorage.setItem('biblioteca_emprestimos_v1', JSON.stringify(emprestimos));
    location.reload();
  });
  await page.waitForTimeout(1000);

  // Verificar Notificações e Prazos
  results.notifBadgeCount = await page.evaluate(() => document.querySelector('#notifBadge')?.textContent);
  results.dashboardAlertVisible = await page.evaluate(() => document.querySelector('#dashboardAlertBanner')?.style.display !== 'none');

  // Abrir Modal de Notificações
  await page.click('#notifBellBtn');
  await page.waitForTimeout(300);
  results.modalNotifAberto = await page.evaluate(() => document.querySelector('#modalNotificacoes').classList.contains('show'));
  results.notifCardsCount = await page.evaluate(() => document.querySelectorAll('.notif-card').length);
  await page.click('#modalNotificacoes .modal-close-btn');
  await page.waitForTimeout(300);

  // 7. Testar Modal de Scanner QR
  await page.click('.nav-item[data-nav="livros"]');
  await page.waitForTimeout(300);
  await page.click('#btnAbrirScannerLivro');
  await page.waitForTimeout(300);
  results.modalScannerAberto = await page.evaluate(() => document.querySelector('#modalQrScanner').classList.contains('show'));
  await page.click('#btnCancelarScanner');
  await page.waitForTimeout(300);

  // 8. Testar Modal de Etiqueta QR
  await page.click('#livrosBody button[data-action="qr"]');
  await page.waitForTimeout(300);
  results.modalEtiquetaAberto = await page.evaluate(() => document.querySelector('#modalQrEtiqueta').classList.contains('show'));
  results.temQrCodeGerado = await page.evaluate(() => !!document.querySelector('#qrCodeContainer canvas, #qrCodeContainer img'));
  await page.click('#modalQrEtiqueta .modal-close-btn');
  await page.waitForTimeout(300);

  // 9. Testar Modal de Apagar Tudo com Aviso de Backup
  await page.click('#resetBtn');
  await page.waitForTimeout(300);
  results.modalResetAberto = await page.evaluate(() => document.querySelector('#modalConfirmarReset').classList.contains('show'));
  results.temBotaoBackupEApagar = await page.evaluate(() => !!document.querySelector('#btnResetComBackup'));
  results.temBotaoApagarSemBackup = await page.evaluate(() => !!document.querySelector('#btnResetSemBackup'));
  await page.click('#modalConfirmarReset .modal-close-btn');
  await page.waitForTimeout(300);

  return results;
}

import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:3000';
let browser;
let page;
const errorsFound = [];

async function logStep(msg) {
  console.log(`\n➡️  ${msg}`);
}

async function runTests() {
  console.log('🚀 Iniciando bateria completa de testes de sistema...\n');

  // 1. Test Backend APIs via fetch
  await logStep('1. Testando Endpoints da API Backend...');

  try {
    const resLivros = await fetch(`${BASE_URL}/api/livros`);
    console.log('GET /api/livros status:', resLivros.status);
    if (!resLivros.ok) errorsFound.push(`GET /api/livros returned ${resLivros.status}`);
  } catch (err) {
    errorsFound.push(`API Error: ${err.message}`);
  }

  try {
    const resAlunos = await fetch(`${BASE_URL}/api/alunos`);
    console.log('GET /api/alunos status:', resAlunos.status);
    if (!resAlunos.ok) errorsFound.push(`GET /api/alunos returned ${resAlunos.status}`);
  } catch (err) {
    errorsFound.push(`API Error: ${err.message}`);
  }

  try {
    const resEmprestimos = await fetch(`${BASE_URL}/api/emprestimos`);
    console.log('GET /api/emprestimos status:', resEmprestimos.status);
    if (!resEmprestimos.ok) errorsFound.push(`GET /api/emprestimos returned ${resEmprestimos.status}`);
  } catch (err) {
    errorsFound.push(`API Error: ${err.message}`);
  }

  // 2. Launch Browser for UI & UX Tests
  await logStep('2. Iniciando Navegador Headless com Puppeteer...');
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  page = await browser.newPage();

  // Catch page console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('❌ [Browser Console Error]:', msg.text());
      errorsFound.push(`Console error: ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    console.error('❌ [Browser Uncaught Page Error]:', err.message);
    errorsFound.push(`Page error: ${err.message}`);
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
  console.log('Página carregada com sucesso.');

  // 3. Test Login
  await logStep('3. Testando Login Administrativo...');
  await page.type('#loginUsuario', 'admin');
  await page.type('#loginSenha', 'admin');
  await page.click('#formLogin button[type="submit"]');
  await page.waitForTimeout(500);

  const authState = await page.evaluate(() => {
    const overlay = document.getElementById('authOverlay');
    return {
      overlayHidden: overlay.classList.contains('auth-hidden') || overlay.style.display === 'none',
      sidebarVisible: !document.getElementById('sidebar').classList.contains('hidden')
    };
  });
  console.log('Login Auth State:', authState);
  if (!authState.overlayHidden) errorsFound.push('Falha no login: overlay ainda visível');

  // 4. Test Student Creation
  await logStep('4. Testando Cadastro de Aluno...');
  await page.click('.nav-item[data-nav="alunos"]');
  await page.waitForTimeout(400);

  await page.type('#alunoNome', 'Carlos Eduardo Teste');
  await page.type('#alunoTurma', '3º Ano B');
  await page.type('#alunoMatricula', 'MAT-9988');
  await page.click('#formAluno button[type="submit"]');
  await page.waitForTimeout(400);

  const alunoCriado = await page.evaluate(() => {
    const tabela = document.getElementById('tabelaAlunosBody');
    return tabela && tabela.innerText.includes('Carlos Eduardo Teste');
  });
  console.log('Aluno cadastrado e presente na tabela:', alunoCriado);
  if (!alunoCriado) errorsFound.push('Aluno recém-cadastrado não foi encontrado na tabela.');

  // 5. Test Book Creation
  await logStep('5. Testando Cadastro de Livro...');
  await page.click('.nav-item[data-nav="livros"]');
  await page.waitForTimeout(400);

  await page.type('#livroTitulo', 'Livro de Testes Automatizados');
  await page.type('#livroAutor', 'QA Engineer');
  await page.type('#livroCategoria', 'Tecnologia');
  await page.type('#livroAno', '2025');
  await page.type('#livroExemplares', '3');
  await page.click('#formLivro button[type="submit"]');
  await page.waitForTimeout(400);

  const livroCriado = await page.evaluate(() => {
    const tabela = document.getElementById('tabelaLivrosBody');
    return tabela && tabela.innerText.includes('Livro de Testes Automatizados');
  });
  console.log('Livro cadastrado e presente na tabela:', livroCriado);
  if (!livroCriado) errorsFound.push('Livro recém-cadastrado não foi encontrado na tabela.');

  // 6. Test Book QR Label Modal
  await logStep('6. Testando Geração de Etiqueta QR Code...');
  const labelModalSuccess = await page.evaluate(() => {
    const btnQr = document.querySelector('.btn-etiqueta-qr');
    if (btnQr) {
      btnQr.click();
      const modal = document.getElementById('modalQrEtiqueta');
      const qrCanvas = document.getElementById('etiquetaQrCodeContainer')?.querySelector('canvas, img');
      return {
        modalOpened: modal?.classList.contains('active'),
        qrRendered: !!qrCanvas,
        tituloLabel: document.getElementById('etiquetaTituloLivro')?.textContent
      };
    }
    return null;
  });
  console.log('Resultado Modal QR Etiqueta:', labelModalSuccess);
  if (!labelModalSuccess?.modalOpened) errorsFound.push('Modal de etiqueta QR não abriu corretamente.');

  // Close label modal
  await page.evaluate(() => {
    document.getElementById('btnFecharModalEtiqueta')?.click();
  });
  await page.waitForTimeout(300);

  // 7. Test Loan Creation
  await logStep('7. Testando Registro de Empréstimo com Prazo...');
  await page.click('.nav-item[data-nav="emprestimos"]');
  await page.waitForTimeout(400);

  const loanSelectOptions = await page.evaluate(() => {
    const selLivro = document.getElementById('emprestimoLivro');
    const selAluno = document.getElementById('emprestimoAluno');
    return {
      livrosCount: selLivro ? selLivro.options.length : 0,
      alunosCount: selAluno ? selAluno.options.length : 0
    };
  });
  console.log('Opções de seleção de empréstimo:', loanSelectOptions);

  if (loanSelectOptions.livrosCount > 1 && loanSelectOptions.alunosCount > 1) {
    await page.select('#emprestimoLivro', await page.evaluate(() => document.getElementById('emprestimoLivro').options[1].value));
    await page.select('#emprestimoAluno', await page.evaluate(() => document.getElementById('emprestimoAluno').options[1].value));
    await page.select('#emprestimoPrazo', '14'); // 14 dias
    await page.click('#formEmprestimo button[type="submit"]');
    await page.waitForTimeout(400);

    const emprestimoCriado = await page.evaluate(() => {
      const tabela = document.getElementById('tabelaEmprestimosBody');
      return tabela && tabela.children.length > 0;
    });
    console.log('Empréstimo registrado com sucesso na tabela:', emprestimoCriado);
    if (!emprestimoCriado) errorsFound.push('Empréstimo não foi registrado na tabela.');
  } else {
    errorsFound.push('Não há livros ou alunos disponíveis para testar empréstimo.');
  }

  // 8. Test Prateleira Virtual
  await logStep('8. Testando Prateleira Virtual (Agrupamento, Ordenação, Visualização e Detalhes)...');
  await page.click('.nav-item[data-nav="prateleira"]');
  await page.waitForTimeout(400);

  const shelfValidation = await page.evaluate(async () => {
    const results = {};
    const sec = document.getElementById('secPrateleira');
    results.sectionActive = sec && !sec.classList.contains('hidden');

    // Test Grouping by Categoria
    const selAgrup = document.getElementById('shelfGroupBy');
    if (selAgrup) {
      selAgrup.value = 'categoria';
      selAgrup.dispatchEvent(new Event('change'));
    }
    const container = document.getElementById('shelfContainer');
    results.groupCountCategoria = container ? container.querySelectorAll('.shelf-rack').length : 0;

    // Test Sorting
    const selSort = document.getElementById('shelfSortBy');
    if (selSort) {
      selSort.value = 'titulo-desc';
      selSort.dispatchEvent(new Event('change'));
    }

    // Test View Mode Toggle (Estante vs Catalogo)
    const btnGrid = document.getElementById('btnShelfViewGrid');
    if (btnGrid) btnGrid.click();
    results.catalogCards = container ? container.querySelectorAll('.shelf-book-card').length : 0;

    const btnShelf = document.getElementById('btnShelfViewShelf');
    if (btnShelf) btnShelf.click();
    results.spineBooks = container ? container.querySelectorAll('.shelf-book-spine').length : 0;

    // Test Opening Book Detail Modal
    const firstSpine = container ? container.querySelector('.shelf-book-spine') : null;
    if (firstSpine) {
      firstSpine.click();
      const modal = document.getElementById('modalDetalhesLivro');
      results.modalDetalhesOpened = modal && modal.classList.contains('active');
      results.detalheTitulo = document.getElementById('detalheLivroTitulo')?.textContent;
    }

    return results;
  });
  console.log('Validação da Prateleira Virtual:', shelfValidation);
  if (!shelfValidation.sectionActive) errorsFound.push('Seção Prateleira Virtual não ficou ativa ao clicar no menu.');
  if (shelfValidation.groupCountCategoria === 0) errorsFound.push('Nenhum grupo de livros renderizado na prateleira por categoria.');

  // Close book details modal
  await page.evaluate(() => {
    document.getElementById('btnFecharModalDetalhes')?.click();
  });
  await page.waitForTimeout(300);

  // 9. Test Notification Modal
  await logStep('9. Testando Sino e Central de Notificações...');
  const notifModalResult = await page.evaluate(() => {
    const btnBell = document.getElementById('btnNotificacoesTopbar');
    if (btnBell) btnBell.click();
    const modal = document.getElementById('modalNotificacoes');
    const badge = document.getElementById('notifBadge');
    return {
      modalOpened: modal && modal.classList.contains('active'),
      badgeText: badge ? badge.textContent : null,
      tabsCount: document.querySelectorAll('.notif-tab').length
    };
  });
  console.log('Central de Notificações:', notifModalResult);
  if (!notifModalResult.modalOpened) errorsFound.push('Modal de notificações não abriu ao clicar no sino.');

  // Close notif modal
  await page.evaluate(() => {
    document.getElementById('btnFecharModalNotif')?.click();
  });
  await page.waitForTimeout(300);

  // 10. Test Reset Modal (Confirm and Safeguards)
  await logStep('10. Testando Modal de Confirmação do Botão "Apagar Tudo"...');
  await page.click('.nav-item[data-nav="relatorios"]');
  await page.waitForTimeout(400);

  const resetModalResult = await page.evaluate(() => {
    const btnReset = document.getElementById('btnResetarTudo');
    if (btnReset) btnReset.click();
    const modal = document.getElementById('modalConfirmarReset');
    return {
      modalOpened: modal && modal.classList.contains('active'),
      hasBackupButton: !!document.getElementById('btnConfirmarBackupReset'),
      hasDangerousButton: !!document.getElementById('btnConfirmarResetSemBackup'),
      hasCancelButton: !!document.getElementById('btnCancelarReset')
    };
  });
  console.log('Modal de Confirmação de Reset:', resetModalResult);
  if (!resetModalResult.modalOpened) errorsFound.push('Modal de confirmação do Reset não abriu ao clicar no botão Apagar Tudo.');

  // Cancel reset
  await page.evaluate(() => {
    document.getElementById('btnCancelarReset')?.click();
  });
  await page.waitForTimeout(300);

  // 11. Test QR Code Scanner Modal
  await logStep('11. Testando Modal do Scanner QR Code...');
  await page.click('.nav-item[data-nav="livros"]');
  await page.waitForTimeout(400);

  const scannerResult = await page.evaluate(() => {
    const btnScanner = document.getElementById('btnAbrirScannerLivro');
    if (btnScanner) btnScanner.click();
    const modal = document.getElementById('modalQrScanner');
    return {
      modalOpened: modal && modal.classList.contains('active'),
      hasManualInput: !!document.getElementById('inputManualCodigo'),
      hasReaderDiv: !!document.getElementById('qrReaderLivro')
    };
  });
  console.log('Scanner QR Modal:', scannerResult);
  if (!scannerResult.modalOpened) errorsFound.push('Modal do Scanner QR não abriu ao clicar no botão de escanear.');

  // Close scanner modal
  await page.evaluate(() => {
    document.getElementById('btnFecharScanner')?.click();
  });
  await page.waitForTimeout(300);

  // 12. Final Report
  await logStep('📊 RELATÓRIO FINAL DE TESTES');
  if (errorsFound.length === 0) {
    console.log('✅ TODOS OS TESTES PASSARAM COM 100% DE SUCESSO! Nenhum erro encontrado.');
  } else {
    console.log(`⚠️ Foram encontrados ${errorsFound.length} problema(s):`);
    errorsFound.forEach((e, idx) => console.log(`  ${idx + 1}. ${e}`));
  }

  await browser.close();
}

runTests().catch(err => {
  console.error('Erro fatal na execução dos testes:', err);
  if (browser) browser.close();
  process.exit(1);
});

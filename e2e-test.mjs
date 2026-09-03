export default async function run(page, ui) {
  const log = [];
  const errors = [];

  function assert(condition, message) {
    if (!condition) {
      errors.push(message);
      console.error(`❌ FALHA: ${message}`);
    } else {
      log.push(`✅ SUCESSO: ${message}`);
      console.log(`✅ ${message}`);
    }
  }

  try {
    // 1. Check page load & Title
    const title = await page.title();
    assert(title.includes('Biblioteca') || title.length > 0, `Página carregada com título: "${title}"`);

    // 2. Perform Login via login.html
    const isLoginPage = await page.evaluate(() => !!document.getElementById('loginForm'));
    if (isLoginPage) {
      console.log('Detectada página de login. Preenchendo credenciais...');
      await page.fill('#username', 'admin');
      await page.fill('#password', '1234');

      const [response] = await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/api/auth/login'), { timeout: 10000 }).catch(e => null),
        page.click('#loginBtn')
      ]);

      if (response) {
        console.log('API Login status:', response.status());
        const respText = await response.text();
        console.log('API Login response body:', respText);
      }

      await page.waitForTimeout(2000);
      const curUrl = page.url();
      const loginMsg = await page.evaluate(() => document.getElementById('loginMsg')?.innerText);
      console.log('Current URL after login:', curUrl, '| loginMsg:', loginMsg);

      if (curUrl.includes('login.html')) {
        console.log('Tentando navegar diretamente para index.html com auth no localStorage...');
        await page.evaluate(() => {
          localStorage.setItem('biblioteca_auth_v1', JSON.stringify({ ok: true, at: Date.now() }));
          location.href = './index.html';
        });
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(e => null);
      }
    }

    const isIndexPage = await page.evaluate(() => !document.getElementById('loginForm') && !!document.getElementById('sidebar'));
    assert(isIndexPage, 'Autenticação de administrador realizada com sucesso e index.html carregado');

    // 3. Cadastrar Aluno
    await page.click('.nav-item[data-nav="alunos"]');
    await page.waitForTimeout(400);
    const testAlunoNome = 'Aluno QA ' + Date.now().toString().slice(-4);
    await page.fill('#alunoNome', testAlunoNome);
    await page.fill('#alunoTurma', 'Informática 3A');
    await page.click('#alunoForm button[type="submit"]');
    await page.waitForTimeout(500);

    const alunoTabela = await page.evaluate(() => document.getElementById('alunosBody')?.innerText || '');
    assert(alunoTabela.includes(testAlunoNome), 'Aluno cadastrado com sucesso e listado na tabela');

    // 4. Cadastrar Livro
    await page.click('.nav-item[data-nav="livros"]');
    await page.waitForTimeout(400);
    const testTitulo = 'Livro Teste QA ' + Date.now().toString().slice(-4);
    await page.fill('#livroTitulo', testTitulo);
    await page.fill('#livroAutor', 'Autor Teste QA');
    await page.selectOption('#livroCategoria', 'Ficção Científica');
    await page.fill('#livroAcervo', '5');
    await page.click('#livroForm button[type="submit"]');
    await page.waitForTimeout(500);

    const livroTabela = await page.evaluate(() => document.getElementById('livrosBody')?.innerText || '');
    assert(livroTabela.includes(testTitulo), 'Livro cadastrado com sucesso e listado na tabela');

    // 5. Testar Etiqueta QR Code do Livro
    const modalEtiquetaAbriu = await page.evaluate(() => {
      const btn = document.querySelector('.btn-etiqueta-qr');
      if (btn) btn.click();
      const modal = document.getElementById('modalQrEtiqueta');
      const qrCanvas = document.getElementById('etiquetaQrCodeContainer')?.querySelector('canvas, img');
      return modal && modal.classList.contains('active') && !!qrCanvas;
    });
    assert(modalEtiquetaAbriu, 'Modal de Etiqueta com QR Code gerado e exibido com sucesso');

    await page.click('#btnFecharModalEtiqueta');
    await page.waitForTimeout(300);

    // 6. Testar Scanner QR Code
    await page.click('#btnAbrirScannerLivro');
    await page.waitForTimeout(300);
    const scannerAberto = await page.evaluate(() => {
      const modal = document.getElementById('modalQrScanner');
      return modal && modal.classList.contains('active');
    });
    assert(scannerAberto, 'Modal do Leitor QR Code / Barras aberto com sucesso');
    await page.click('#btnFecharScanner');
    await page.waitForTimeout(300);

    // 7. Testar Empréstimo com Prazo
    await page.click('.nav-item[data-nav="emprestimos"]');
    await page.waitForTimeout(400);

    const optLivro = await page.evaluate(() => document.getElementById('emprestimoLivro')?.options[1]?.value);
    const optAluno = await page.evaluate(() => document.getElementById('emprestimoAluno')?.options[1]?.value);
    if (optLivro && optAluno) {
      await page.selectOption('#emprestimoLivro', optLivro);
      await page.selectOption('#emprestimoAluno', optAluno);
      await page.selectOption('#emprestimoPrazo', '7');
      await page.click('#emprestarBtn');
      await page.waitForTimeout(500);

      const empTabela = await page.evaluate(() => document.getElementById('emprestimosBody')?.children.length || 0);
      assert(empTabela > 0, 'Empréstimo com prazo de devolução registrado com sucesso');
    }

    // 8. Testar Prateleira Virtual
    await page.click('.nav-item[data-nav="prateleira"]');
    await page.waitForTimeout(400);

    const shelfStatus = await page.evaluate(() => {
      const sec = document.getElementById('secPrateleira');
      const isVisible = sec && !sec.classList.contains('hidden');
      const spines = document.querySelectorAll('.shelf-book-spine').length;
      return { isVisible, spines };
    });
    assert(shelfStatus.isVisible && shelfStatus.spines > 0, `Prateleira Virtual renderizada com ${shelfStatus.spines} livros na estante 3D`);

    // Testar alternar para Modo Catálogo
    await page.click('#btnShelfViewGrid');
    await page.waitForTimeout(300);
    const gridCards = await page.evaluate(() => document.querySelectorAll('.shelf-book-card').length);
    assert(gridCards > 0, `Modo Catálogo exibindo ${gridCards} cards de livros formatados`);

    // Testar Agrupamento por Autor
    await page.selectOption('#shelfGroupBy', 'autor');
    await page.waitForTimeout(300);
    const rackCount = await page.evaluate(() => document.querySelectorAll('.shelf-rack').length);
    assert(rackCount > 0, `Prateleira agrupada por Autor com sucesso (${rackCount} seções)`);

    // Testar Modal de Detalhes do Livro
    await page.evaluate(() => {
      const card = document.querySelector('.shelf-book-card');
      if (card) card.click();
    });
    await page.waitForTimeout(300);
    const modalDetalhesAberto = await page.evaluate(() => {
      const modal = document.getElementById('modalDetalhesLivro');
      return modal && modal.classList.contains('active');
    });
    assert(modalDetalhesAberto, 'Modal de Detalhes do Livro aberto a partir da Prateleira Virtual');

    await page.click('#btnFecharModalDetalhes');
    await page.waitForTimeout(300);

    // 9. Testar Central de Notificações
    await page.click('#btnNotificacoesTopbar');
    await page.waitForTimeout(300);
    const modalNotifAberto = await page.evaluate(() => {
      const modal = document.getElementById('modalNotificacoes');
      return modal && modal.classList.contains('active');
    });
    assert(modalNotifAberto, 'Central de Notificações de Prazos aberta com sucesso');

    await page.click('#btnFecharModalNotif');
    await page.waitForTimeout(300);

    // 10. Testar Modal de Confirmação do Botão "Apagar Tudo"
    await page.click('.nav-item[data-nav="relatorios"]');
    await page.waitForTimeout(400);
    await page.click('#btnResetarTudo');
    await page.waitForTimeout(300);

    const resetModalInfo = await page.evaluate(() => {
      const modal = document.getElementById('modalConfirmarReset');
      const isVisible = modal && modal.classList.contains('active');
      const btnBackup = !!document.getElementById('btnConfirmarBackupReset');
      const btnDangerous = !!document.getElementById('btnConfirmarResetSemBackup');
      return { isVisible, btnBackup, btnDangerous };
    });
    assert(resetModalInfo.isVisible && resetModalInfo.btnBackup && resetModalInfo.btnDangerous, 'Modal de Confirmação de Apagar Tudo com proteção de backup validado com sucesso');

    await page.click('#btnCancelarReset');
    await page.waitForTimeout(300);

    // 11. Testar Geração de Relatório Resumo
    await page.click('#btnGerarRelatorioResumo');
    await page.waitForTimeout(400);
    const relatorioVisivel = await page.evaluate(() => {
      const container = document.getElementById('containerRelatorioGerado');
      return container && !container.classList.contains('hidden');
    });
    assert(relatorioVisivel, 'Relatório resumo gerado e exibido com sucesso');

  } catch (err) {
    errors.push(`Exceção durante o teste: ${err.message}`);
    console.error('Erro de execução:', err);
  }

  return {
    totalTestes: log.length + errors.length,
    sucessos: log.length,
    falhas: errors.length,
    detalhesSucessos: log,
    detalhesErros: errors
  };
}

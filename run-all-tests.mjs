import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const path = require('path');
const express = require('express');
const session = require('express-session');

require('./db');

const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const alunosRoutes = require('./routes/alunos');
const livrosRoutes = require('./routes/livros');
const emprestimosRoutes = require('./routes/emprestimos');
const turmasRoutes = require('./routes/turmas');
const dashboardRoutes = require('./routes/dashboard');
const rankingRoutes = require('./routes/ranking');
const relatoriosRoutes = require('./routes/relatorios');
const estatisticasRoutes = require('./routes/estatisticas');
const backupRoutes = require('./routes/backup');

const app = express();
const PORT = 3001; // Porta dedicada para testes

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(session({
  secret: 'test-secret-key-123456',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));

app.use('/api/auth', authRoutes);
app.use('/api/alunos', requireAuth, alunosRoutes);
app.use('/api/livros', requireAuth, livrosRoutes);
app.use('/api/emprestimos', requireAuth, emprestimosRoutes);
app.use('/api/turmas', requireAuth, turmasRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);
app.use('/api/ranking', requireAuth, rankingRoutes);
app.use('/api/relatorios', requireAuth, relatoriosRoutes);
app.use('/api/estatisticas', requireAuth, estatisticasRoutes);
app.use('/api/backup', requireAuth, backupRoutes);
app.use(express.static(path.join(process.cwd(), 'public')));

const server = app.listen(PORT, async () => {
  console.log(`\n Servidor de teste ativo em http://localhost:${PORT}\n`);

  try {
    // Import patchright / playwright
    const { chromium } = require('patchright');

    console.log(' Abrindo navegador para testes automatizados E2E...');
    const browser = await chromium.launch({
      headless: true,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    const errors = [];
    const successes = [];

    function testAssert(cond, msg) {
      if (!cond) {
        errors.push(msg);
        console.error(`❌ [FALHA]: ${msg}`);
      } else {
        successes.push(msg);
        console.log(`✅ [OK]: ${msg}`);
      }
    }

    page.on('console', msg => {
      console.log(`[Browser Console ${msg.type()}]:`, msg.text());
    });
    page.on('pageerror', err => {
      console.error('[Browser PageError]:', err.message);
    });

    // 1. Acessar página de login
    await page.goto(`http://localhost:${PORT}/login.html`, { waitUntil: 'networkidle' });
    testAssert(await page.title() === 'Login - Sistema Biblioteca', 'Página de Login carregada');

    // 2. Fazer Login
    await page.fill('#username', 'admin');
    await page.fill('#password', '1234');
    await page.click('#loginBtn');
    await page.waitForNavigation({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    testAssert(page.url().includes('index.html'), 'Redirecionado para index.html após autenticação');

    // 3. Cadastrar Aluno
    await page.click('.nav-item[data-nav="alunos"]');
    await page.waitForTimeout(500);
    const alunoNome = 'Aluno QA ' + Math.floor(Math.random() * 1000);
    await page.fill('#alunoNome', alunoNome);
    // Seleciona a primeira turma disponível (o select é populado dinamicamente via API)
    const temTurma = await page.$eval('#alunoTurma', sel => sel.options.length > 1);
    if (temTurma) {
      await page.selectOption('#alunoTurma', { index: 1 });
    } else {
      testAssert(false, 'Nenhuma turma cadastrada para selecionar no formulário de aluno');
    }
    await page.click('#alunoForm button[type="submit"]');
    await page.waitForTimeout(800);
    const listaAlunos = await page.textContent('#alunosBody');
    testAssert(listaAlunos.includes(alunoNome), `Aluno cadastrado com sucesso e visível na tabela (${alunoNome})`);

    // 4. Cadastrar Livro
    await page.click('.nav-item[data-nav="livros"]');
    await page.waitForTimeout(500);
    const livroTitulo = 'Livro Algoritmos ' + Math.floor(Math.random() * 1000);
    await page.fill('#livroTitulo', livroTitulo);
    await page.fill('#livroAutor', 'Alan Turing');
    await page.selectOption('#livroCategoria', 'Ficção Científica');
    await page.fill('#livroAcervo', '4');
    await page.click('#livroForm button[type="submit"]');
    await page.waitForTimeout(800);
    const listaLivros = await page.textContent('#livrosBody');
    testAssert(listaLivros.includes(livroTitulo), `Livro cadastrado com sucesso e visível na tabela (${livroTitulo})`);

    // 5. Testar Etiqueta QR Code
    const btnQr = await page.$('.btn-etiqueta-qr');
    if (btnQr) {
      await btnQr.click();
      await page.waitForTimeout(300);
      const isModalQrAtivo = await page.$eval('#modalQrEtiqueta', el => el.classList.contains('active'));
      testAssert(isModalQrAtivo, 'Modal de geração de etiqueta com QR Code funciona');
      await page.click('#btnFecharModalEtiqueta');
      await page.waitForTimeout(200);
    }

    // 6. Testar Scanner QR Code
    await page.click('#btnAbrirScannerLivro');
    await page.waitForTimeout(300);
    const isScannerAtivo = await page.$eval('#modalQrScanner', el => el.classList.contains('active'));
    testAssert(isScannerAtivo, 'Modal do Leitor QR Code / Código de Barras abre corretamente');
    await page.click('#btnFecharScanner');
    await page.waitForTimeout(200);

    // 7. Testar Empréstimo com Prazo
    await page.click('.nav-item[data-nav="emprestimos"]');
    await page.waitForTimeout(300);
    const optLivro = await page.$eval('#emprestimoLivro', el => el.options[1]?.value);
    const optAluno = await page.$eval('#emprestimoAluno', el => el.options[1]?.value);
    if (optLivro && optAluno) {
      await page.selectOption('#emprestimoLivro', optLivro);
      await page.selectOption('#emprestimoAluno', optAluno);
      await page.selectOption('#emprestimoPrazo', '14');
      await page.click('#emprestarBtn');
      await page.waitForTimeout(400);
      const empCount = await page.$eval('#emprestimosBody', el => el.children.length);
      testAssert(empCount > 0, 'Empréstimo com cálculo de prazo de devolução registrado com sucesso');
    }

    // 8. Testar Prateleira Virtual (Estante 3D, Catálogo, Agrupamento, Ordenação)
    await page.click('.nav-item[data-nav="prateleira"]');
    await page.waitForTimeout(400);
    const isPrateleiraVisivel = await page.$eval('#secPrateleira', el => el.classList.contains('active') || !el.classList.contains('hidden'));
    testAssert(isPrateleiraVisivel, 'Seção Prateleira Virtual carregada com sucesso');

    const spinesCount = await page.$$eval('.shelf-book-spine', el => el.length);
    testAssert(spinesCount > 0, `Estante 3D renderizou ${spinesCount} lombadas de livros`);

    // Alternar para Modo Catálogo
    await page.click('#btnViewGrid');
    await page.waitForTimeout(400);
    const cardsCount = await page.$$eval('.shelf-book-card', el => el.length);
    testAssert(cardsCount > 0, `Modo Catálogo exibiu ${cardsCount} cards de livros`);

    // Agrupar por Autor
    await page.selectOption('#shelfGroupBy', 'autor');
    await page.waitForTimeout(300);
    const racksCount = await page.$$eval('.shelf-rack', el => el.length);
    testAssert(racksCount > 0, `Prateleiras organizadas dinamicamente por autor (${racksCount} prateleiras)`);

    // 9. Testar Sino e Central de Notificações
    await page.click('#notifBellBtn');
    await page.waitForTimeout(300);
    const isNotifAtivo = await page.$eval('#modalNotificacoes', el => el.classList.contains('active') || el.classList.contains('show'));
    testAssert(isNotifAtivo, 'Central de Notificações de Prazos aberta com sucesso');
    await page.click('button[data-close-modal="#modalNotificacoes"]');
    await page.waitForTimeout(200);

    // 10. Testar Modal de Confirmação do Botão "Apagar Tudo"
    await page.click('.nav-item[data-nav="relatorios"]');
    await page.waitForTimeout(300);
    await page.click('#resetBtn');
    await page.waitForTimeout(300);
    const isResetModalAtivo = await page.$eval('#modalConfirmarReset', el => el.classList.contains('active') || el.classList.contains('show'));
    testAssert(isResetModalAtivo, 'Modal de Confirmação de Apagar Tudo (com opção de backup) exibido');
    await page.click('button[data-close-modal="#modalConfirmarReset"]');
    await page.waitForTimeout(200);

    // 11. Testar Personalização de Cores, Fundo e Identidade Visual
    await page.click('#btnPersonalizarTema');
    await page.waitForTimeout(300);
    const isThemeModalAtivo = await page.$eval('#modalPersonalizacao', el => el.classList.contains('active') || el.classList.contains('show'));
    testAssert(isThemeModalAtivo, 'Modal de Personalização de Cores e Fundo aberto com sucesso');

    // Trocar para a paleta "Azul Real" (ocean)
    const palCardOcean = await page.$('.theme-palette-card[data-palette="ocean"]');
    if (palCardOcean) {
      await palCardOcean.click();
      await page.waitForTimeout(300);
      const rootPrimary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
      testAssert(rootPrimary === '#2563EB', 'Paleta de Cores Dinâmica (Azul Real) aplicada na raiz do CSS');
    }

    // Trocar Plano de Fundo para Galáxia (cosmic)
    const wallCardCosmic = await page.$('.theme-wallpaper-card[data-wallpaper="cosmic"]');
    if (wallCardCosmic) {
      await wallCardCosmic.click();
      await page.waitForTimeout(300);
      const isCustomBgApplied = await page.evaluate(() => document.body.classList.contains('has-custom-bg'));
      testAssert(isCustomBgApplied, 'Papel de parede / Plano de fundo com efeito dinâmico aplicado com sucesso');
    }

    // Salvar e fechar modal de tema
    await page.click('#btnSalvarTema');
    await page.waitForTimeout(300);

    // 12. Testar Confirmação ao Restaurar Tema Padrão Original
    await page.click('#btnPersonalizarTema');
    await page.waitForTimeout(300);
    await page.click('#btnRestaurarTemaPadrao');
    await page.waitForTimeout(300);
    const isConfirmResetTemaAtivo = await page.$eval('#modalConfirmarResetTema', el => el.classList.contains('active') || el.classList.contains('show'));
    testAssert(isConfirmResetTemaAtivo, 'Modal de confirmação antes de restaurar o padrão original exibido com sucesso');
    await page.click('#btnConfirmarRestauracaoTema');
    await page.waitForTimeout(300);
    const restoredPrimary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
    testAssert(restoredPrimary === '#22C55E', 'Tema restaurado para o Verde Esmeralda original após confirmação do usuário');
    await page.click('#btnSalvarTema');
    await page.waitForTimeout(200);

    console.log('\n=============================================');
    console.log(`📊 RESULTADO DOS TESTES: ${successes.length} PASSARAM | ${errors.length} FALHARAM`);
    console.log('=============================================\n');

    await browser.close();
    server.close(() => process.exit(errors.length === 0 ? 0 : 1));

  } catch (err) {
    console.error('Erro fatal durante os testes:', err);
    server.close(() => process.exit(1));
  }
});

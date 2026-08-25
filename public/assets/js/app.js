import { LS_KEYS, load, save, getBackup, setFromBackup } from './storage.js';
import {
  $, $$, uid, normalize, toast, escapeHtml, escapeHtmlAttr,
  openModal, closeModal, parseDateToLocal, formatDateLocal,
  addDaysToDate, getTodayDateStr, getLoanStatus, getCategoryTheme, CATEGORY_THEMES
} from './ui.js';

const LS_AUTH_KEY = 'biblioteca_auth_v1';

const state = {
  alunos: [],
  livros: [],
  emprestimos: [],
  relatorios: [],
};

// Configurações e estados da Prateleira Virtual e filtros
let shelfState = {
  groupBy: 'categoria', // 'categoria', 'autor', 'disponibilidade', 'nenhum'
  sortBy: 'titulo-asc', // 'titulo-asc', 'titulo-desc', 'autor-asc', 'acervo-desc', 'recentes', 'populares'
  filterCategory: '',
  filterStatus: '', // '', 'disponivel', 'esgotado'
  search: '',
  viewMode: 'spines' // 'spines' (Estante 3D) ou 'grid' (Catálogo)
};

let activeEmpFilter = 'todos'; // 'todos', 'vencidos', 'vencendo', 'no_prazo', 'devolvidos'
let activeNotifFilter = 'todos'; // 'todos', 'vencidos', 'breve'
let html5QrCodeScanner = null;
let currentScannerTarget = 'livro'; // 'livro' ou 'emprestimo'

// Controla se um formulário está em modo de edição (guarda o id do registro)
let editingLivroId = null;
let editingAlunoId = null;

function formatarDataHoraExtenso(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `às ${hh}:${mm} de ${dd}/${mo}/${yyyy}`;
}

function addRelatorio(mensagem) {
  state.relatorios = state.relatorios || [];
  state.relatorios.unshift({ id: uid(), mensagem, criadoEm: new Date().toISOString() });
  save(LS_KEYS.relatorios, state.relatorios);
  renderRelatorios();
  renderRelatorioResumo();
}

function ensureSelectOptions() {
  const elAluno = $('#emprestimoAluno');
  const elLivro = $('#emprestimoLivro');
  if (!elAluno || !elLivro) return;

  const currentAlunoVal = elAluno.value;
  const currentLivroVal = elLivro.value;

  elAluno.innerHTML = ['<option value="">Selecione...</option>']
    .concat(state.alunos.map(a => `<option value="${escapeHtmlAttr(a.id)}">${escapeHtml(a.nome)} (${escapeHtml(a.turma)})</option>`))
    .join('');

  elLivro.innerHTML = ['<option value="">Selecione...</option>']
    .concat(state.livros.map(l => {
      const disp = getDisponiveisParaLivro(l);
      const dispText = disp > 0 ? `(${disp} disponível${disp === 1 ? '' : 'is'})` : `(Esgotado)`;
      return `<option value="${escapeHtmlAttr(l.id)}">${escapeHtml(l.titulo)} - ${escapeHtml(l.autor)} ${dispText}</option>`;
    }))
    .join('');

  if (currentAlunoVal) elAluno.value = currentAlunoVal;
  if (currentLivroVal) elLivro.value = currentLivroVal;
}

function getLoanAlerts() {
  const ativos = (state.emprestimos || []).filter(e => !e.devolvido);
  const vencidos = [];
  const vencendoBreve = [];
  const noPrazo = [];

  ativos.forEach(e => {
    const info = getLoanStatus(e);
    if (info.status === 'vencido') {
      vencidos.push({ ...e, info });
    } else if (['vence_hoje', 'vencendo_amanha', 'vencendo_breve'].includes(info.status)) {
      vencendoBreve.push({ ...e, info });
    } else {
      noPrazo.push({ ...e, info });
    }
  });

  return {
    vencidos,
    vencendoBreve,
    noPrazo,
    totalAlertas: vencidos.length + vencendoBreve.length
  };
}

function renderStats() {
  const statLivros = $('#statLivros');
  const statAlunos = $('#statAlunos');
  const statEmpAtivos = $('#statEmprestimosAtivos');
  const statEmpVencidos = $('#statEmprestimosVencidos');
  const livrosCountSmall = $('#livrosCountSmall');
  const alunosCountSmall = $('#alunosCountSmall');

  const livrosCount = Number(state.livros?.length || 0);
  const alunosCount = Number(state.alunos?.length || 0);
  const ativos = (state.emprestimos || []).filter(e => !e.devolvido).length;
  const alerts = getLoanAlerts();

  if (statLivros) statLivros.textContent = String(livrosCount);
  if (statAlunos) statAlunos.textContent = String(alunosCount);
  if (statEmpAtivos) statEmpAtivos.textContent = String(ativos);
  if (statEmpVencidos) statEmpVencidos.textContent = String(alerts.vencidos.length);
  if (livrosCountSmall) livrosCountSmall.textContent = `${livrosCount} livro${livrosCount === 1 ? '' : 's'}`;
  if (alunosCountSmall) alunosCountSmall.textContent = `${alunosCount} aluno${alunosCount === 1 ? '' : 's'}`;
}

function renderLivrosDisponiveisSmall() {
  const el = $('#livrosDisponiveisSmall');
  if (!el) return;

  const totalDisponiveis = (state.livros || []).reduce((acc, l) => {
    return acc + getDisponiveisParaLivro(l);
  }, 0);

  el.textContent = `${Number(totalDisponiveis || 0)} disponíveis`;
}


function getAtivosPorLivro(livroId) {
  return (state.emprestimos || []).filter(e => {
    return !e.devolvido && String(e.livroId) === String(livroId);
  }).length;
}

function getAtivosPorAluno(alunoId) {
  return (state.emprestimos || []).filter(e => {
    return !e.devolvido && String(e.alunoId) === String(alunoId);
  }).length;
}

function getDisponiveisParaLivro(livro) {
  const acervo = Number(livro?.acervo || 0);
  const ativos = getAtivosPorLivro(livro?.id);
  return Math.max(0, acervo - ativos);
}

function renderLivrosTable() {
  const body = $('#livrosBody');
  const empty = $('#livrosEmpty');
  if (!body) return;

  const term = normalize($('#livroBusca')?.value);

  const livros = (state.livros || []).filter(l => {
    if (!term) return true;
    return normalize(`${l.titulo} ${l.autor} ${l.categoria}`).includes(term);
  });

  body.innerHTML = '';
  if (!livros.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  livros.forEach(l => {
    const tr = document.createElement('tr');
    const disponiveis = getDisponiveisParaLivro(l);

    tr.innerHTML = `
      <td><strong>${escapeHtml(l.titulo)}</strong></td>
      <td>${escapeHtml(l.autor)}</td>
      <td><span class="pill">${escapeHtml(l.categoria)}</span></td>
      <td><strong>${Number(disponiveis)}</strong> / ${Number(l.acervo || 1)}</td>
      <td style="text-align:right;">
        <div class="inline-actions">
          <button type="button" class="secondary btn-small" data-action="qr" data-id="${escapeHtmlAttr(l.id)}" title="Gerar Etiqueta QR">🏷️ QR</button>
          <button type="button" class="secondary btn-small" data-action="editar" data-id="${escapeHtmlAttr(l.id)}">Editar</button>
          <button type="button" class="danger btn-small" data-action="apagar" data-id="${escapeHtmlAttr(l.id)}">Apagar</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

function renderAlunosTable() {
  const body = $('#alunosBody');
  const empty = $('#alunosEmpty');
  if (!body) return;

  const term = normalize($('#alunoBusca')?.value);

  const alunos = (state.alunos || []).filter(a => {
    if (!term) return true;
    return normalize(`${a.nome} ${a.turma}`).includes(term);
  });

  body.innerHTML = '';
  if (!alunos.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  alunos.forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(a.nome)}</td>
      <td>${escapeHtml(a.turma)}</td>
      <td style="text-align:right;">
        <div class="inline-actions">
          <button type="button" class="secondary btn-small" data-action="editar" data-id="${escapeHtmlAttr(a.id)}">Editar</button>
          <button type="button" class="danger btn-small" data-action="apagar" data-id="${escapeHtmlAttr(a.id)}">Apagar</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

function resetLivroFormUI() {
  const form = $('#livroForm');
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Cadastrar livro';
  const cancelBtn = $('#livroCancelarEdicaoBtn');
  cancelBtn?.remove();
}

function iniciarEdicaoLivro(id) {
  const l = (state.livros || []).find(x => String(x.id) === String(id));
  if (!l) return;

  const form = $('#livroForm');
  if (!form) return;

  $('#livroTitulo').value = l.titulo;
  $('#livroAutor').value = l.autor;
  $('#livroCategoria').value = l.categoria;
  $('#livroAcervo').value = l.acervo;

  editingLivroId = l.id;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Salvar alterações';

  if (!$('#livroCancelarEdicaoBtn') && submitBtn) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary';
    cancelBtn.id = 'livroCancelarEdicaoBtn';
    cancelBtn.textContent = 'Cancelar edição';
    cancelBtn.addEventListener('click', () => {
      editingLivroId = null;
      resetLivroFormUI();
      form.reset?.();
    });
    submitBtn.insertAdjacentElement('afterend', cancelBtn);
  }

  form.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

function apagarLivro(id) {
  const l = (state.livros || []).find(x => String(x.id) === String(id));
  if (!l) return;

  const ativos = getAtivosPorLivro(l.id);
  if (ativos > 0) {
    toast(`Não é possível apagar "${l.titulo}": existe empréstimo ativo para este livro.`);
    return;
  }

  if (!confirm(`Tem certeza que deseja apagar o livro "${l.titulo}"?`)) return;

  state.livros = state.livros.filter(x => String(x.id) !== String(id));
  addRelatorio(`Livro '${l.titulo}' foi removido ${formatarDataHoraExtenso()}.`);

  if (editingLivroId === l.id) {
    editingLivroId = null;
    resetLivroFormUI();
  }

  persistAll();
  toast('Livro apagado.');
  renderAll();
}

function resetAlunoFormUI() {
  const form = $('#alunoForm');
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Cadastrar aluno';
  const cancelBtn = $('#alunoCancelarEdicaoBtn');
  cancelBtn?.remove();
}

function iniciarEdicaoAluno(id) {
  const a = (state.alunos || []).find(x => String(x.id) === String(id));
  if (!a) return;

  const form = $('#alunoForm');
  if (!form) return;

  $('#alunoNome').value = a.nome;
  $('#alunoTurma').value = a.turma;

  editingAlunoId = a.id;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Salvar alterações';

  if (!$('#alunoCancelarEdicaoBtn') && submitBtn) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary';
    cancelBtn.id = 'alunoCancelarEdicaoBtn';
    cancelBtn.textContent = 'Cancelar edição';
    cancelBtn.addEventListener('click', () => {
      editingAlunoId = null;
      resetAlunoFormUI();
      form.reset?.();
    });
    submitBtn.insertAdjacentElement('afterend', cancelBtn);
  }

  form.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

function apagarAluno(id) {
  const a = (state.alunos || []).find(x => String(x.id) === String(id));
  if (!a) return;

  const ativos = getAtivosPorAluno(a.id);
  if (ativos > 0) {
    toast(`Não é possível apagar "${a.nome}": aluno possui empréstimo(s) ativo(s).`);
    return;
  }

  if (!confirm(`Tem certeza que deseja apagar o aluno "${a.nome}"?`)) return;

  state.alunos = state.alunos.filter(x => String(x.id) !== String(id));
  addRelatorio(`Aluno ${a.nome} foi removido ${formatarDataHoraExtenso()}.`);

  if (editingAlunoId === a.id) {
    editingAlunoId = null;
    resetAlunoFormUI();
  }

  persistAll();
  toast('Aluno apagado.');
  renderAll();
}

function renderEmprestimosTable() {
  const body = $('#emprestimosBody');
  const empty = $('#emprestimosEmpty');
  if (!body) return;

  const term = normalize($('#emprestimoBusca')?.value);

  const findAluno = (id) => (state.alunos || []).find(a => String(a.id) === String(id));
  const findLivro = (id) => (state.livros || []).find(l => String(l.id) === String(id));

  const emprestimos = (state.emprestimos || []).filter(e => {
    const aluno = findAluno(e.alunoId);
    const livro = findLivro(e.livroId);
    const info = getLoanStatus(e);

    // Apply active filter
    if (activeEmpFilter === 'vencidos' && (e.devolvido || info.status !== 'vencido')) return false;
    if (activeEmpFilter === 'vencendo' && (e.devolvido || !['vence_hoje', 'vencendo_amanha', 'vencendo_breve'].includes(info.status))) return false;
    if (activeEmpFilter === 'no_prazo' && (e.devolvido || info.status !== 'no_prazo')) return false;
    if (activeEmpFilter === 'devolvidos' && !e.devolvido) return false;

    if (!term) return true;
    return normalize(`${aluno?.nome || ''} ${aluno?.turma || ''} ${livro?.titulo || ''} ${livro?.autor || ''} ${info.text || ''} ${e.dataRetirada || ''} ${e.dataLimite || ''} ${e.dataDevolucao || ''}`).includes(term);
  }).sort((a, b) => {
    if (a.devolvido === b.devolvido) {
      const da = parseDateToLocal(a.dataRetirada);
      const db = parseDateToLocal(b.dataRetirada);
      const dateA = da ? da.getTime() : 0;
      const dateB = db ? db.getTime() : 0;
      return dateB - dateA;
    }
    return a.devolvido ? 1 : -1;
  });

  body.innerHTML = '';
  if (!emprestimos.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const fmtDate = (s) => formatDateLocal(s);

  emprestimos.forEach(e => {
    const aluno = findAluno(e.alunoId);
    const livro = findLivro(e.livroId);
    const info = getLoanStatus(e);
    const dataLimite = e.dataLimite || addDaysToDate(e.dataRetirada, 7);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(aluno?.nome || 'Aluno')}</strong> <span class="muted" style="font-size:11px;">(${escapeHtml(aluno?.turma || '-')})</span></td>
      <td>${escapeHtml(livro?.titulo || 'Livro')}</td>
      <td>${escapeHtml(fmtDate(e.dataRetirada))}</td>
      <td>${escapeHtml(fmtDate(dataLimite))}</td>
      <td><span class="status-pill ${info.badgeClass}">${info.icon} ${escapeHtml(info.shortText || info.text)}</span></td>
      <td>${e.devolvido ? escapeHtml(fmtDate(e.dataDevolucao)) : '<span class="muted">-</span>'}</td>
      <td style="text-align:right;">
        <div class="inline-actions">
          ${!e.devolvido ? `
            <button type="button" class="secondary btn-small" data-action="notif-copy" data-id="${escapeHtmlAttr(e.id)}" title="Copiar Mensagem WhatsApp">📲 Aviso</button>
            <button type="button" class="secondary btn-small" data-action="dev" data-id="${escapeHtmlAttr(e.id)}">Devolver</button>
          ` : `
            <span class="status-pill badge-returned" style="font-size:11px;">Devolvido</span>
          `}
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

function renderNotificationsAndAlerts() {
  const alerts = getLoanAlerts();
  const notifBadge = $('#notifBadge');
  const banner = $('#dashboardAlertBanner');
  const bannerTitle = $('#alertBannerTitle');
  const bannerDesc = $('#alertBannerDesc');
  const totalCount = $('#notifTotalCount');
  const vencidosCount = $('#notifVencidosCount');
  const breveCount = $('#notifBreveCount');

  // Topbar Notification Bell
  if (notifBadge) {
    if (alerts.totalAlertas > 0) {
      notifBadge.textContent = String(alerts.totalAlertas);
      notifBadge.style.display = 'flex';
      notifBadge.style.background = alerts.vencidos.length > 0 ? '#ef4444' : '#f59e0b';
    } else {
      notifBadge.style.display = 'none';
    }
  }

  // Dashboard Alert Banner
  if (banner) {
    if (alerts.vencidos.length > 0) {
      banner.style.display = 'flex';
      if (bannerTitle) bannerTitle.textContent = `⚠️ Atenção: ${alerts.vencidos.length} empréstimo${alerts.vencidos.length === 1 ? '' : 's'} com prazo VENCIDO!`;
      if (bannerDesc) bannerDesc.textContent = `Alunos em atraso precisam ser notificados para devolver ou renovar seus livros.`;
    } else if (alerts.vencendoBreve.length > 0) {
      banner.style.display = 'flex';
      banner.style.background = 'linear-gradient(135deg, #fffbeb, #fef3c7)';
      banner.style.borderColor = '#fcd34d';
      if (bannerTitle) {
        bannerTitle.textContent = `⏳ ${alerts.vencendoBreve.length} empréstimo${alerts.vencendoBreve.length === 1 ? '' : 's'} vencendo em breve!`;
        bannerTitle.style.color = '#92400e';
      }
      if (bannerDesc) {
        bannerDesc.textContent = `Verifique os prazos próximos para organizar o acervo.`;
        bannerDesc.style.color = '#78350f';
      }
    } else {
      banner.style.display = 'none';
    }
  }

  if (totalCount) totalCount.textContent = String(alerts.totalAlertas);
  if (vencidosCount) vencidosCount.textContent = String(alerts.vencidos.length);
  if (breveCount) breveCount.textContent = String(alerts.vencendoBreve.length);

  renderNotificationsModalList();
}

function renderNotificationsModalList() {
  const container = $('#notifListContainer');
  const empty = $('#notifEmpty');
  if (!container) return;

  const alerts = getLoanAlerts();
  let list = [];

  if (activeNotifFilter === 'vencidos') {
    list = alerts.vencidos;
  } else if (activeNotifFilter === 'breve') {
    list = alerts.vencendoBreve;
  } else {
    list = [...alerts.vencidos, ...alerts.vencendoBreve];
  }

  container.innerHTML = '';
  if (!list.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const findAluno = (id) => (state.alunos || []).find(a => String(a.id) === String(id));
  const findLivro = (id) => (state.livros || []).find(l => String(l.id) === String(id));

  list.forEach(e => {
    const aluno = findAluno(e.alunoId);
    const livro = findLivro(e.livroId);
    const isVencido = e.info.status === 'vencido';

    const card = document.createElement('div');
    card.className = `notif-card ${isVencido ? 'overdue' : 'warning'}`;
    card.innerHTML = `
      <div class="notif-card-header">
        <div>
          <span class="notif-student">👨 ${escapeHtml(aluno?.nome || 'Aluno')}</span>
          <span class="pill" style="font-size: 11px; padding: 2px 8px; margin-left: 6px;">Turma: ${escapeHtml(aluno?.turma || '-')}</span>
        </div>
        <span class="status-pill ${e.info.badgeClass}">${e.info.icon} ${escapeHtml(e.info.text)}</span>
      </div>
      <div class="notif-book">📖 Livro: <strong>${escapeHtml(livro?.titulo || 'Livro')}</strong> (${escapeHtml(livro?.autor || 'Autor')})</div>
      <div class="notif-meta">
        <span>📅 Retirado em: <strong>${formatDateLocal(e.dataRetirada)}</strong></span>
        <span>⏰ Prazo Limite: <strong>${formatDateLocal(e.info.dataLimite)}</strong></span>
      </div>
      <div class="notif-actions">
        <button type="button" class="btn-small secondary" data-action="notif-copy" data-id="${escapeHtmlAttr(e.id)}">📲 Copiar Mensagem WhatsApp</button>
        <button type="button" class="btn-small" data-action="notif-dev" data-id="${escapeHtmlAttr(e.id)}" style="background: var(--primary);">✅ Devolver Livro</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function copiarAvisoWhatsApp(emprestimoId) {
  const e = (state.emprestimos || []).find(x => String(x.id) === String(emprestimoId));
  if (!e) return;

  const aluno = (state.alunos || []).find(a => String(a.id) === String(e.alunoId));
  const livro = (state.livros || []).find(l => String(l.id) === String(e.livroId));
  const info = getLoanStatus(e);
  const dataLimiteFmt = formatDateLocal(info.dataLimite);
  const dataRetiradaFmt = formatDateLocal(e.dataRetirada);

  const texto = info.status === 'vencido'
    ? `Olá, ${aluno?.nome || 'Aluno'}! 👋\nLembramos que o prazo de devolução do livro "${livro?.titulo || 'Livro'}", retirado na Biblioteca Escolar em ${dataRetiradaFmt}, VENCEU em ${dataLimiteFmt} (${info.text}).\n\nPor favor, compareça à biblioteca para devolução ou renovação. Obrigado!`
    : `Olá, ${aluno?.nome || 'Aluno'}! 👋\nLembramos que o prazo de devolução do livro "${livro?.titulo || 'Livro'}", retirado na Biblioteca Escolar em ${dataRetiradaFmt}, está próximo do vencimento (${dataLimiteFmt}).\n\nCaso já tenha terminado a leitura, você pode fazer a devolução na biblioteca. Obrigado!`;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(texto).then(() => {
      toast('Mensagem de aviso copiada para a área de transferência!', 'success');
    }).catch(() => {
      prompt('Copie a mensagem de aviso abaixo:', texto);
    });
  } else {
    prompt('Copie a mensagem de aviso abaixo:', texto);
  }
}

// ==========================================
// 4. PRATELEIRA VIRTUAL (ORGANIZAÇÃO E VISUALIZAÇÃO)
// ==========================================

function renderPrateleiraVirtual() {
  const container = $('#shelfContainer');
  const countEl = $('#prateleiraTotalLivros');
  const catFilterSelect = $('#shelfFilterCategory');
  if (!container) return;

  const livrosList = state.livros || [];
  if (countEl) countEl.textContent = `${livrosList.length} livro${livrosList.length === 1 ? '' : 's'} no acervo`;

  // Atualizar opções do filtro de categoria
  if (catFilterSelect) {
    const currentCat = shelfState.filterCategory;
    const cats = Array.from(new Set(livrosList.map(l => l.categoria).filter(Boolean))).sort();
    catFilterSelect.innerHTML = '<option value="">Todas as Categorias</option>' +
      cats.map(c => `<option value="${escapeHtmlAttr(c)}" ${c === currentCat ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }

  // 1. Filtrar livros
  const term = normalize(shelfState.search);
  let filtered = livrosList.filter(l => {
    if (shelfState.filterCategory && l.categoria !== shelfState.filterCategory) return false;

    const disp = getDisponiveisParaLivro(l);
    if (shelfState.filterStatus === 'disponivel' && disp <= 0) return false;
    if (shelfState.filterStatus === 'esgotado' && disp > 0) return false;

    if (!term) return true;
    return normalize(`${l.titulo} ${l.autor} ${l.categoria}`).includes(term);
  });

  // 2. Ordenar livros
  filtered.sort((a, b) => {
    switch (shelfState.sortBy) {
      case 'titulo-desc':
        return b.titulo.localeCompare(a.titulo, 'pt-BR');
      case 'autor-asc':
        return a.autor.localeCompare(b.autor, 'pt-BR');
      case 'acervo-desc':
        return (b.acervo || 1) - (a.acervo || 1);
      case 'populares': {
        const empA = (state.emprestimos || []).filter(e => String(e.livroId) === String(a.id)).length;
        const empB = (state.emprestimos || []).filter(e => String(e.livroId) === String(b.id)).length;
        return empB - empA;
      }
      case 'recentes':
        return (b.criadoEm || '').localeCompare(a.criadoEm || '');
      case 'titulo-asc':
      default:
        return a.titulo.localeCompare(b.titulo, 'pt-BR');
    }
  });

  // 3. Agrupar livros em estantes
  let groups = [];
  if (shelfState.groupBy === 'categoria') {
    const map = {};
    filtered.forEach(l => {
      const k = l.categoria || 'Outro';
      if (!map[k]) map[k] = [];
      map[k].push(l);
    });
    groups = Object.keys(map).sort().map(cat => {
      const theme = getCategoryTheme(cat);
      return { title: `${theme.icon} ${cat}`, count: map[cat].length, books: map[cat] };
    });
  } else if (shelfState.groupBy === 'autor') {
    const map = {};
    filtered.forEach(l => {
      const k = l.autor || 'Autor Desconhecido';
      if (!map[k]) map[k] = [];
      map[k].push(l);
    });
    groups = Object.keys(map).sort().map(author => {
      return { title: `✍️ ${author}`, count: map[author].length, books: map[author] };
    });
  } else if (shelfState.groupBy === 'disponibilidade') {
    const dispBooks = filtered.filter(l => getDisponiveisParaLivro(l) > 0);
    const outBooks = filtered.filter(l => getDisponiveisParaLivro(l) <= 0);
    if (dispBooks.length) groups.push({ title: '🟢 Livros com Exemplares Disponíveis', count: dispBooks.length, books: dispBooks });
    if (outBooks.length) groups.push({ title: '🔴 Livros com Todos os Exemplares Emprestados', count: outBooks.length, books: outBooks });
  } else {
    // Estante única contínua
    groups = [{ title: '📚 Acervo Completo da Biblioteca', count: filtered.length, books: filtered }];
  }

  container.innerHTML = '';
  if (!filtered.length) {
    container.innerHTML = `
      <div style="background:#ffffff; border:1px solid var(--border); border-radius:16px; padding:36px 20px; text-align:center;">
        <div style="font-size:40px; margin-bottom:8px;">🔍</div>
        <h4 style="margin:0 0 6px; font-weight:900;">Nenhum livro encontrado na prateleira</h4>
        <p style="margin:0; font-size:13px; color:var(--muted);">Tente ajustar a busca ou os filtros de categoria e disponibilidade.</p>
      </div>
    `;
    return;
  }

  // 4. Renderizar grupos (Modo Estante de Madeira ou Modo Catálogo)
  if (shelfState.viewMode === 'grid') {
    // Visualização em Grade de Cards Modernos
    groups.forEach(g => {
      const groupEl = document.createElement('div');
      groupEl.style.marginBottom = '24px';
      groupEl.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
          <h3 style="margin:0; font-size:16px; font-weight:1000; color:var(--text);">${escapeHtml(g.title)}</h3>
          <span class="pill">${g.count} livro${g.count === 1 ? '' : 's'}</span>
        </div>
        <div class="shelf-grid">
          ${g.books.map(l => {
            const disp = getDisponiveisParaLivro(l);
            const theme = getCategoryTheme(l.categoria);
            const isAvailable = disp > 0;
            return `
              <div class="book-card" data-action="ver-livro" data-id="${escapeHtmlAttr(l.id)}">
                <div class="book-card-cover" style="background: ${theme.bg};">
                  <div class="book-card-cover-top">
                    <span class="book-card-icon">${theme.icon}</span>
                    <span class="status-pill ${isAvailable ? 'badge-ok' : 'badge-overdue'}" style="font-size:10px; padding:2px 8px;">
                      ${isAvailable ? `${disp} disp.` : 'Esgotado'}
                    </span>
                  </div>
                  <div class="book-card-cover-title">${escapeHtml(l.titulo)}</div>
                </div>
                <div class="book-card-body">
                  <div class="book-card-author">✍️ ${escapeHtml(l.autor)}</div>
                  <div class="book-card-footer">
                    <span class="muted">${escapeHtml(l.categoria)}</span>
                    <span>Total: <strong>${Number(l.acervo || 1)}</strong></span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
      container.appendChild(groupEl);
    });
  } else {
    // Visualização em Estantes de Madeira 3D Realistas
    groups.forEach(g => {
      const section = document.createElement('div');
      section.className = 'wood-shelf-section';

      let booksHtml = '';
      g.books.forEach(l => {
        const disp = getDisponiveisParaLivro(l);
        const theme = getCategoryTheme(l.categoria);
        const isOut = disp <= 0;
        // Altura e largura variáveis para efeito realista de estante
        const titleHash = (l.titulo || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const spineWidth = 40 + (titleHash % 16); // 40px a 55px
        const spineHeight = 160 + (titleHash % 25); // 160px a 185px

        booksHtml += `
          <div class="spine-book"
               data-action="ver-livro"
               data-id="${escapeHtmlAttr(l.id)}"
               title="${escapeHtmlAttr(l.titulo)} - ${escapeHtmlAttr(l.autor)} (${disp} disponível)"
               style="background: ${theme.bg}; width: ${spineWidth}px; height: ${spineHeight}px; border-color: ${theme.border};">
            <span class="spine-icon">${theme.icon}</span>
            <div class="spine-title">${escapeHtml(l.titulo)}</div>
            <div class="spine-status-dot ${isOut ? 'out' : ''}" title="${isOut ? 'Esgotado' : `${disp} exemplares disponíveis`}"></div>
          </div>
        `;
      });

      section.innerHTML = `
        <div class="wood-shelf-header">
          <div class="wood-shelf-title">${escapeHtml(g.title)}</div>
          <div class="wood-shelf-count">${g.count} livro${g.count === 1 ? '' : 's'}</div>
        </div>
        <div class="wood-shelf-stage">
          <div class="shelf-books-row">
            ${booksHtml}
          </div>
          <div class="wood-plank"></div>
        </div>
      `;
      container.appendChild(section);
    });
  }
}

function abrirModalDetalhesLivro(livroId) {
  const l = (state.livros || []).find(x => String(x.id) === String(livroId));
  if (!l) return;

  const modal = $('#modalDetalhesLivro');
  const conteudo = $('#detalhesLivroConteudo');
  const acoes = $('#detalhesLivroAcoes');
  const header = $('#detalhesHeader');
  if (!modal || !conteudo) return;

  const theme = getCategoryTheme(l.categoria);
  const disp = getDisponiveisParaLivro(l);
  const total = Number(l.acervo || 1);
  const emprestados = total - disp;

  // Empréstimos ativos deste livro
  const empAtivos = (state.emprestimos || []).filter(e => !e.devolvido && String(e.livroId) === String(l.id));

  let borrowersHtml = '';
  if (empAtivos.length > 0) {
    borrowersHtml = `
      <div style="margin-top: 14px; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 12px;">
        <div style="font-size: 12px; font-weight: 900; color: var(--text); margin-bottom: 8px;">🔄 Empréstimos Ativos deste Livro:</div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${empAtivos.map(e => {
            const aluno = (state.alunos || []).find(a => String(a.id) === String(e.alunoId));
            const info = getLoanStatus(e);
            return `
              <div style="display:flex; align-items:center; justify-content:space-between; font-size:12px; padding:4px 0; border-bottom:1px dashed #e2e8f0;">
                <span><strong>${escapeHtml(aluno?.nome || 'Aluno')}</strong> (${escapeHtml(aluno?.turma || '-')})</span>
                <span class="status-pill ${info.badgeClass}" style="font-size:10px;">${info.icon} ${info.shortText || info.text}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  conteudo.innerHTML = `
    <div style="display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap;">
      <div style="width: 110px; height: 160px; border-radius: 12px; background: ${theme.bg}; display:flex; flex-direction:column; justify-content:space-between; padding:12px; color:#fff; box-shadow: 0 10px 20px rgba(0,0,0,0.2); flex-shrink: 0;">
        <span style="font-size: 24px;">${theme.icon}</span>
        <div style="font-size: 13px; font-weight: 1000; line-height: 1.2; text-shadow:0 1px 2px rgba(0,0,0,0.5);">${escapeHtml(l.titulo)}</div>
      </div>
      <div style="flex: 1; min-width: 200px;">
        <h3 style="margin: 0 0 6px; font-size: 18px; font-weight: 1000; color: var(--text);">${escapeHtml(l.titulo)}</h3>
        <p style="margin: 0 0 10px; font-size: 14px; font-weight: 750; color: var(--muted);">✍️ Autor: <strong>${escapeHtml(l.autor)}</strong></p>

        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
          <span class="pill" style="border-color: ${theme.border}; background: #f8fafc;">📁 ${escapeHtml(l.categoria)}</span>
          <span class="pill" style="border-color: var(--border);">📦 Acervo total: <strong>${total}</strong></span>
          <span class="status-pill ${disp > 0 ? 'badge-ok' : 'badge-overdue'}">${disp > 0 ? `🟢 ${disp} disponível${disp === 1 ? '' : 'is'}` : '🔴 Esgotado'}</span>
        </div>

        <div style="font-size: 12px; color: var(--muted); line-height: 1.5;">
          ${emprestados > 0 ? `Atualmente <strong>${emprestados}</strong> exemplar${emprestados === 1 ? '' : 'es'} está em empréstimo.` : 'Todos os exemplares estão disponíveis para retirada imediata.'}
        </div>
      </div>
    </div>
    ${borrowersHtml}
  `;

  if (acoes) {
    acoes.innerHTML = `
      <button type="button" class="secondary" data-close-modal="#modalDetalhesLivro">Fechar</button>
      <button type="button" class="secondary" id="btnModalDetalhesQr" data-id="${escapeHtmlAttr(l.id)}">🏷️ Gerar QR / Etiqueta</button>
      <button type="button" class="secondary" id="btnModalDetalhesEditar" data-id="${escapeHtmlAttr(l.id)}">✏️ Editar</button>
      ${disp > 0 ? `<button type="button" id="btnModalDetalhesEmprestar" data-id="${escapeHtmlAttr(l.id)}">🔄 Realizar Empréstimo</button>` : ''}
    `;

    $('#btnModalDetalhesQr')?.addEventListener('click', () => {
      closeModal('#modalDetalhesLivro');
      abrirModalEtiquetaQr(l.id);
    });

    $('#btnModalDetalhesEditar')?.addEventListener('click', () => {
      closeModal('#modalDetalhesLivro');
      // Ativar seção de livros
      const navLivros = document.querySelector('.nav-item[data-nav="livros"]');
      if (navLivros) navLivros.click();
      iniciarEdicaoLivro(l.id);
    });

    $('#btnModalDetalhesEmprestar')?.addEventListener('click', () => {
      closeModal('#modalDetalhesLivro');
      // Ativar seção de empréstimos
      const navEmp = document.querySelector('.nav-item[data-nav="emprestimos"]');
      if (navEmp) navEmp.click();
      const elLivro = $('#emprestimoLivro');
      if (elLivro) elLivro.value = l.id;
      $('#emprestimoAluno')?.focus();
    });
  }

  openModal('#modalDetalhesLivro');
}

// ==========================================
// 3. QR CODE & LEITOR DE CÓDIGO DE BARRAS (ISBN)
// ==========================================

function iniciarScannerCamera(target = 'livro') {
  currentScannerTarget = target;
  const modal = $('#modalQrScanner');
  const title = $('#qrModalTitle');
  const feedback = $('#scannerFeedback');
  const manualInput = $('#scannerManualInput');

  if (feedback) feedback.style.display = 'none';
  if (manualInput) manualInput.value = '';

  if (title) {
    title.textContent = target === 'emprestimo'
      ? '📷 Escanear QR Code do Livro ou Aluno para Empréstimo'
      : '📷 Leitor de QR Code & Código de Barras (ISBN)';
  }

  openModal('#modalQrScanner');

  if (typeof Html5Qrcode !== 'undefined') {
    try {
      if (html5QrCodeScanner) {
        try { html5QrCodeScanner.stop(); } catch {}
      }

      html5QrCodeScanner = new Html5Qrcode('qrReaderElem');
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      html5QrCodeScanner.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          processarCodigoLido(decodedText, currentScannerTarget);
        },
        () => {} // Ignorar falhas de quadro contínuo
      ).catch(err => {
        console.warn('Erro ao abrir câmera traseira, tentando câmera padrão:', err);
        html5QrCodeScanner.start(
          { facingMode: 'user' },
          config,
          (decodedText) => {
            processarCodigoLido(decodedText, currentScannerTarget);
          },
          () => {}
        ).catch(cameraErr => {
          console.error('Câmera indisponível:', cameraErr);
          if (feedback) {
            feedback.style.display = 'block';
            feedback.style.background = '#fef2f2';
            feedback.style.color = '#991b1b';
            feedback.textContent = 'Acesso à câmera indisponível ou bloqueado. Use o campo de busca manual abaixo.';
          }
        });
      });
    } catch (e) {
      console.error('Erro ao inicializar Html5Qrcode:', e);
    }
  }
}

function pararScannerCamera() {
  if (html5QrCodeScanner) {
    try {
      html5QrCodeScanner.stop().then(() => {
        html5QrCodeScanner.clear();
      }).catch(() => {});
    } catch {}
  }
  closeModal('#modalQrScanner');
}

// Busca dados do livro pelo código ISBN usando APIs públicas
async function buscarLivroPorIsbn(isbn) {
  const cleanIsbn = isbn.replace(/[^0-9X]/gi, '');
  if (!cleanIsbn) return null;

  // 1. Tentar BrasilAPI (ótimo para livros brasileiros)
  try {
    const res = await fetch(`https://brasilapi.com.br/api/isbn/v1/${cleanIsbn}`);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.title || data.name)) {
        return {
          titulo: data.title || data.name || '',
          autor: Array.isArray(data.authors) ? data.authors.join(', ') : (data.authors || 'Autor Desconhecido'),
          categoria: mapearCategoria(data.subjects?.[0] || 'Outro'),
          acervo: 1
        };
      }
    }
  } catch (err) {
    console.warn('Falha na BrasilAPI:', err);
  }

  // 2. Tentar Google Books API
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`);
    if (res.ok) {
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        const info = data.items[0].volumeInfo;
        return {
          titulo: info.title || '',
          autor: Array.isArray(info.authors) ? info.authors.join(', ') : 'Autor Desconhecido',
          categoria: mapearCategoria(info.categories?.[0] || 'Outro'),
          acervo: 1
        };
      }
    }
  } catch (err) {
    console.warn('Falha na Google Books API:', err);
  }

  // 3. Tentar Open Library API
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${cleanIsbn}.json`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.title) {
        return {
          titulo: data.title,
          autor: 'Autor Desconhecido',
          categoria: 'Outro',
          acervo: 1
        };
      }
    }
  } catch (err) {
    console.warn('Falha na Open Library API:', err);
  }

  return null;
}

function mapearCategoria(categoriaBruta) {
  if (!categoriaBruta) return 'Outro';
  const c = normalize(categoriaBruta);
  if (c.includes('fiction') || c.includes('ficção') || c.includes('sci-fi')) return 'Ficção Científica';
  if (c.includes('romance') || c.includes('amor')) return 'Romance';
  if (c.includes('fantas') || c.includes('magic')) return 'Fantasia';
  if (c.includes('advent') || c.includes('aventura')) return 'Aventura';
  if (c.includes('thrill') || c.includes('suspense') || c.includes('mister')) return 'Suspense';
  if (c.includes('biograph') || c.includes('biografia') || c.includes('memoir')) return 'Biografia';
  if (c.includes('histor') || c.includes('história')) return 'História';
  if (c.includes('humor') || c.includes('comédia') || c.includes('comedy')) return 'Comédia';
  if (c.includes('poe') || c.includes('poesia')) return 'Poesia';
  if (c.includes('educa') || c.includes('didático') || c.includes('school')) return 'Didático';
  return 'Outro';
}

async function processarCodigoLido(codigo, target) {
  if (!codigo) return;
  const raw = codigo.trim();
  const feedback = $('#scannerFeedback');

  if (feedback) {
    feedback.style.display = 'block';
    feedback.style.background = '#e0f2fe';
    feedback.style.color = '#0369a1';
    feedback.textContent = `Código detectado: ${raw}. Processando...`;
  }

  // Verificar se é JSON de QR Code da Biblioteca
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.tipo === 'livro' || parsed.titulo) {
        if (target === 'emprestimo') {
          // Selecionar no select de empréstimo
          const match = state.livros.find(l => String(l.id) === String(parsed.id) || normalize(l.titulo) === normalize(parsed.titulo));
          if (match) {
            const elLivro = $('#emprestimoLivro');
            if (elLivro) elLivro.value = match.id;
            pararScannerCamera();
            toast(`Livro "${match.titulo}" selecionado para empréstimo!`, 'success');
            return;
          }
        } else {
          // Preencher formulário de livro
          if ($('#livroTitulo')) $('#livroTitulo').value = parsed.titulo || '';
          if ($('#livroAutor')) $('#livroAutor').value = parsed.autor || '';
          if ($('#livroCategoria')) $('#livroCategoria').value = parsed.categoria || 'Outro';
          pararScannerCamera();
          // Ir para tela de livros
          const navLivros = document.querySelector('.nav-item[data-nav="livros"]');
          if (navLivros) navLivros.click();
          toast(`Dados do livro "${parsed.titulo}" preenchidos via QR Code!`, 'success');
          return;
        }
      }
    }
  } catch {}

  // Verificar se é ISBN (código de barras de 10 a 13 dígitos numéricos)
  const cleanNum = raw.replace(/[^0-9X]/gi, '');
  if (cleanNum.length >= 10 && cleanNum.length <= 13) {
    if (feedback) feedback.textContent = `Buscando dados do livro pelo ISBN ${cleanNum}...`;
    const bookData = await buscarLivroPorIsbn(cleanNum);

    if (bookData) {
      if (target === 'emprestimo') {
        // Verificar se livro já existe no acervo
        const match = state.livros.find(l => normalize(l.titulo) === normalize(bookData.titulo));
        if (match) {
          const elLivro = $('#emprestimoLivro');
          if (elLivro) elLivro.value = match.id;
          pararScannerCamera();
          toast(`Livro "${match.titulo}" selecionado para empréstimo!`, 'success');
          return;
        }
      }

      // Preencher formulário de cadastro de livros
      if ($('#livroTitulo')) $('#livroTitulo').value = bookData.titulo;
      if ($('#livroAutor')) $('#livroAutor').value = bookData.autor;
      if ($('#livroCategoria')) $('#livroCategoria').value = bookData.categoria;
      if ($('#livroAcervo')) $('#livroAcervo').value = '1';

      pararScannerCamera();
      const navLivros = document.querySelector('.nav-item[data-nav="livros"]');
      if (navLivros) navLivros.click();
      toast(`Livro "${bookData.titulo}" localizado pelo código ISBN!`, 'success');
      return;
    } else {
      if (feedback) {
        feedback.style.background = '#fffbeb';
        feedback.style.color = '#92400e';
        feedback.textContent = `ISBN ${cleanNum} detectado, mas não encontrado online. Preencha os campos manualmente.`;
      }
      return;
    }
  }

  // Tentar encontrar por ID ou título nos livros cadastrados
  const matchLivro = state.livros.find(l => String(l.id) === raw || normalize(l.titulo).includes(normalize(raw)));
  if (matchLivro) {
    if (target === 'emprestimo') {
      const elLivro = $('#emprestimoLivro');
      if (elLivro) elLivro.value = matchLivro.id;
      pararScannerCamera();
      toast(`Livro "${matchLivro.titulo}" selecionado!`, 'success');
      return;
    } else {
      pararScannerCamera();
      abrirModalDetalhesLivro(matchLivro.id);
      return;
    }
  }

  // Tentar encontrar aluno por ID ou nome
  const matchAluno = state.alunos.find(a => String(a.id) === raw || normalize(a.nome).includes(normalize(raw)));
  if (matchAluno && target === 'emprestimo') {
    const elAluno = $('#emprestimoAluno');
    if (elAluno) elAluno.value = matchAluno.id;
    pararScannerCamera();
    toast(`Aluno "${matchAluno.nome}" selecionado!`, 'success');
    return;
  }

  if (feedback) {
    feedback.style.background = '#fef2f2';
    feedback.style.color = '#991b1b';
    feedback.textContent = `Código "${raw}" não reconhecido como ISBN ou livro cadastrado.`;
  }
}

function abrirModalEtiquetaQr(livroId) {
  const l = (state.livros || []).find(x => String(x.id) === String(livroId));
  if (!l) return;

  const qrContainer = $('#qrCodeContainer');
  const titleEl = $('#labelBookTitle');
  const authorEl = $('#labelBookAuthor');
  const catEl = $('#labelBookCategory');
  const copiesEl = $('#labelBookCopies');

  if (titleEl) titleEl.textContent = l.titulo;
  if (authorEl) authorEl.textContent = `Autor: ${l.autor}`;
  if (catEl) catEl.textContent = l.categoria;
  if (copiesEl) copiesEl.textContent = `${l.acervo || 1} exemplar${(l.acervo || 1) === 1 ? '' : 'es'}`;

  // Gerar QR Code
  if (qrContainer) {
    qrContainer.innerHTML = '';
    const payload = JSON.stringify({
      tipo: 'livro',
      id: l.id,
      titulo: l.titulo,
      autor: l.autor,
      categoria: l.categoria
    });

    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(qrContainer, {
          text: payload,
          width: 120,
          height: 120,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (err) {
        console.error('Erro ao gerar QRCode:', err);
        qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(payload)}" alt="QR Code" width="120" height="120" />`;
      }
    } else {
      qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(payload)}" alt="QR Code" width="120" height="120" />`;
    }
  }

  openModal('#modalQrEtiqueta');
}

function imprimirEtiqueta() {
  window.print();
}

// ==========================================
// 1. APAGAR TUDO COM CONFIRMAÇÃO E AVISO DE BACKUP
// ==========================================

function openResetConfirmationModal() {
  const countsEl = $('#resetStatusCounts');
  const lCount = state.livros.length;
  const aCount = state.alunos.length;
  const eCount = state.emprestimos.length;
  const rCount = state.relatorios.length;

  if (countsEl) {
    countsEl.innerHTML = `
      📊 <strong>Registros a serem excluídos:</strong>
      ${lCount} livros, ${aCount} alunos, ${eCount} empréstimos e ${rCount} relatórios.
    `;
  }

  openModal('#modalConfirmarReset');
}

function executarResetComBackup() {
  // 1. Baixar arquivo de backup JSON
  downloadJsonFile(getBackup(state), `biblioteca-backup-${new Date().toISOString().split('T')[0]}.json`);

  // 2. Limpar dados
  state.alunos = [];
  state.livros = [];
  state.emprestimos = [];
  state.relatorios = [];

  editingLivroId = null;
  editingAlunoId = null;
  resetLivroFormUI();
  resetAlunoFormUI();

  persistAll();
  addRelatorio(`Todos os dados do sistema foram apagados com backup de segurança salvo ${formatarDataHoraExtenso()}.`);
  closeModal('#modalConfirmarReset');
  toast('Backup baixado e sistema resetado com sucesso!', 'success');
  renderAll();
}

function executarResetSemBackup() {
  if (!confirm('Tem certeza absoluta que deseja apagar TODOS os dados SEM fazer backup? Esta ação NÃO poderá ser desfeita!')) {
    return;
  }

  state.alunos = [];
  state.livros = [];
  state.emprestimos = [];
  state.relatorios = [];

  editingLivroId = null;
  editingAlunoId = null;
  resetLivroFormUI();
  resetAlunoFormUI();

  persistAll();
  addRelatorio(`Todos os dados foram apagados SEM backup ${formatarDataHoraExtenso()}.`);
  closeModal('#modalConfirmarReset');
  toast('Todos os dados foram apagados.', 'warning');
  renderAll();
}

function downloadJsonFile(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function importFromJson(text) {
  if (!text) return false;

  try {
    const data = JSON.parse(text);
    setFromBackup({
      data,
      uidFn: uid,
      setState: ({ alunos, livros, emprestimos, relatorios }) => {
        state.alunos = alunos;
        state.livros = livros;
        state.emprestimos = emprestimos;
        state.relatorios = relatorios;
      }
    });
    return true;
  } catch (err) {
    return false;
  }
}

function gerarRelatorioResumo() {
  renderRelatorioResumo();
}

function exportarRelatorioPDF() {
  const content = `
    <html>
      <head>
        <title>Relatório Biblioteca</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 32px; color: #111827; }
          h1, h2 { color: #166534; }
          table { width:100%; border-collapse: collapse; margin-top:20px; }
          th, td { text-align:left; padding: 10px; border:1px solid #d1d5db; }
          th { background: #ecfdf5; }
          .section { margin-bottom: 24px; }
        </style>
      </head>
      <body>
        <h1>Relatório da Biblioteca</h1>
        <div class="section">
          <h2>Resumo rápido</h2>
          ${$('#relatorioResumo')?.innerHTML || ''}
        </div>
        <div class="section">
          <h2>Histórico de atividades</h2>
          <table>
            <thead><tr><th>Atividade</th></tr></thead>
            <tbody>
              ${(state.relatorios || []).slice().sort((a,b) => new Date(b.criadoEm) - new Date(a.criadoEm)).map(r => `<tr><td>${escapeHtml(r.mensagem)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;

  const win = window.open('', '_blank');
  if (!win) {
    toast('Não foi possível abrir janela de impressão. Verifique seu bloqueador de pop-ups.', 'warning');
    return;
  }
  win.document.write(content);
  win.document.close();
  win.focus();
  win.print();
}

function apagarRelatorios() {
  if (!confirm('Tem certeza que deseja apagar todo o histórico de relatórios?')) return;
  state.relatorios = [];
  persistAll();
  renderAll();
  toast('Relatórios apagados.', 'success');
}

function persistAll() {
  save(LS_KEYS.alunos, state.alunos);
  save(LS_KEYS.livros, state.livros);
  save(LS_KEYS.emprestimos, state.emprestimos);
  save(LS_KEYS.relatorios, state.relatorios);
  save(LS_KEYS.prateleira, shelfState);
}

function isCurrentMonth(dateStr) {
  if (!dateStr) return false;
  const d = parseDateToLocal(dateStr);
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function getAlunoMaisAtivoMesAtual() {
  const concluido = (state.emprestimos || []).filter(e => e.devolvido && isCurrentMonth(e.dataDevolucao));
  if (!concluido.length) return null;

  const contagem = {};
  concluido.forEach(e => {
    if (!e.alunoId) return;
    contagem[e.alunoId] = (contagem[e.alunoId] || 0) + 1;
  });

  const alunoId = Object.keys(contagem).reduce((best, id) => {
    if (best === null) return id;
    return contagem[id] > contagem[best] ? id : best;
  }, null);

  if (!alunoId) return null;

  const aluno = state.alunos.find(a => String(a.id) === String(alunoId));
  return aluno ? { ...aluno, quantidade: contagem[alunoId] } : null;
}

function getLivroMaisLidoMesAtual() {
  const realizados = (state.emprestimos || []).filter(e => isCurrentMonth(e.dataRetirada));
  if (!realizados.length) return null;

  const contagem = {};
  realizados.forEach(e => {
    if (!e.livroId) return;
    contagem[e.livroId] = (contagem[e.livroId] || 0) + 1;
  });

  const livroId = Object.keys(contagem).reduce((best, id) => {
    if (best === null) return id;
    return contagem[id] > contagem[best] ? id : best;
  }, null);

  if (!livroId) return null;

  const livro = state.livros.find(l => String(l.id) === String(livroId));
  return livro ? { ...livro, quantidade: contagem[livroId] } : null;
}

function renderRanking() {
  const alunoCard = $('#rankingAlunoCard');
  const livroCard = $('#rankingLivroCard');
  if (!alunoCard || !livroCard) return;

  const aluno = getAlunoMaisAtivoMesAtual();
  const livro = getLivroMaisLidoMesAtual();

  alunoCard.innerHTML = aluno ? `
    <div class="card-header">
      <div>
        <h2>🏆 Aluno Mais Ativo do Mês</h2>
        <small class="muted">Concluiu empréstimos neste mês</small>
      </div>
    </div>
    <div class="card-body">
      <p style="font-weight:900; font-size:18px; margin:0 0 12px;">${escapeHtml(aluno.nome)}</p>
      <p style="margin:0 0 8px; color:var(--muted);">Turma: ${escapeHtml(aluno.turma)}</p>
      <p style="margin:0; font-weight:900;">📚 Livros lidos: ${Number(aluno.quantidade)}</p>
    </div>
  ` : `
    <div class="card-header">
      <div>
        <h2>🏆 Aluno Mais Ativo do Mês</h2>
        <small class="muted">Concluiu empréstimos neste mês</small>
      </div>
    </div>
    <div class="card-body">
      <div class="empty">Nenhum dado disponível neste mês.</div>
    </div>
  `;

  livroCard.innerHTML = livro ? `
    <div class="card-header">
      <div>
        <h2>📚 Livro Mais Lido do Mês</h2>
        <small class="muted">Empréstimos realizados neste mês</small>
      </div>
    </div>
    <div class="card-body">
      <p style="font-weight:900; font-size:18px; margin:0 0 12px;">${escapeHtml(livro.titulo)}</p>
      <p style="margin:0 0 8px; color:var(--muted);">Autor: ${escapeHtml(livro.autor)}</p>
      <p style="margin:0; font-weight:900;">🔄 Empréstimos: ${Number(livro.quantidade)}</p>
    </div>
  ` : `
    <div class="card-header">
      <div>
        <h2>📚 Livro Mais Lido do Mês</h2>
        <small class="muted">Empréstimos realizados neste mês</small>
      </div>
    </div>
    <div class="card-body">
      <div class="empty">Nenhum dado disponível neste mês.</div>
    </div>
  `;
}

function registrarDevolucao(emprestimoId) {
  const e = (state.emprestimos || []).find(x => String(x.id) === String(emprestimoId));
  if (!e || e.devolvido) return;
  e.devolvido = true;
  e.dataDevolucao = getTodayDateStr();

  const aluno = (state.alunos || []).find(a => String(a.id) === String(e.alunoId));
  const livro = (state.livros || []).find(l => String(l.id) === String(e.livroId));
  addRelatorio(`${aluno?.nome || 'Aluno'} devolveu o livro '${livro?.titulo || ''}' ${formatarDataHoraExtenso()}.`);

  persistAll();
  renderAll();
  toast(`Devolução do livro "${livro?.titulo || 'Livro'}" registrada!`, 'success');
}

function popularLivrosExemplo() {
  const exemplos = [
    { titulo: 'Dom Casmurro', autor: 'Machado de Assis', categoria: 'Romance', acervo: 3 },
    { titulo: 'O Pequeno Príncipe', autor: 'Antoine de Saint-Exupéry', categoria: 'Fantasia', acervo: 4 },
    { titulo: '1984', autor: 'George Orwell', categoria: 'Ficção Científica', acervo: 3 },
    { titulo: 'Harry Potter e a Pedra Filosofal', autor: 'J.K. Rowling', categoria: 'Fantasia', acervo: 5 },
    { titulo: 'O Senhor dos Anéis', autor: 'J.R.R. Tolkien', categoria: 'Fantasia', acervo: 2 },
    { titulo: 'A Hora da Estrela', autor: 'Clarice Lispector', categoria: 'Romance', acervo: 3 },
    { titulo: 'Memórias Póstumas de Brás Cubas', autor: 'Machado de Assis', categoria: 'Romance', acervo: 4 },
    { titulo: 'Duna', autor: 'Frank Herbert', categoria: 'Ficção Científica', acervo: 2 },
    { titulo: 'O Alquimista', autor: 'Paulo Coelho', categoria: 'Aventura', acervo: 4 },
    { titulo: 'Sherlock Holmes: Um Estudo em Vermelho', autor: 'Arthur Conan Doyle', categoria: 'Suspense', acervo: 3 },
    { titulo: 'O Menino Maluquinho', autor: 'Ziraldo', categoria: 'Comédia', acervo: 5 },
    { titulo: 'Sapiens: Uma Breve História da Humanidade', autor: 'Yuval Noah Harari', categoria: 'História', acervo: 3 },
    { titulo: 'O Diário de Anne Frank', autor: 'Anne Frank', categoria: 'Biografia', acervo: 3 },
    { titulo: 'Capitães da Areia', autor: 'Jorge Amado', categoria: 'Romance', acervo: 4 },
    { titulo: 'Vidas Secas', autor: 'Graciliano Ramos', categoria: 'Romance', acervo: 3 },
    { titulo: 'Neuromancer', autor: 'William Gibson', categoria: 'Ficção Científica', acervo: 2 },
    { titulo: 'Assassinato no Expresso do Oriente', autor: 'Agatha Christie', categoria: 'Suspense', acervo: 3 },
    { titulo: 'Percy Jackson e o Ladrão de Raios', autor: 'Rick Riordan', categoria: 'Aventura', acervo: 4 },
    { titulo: 'O Cortiço', autor: 'Aluísio Azevedo', categoria: 'Romance', acervo: 3 },
    { titulo: 'Fundação', autor: 'Isaac Asimov', categoria: 'Ficção Científica', acervo: 3 }
  ];

  let added = 0;
  exemplos.forEach(ex => {
    const exists = state.livros.some(l => normalize(l.titulo) === normalize(ex.titulo));
    if (!exists) {
      state.livros.push({
        id: uid(),
        titulo: ex.titulo,
        autor: ex.autor,
        categoria: ex.categoria,
        acervo: ex.acervo,
        criadoEm: new Date().toISOString()
      });
      added++;
    }
  });

  if (added > 0) {
    addRelatorio(`Foram adicionados ${added} livros de exemplo ao acervo ${formatarDataHoraExtenso()}.`);
    persistAll();
    renderAll();
    toast(`${added} livros de exemplo adicionados com sucesso!`, 'success');
  } else {
    toast('Os livros de exemplo já estão cadastrados.', 'info');
  }
}

function renderAll() {
  ensureSelectOptions();
  renderStats();
  renderLivrosDisponiveisSmall();
  renderLivrosTable();
  renderAlunosTable();
  renderEmprestimosTable();
  renderNotificationsAndAlerts();
  renderPrateleiraVirtual();
  renderRelatorios();
  renderRelatorioResumo();
  renderRanking();
}

// ==========================================
// WIRE EVENTS
// ==========================================

function wireEvents() {
  // 1. FORMULÁRIO DE LIVROS
  $('#livroForm')?.addEventListener('submit', (e) => {
    e.preventDefault();

    const titulo = $('#livroTitulo')?.value || '';
    const autor = $('#livroAutor')?.value || '';
    const categoria = $('#livroCategoria')?.value || '';
    const acervo = $('#livroAcervo')?.value || 1;

    if (!titulo.trim() || !autor.trim() || !categoria.trim()) {
      toast('Preencha título, autor e categoria.', 'warning');
      return;
    }

    if (editingLivroId) {
      const l = state.livros.find(x => String(x.id) === String(editingLivroId));
      if (l) {
        l.titulo = titulo.trim();
        l.autor = autor.trim();
        l.categoria = categoria.trim();
        l.acervo = Number(acervo || 1);
        addRelatorio(`Livro '${l.titulo}' foi editado ${formatarDataHoraExtenso()}.`);
      }
      editingLivroId = null;
      resetLivroFormUI();
      persistAll();
      toast('Livro atualizado com sucesso!', 'success');
      $('#livroForm')?.reset?.();
      renderAll();
      return;
    }

    state.livros.push({
      id: uid(),
      titulo: titulo.trim(),
      autor: autor.trim(),
      categoria: categoria.trim(),
      acervo: Number(acervo || 1),
      criadoEm: new Date().toISOString()
    });

    addRelatorio(`Livro '${titulo.trim()}' cadastrado ${formatarDataHoraExtenso()}.`);
    persistAll();
    toast('Livro cadastrado com sucesso!', 'success');
    $('#livroForm')?.reset?.();
    renderAll();
  });

  // 2. FORMULÁRIO DE ALUNOS
  $('#alunoForm')?.addEventListener('submit', (e) => {
    e.preventDefault();

    const nome = $('#alunoNome')?.value || '';
    const turma = $('#alunoTurma')?.value || '';

    if (!nome.trim() || !turma.trim()) {
      toast('Preencha nome e turma.', 'warning');
      return;
    }

    if (editingAlunoId) {
      const a = state.alunos.find(x => String(x.id) === String(editingAlunoId));
      if (a) {
        a.nome = nome.trim();
        a.turma = turma.trim();
        addRelatorio(`Aluno ${a.nome} foi editado ${formatarDataHoraExtenso()}.`);
      }
      editingAlunoId = null;
      resetAlunoFormUI();
      persistAll();
      toast('Aluno atualizado com sucesso!', 'success');
      $('#alunoForm')?.reset?.();
      renderAll();
      return;
    }

    state.alunos.push({
      id: uid(),
      nome: nome.trim(),
      turma: turma.trim(),
      criadoEm: new Date().toISOString()
    });

    addRelatorio(`Aluno ${nome.trim()} cadastrado ${formatarDataHoraExtenso()}.`);
    persistAll();
    toast('Aluno cadastrado com sucesso!', 'success');
    $('#alunoForm')?.reset?.();
    renderAll();
  });

  // 3. REGISTRO DE EMPRÉSTIMO COM PRAZO
  $('#emprestarBtn')?.addEventListener('click', () => {
    const alunoId = $('#emprestimoAluno')?.value;
    const livroId = $('#emprestimoLivro')?.value;
    const dataRetirada = $('#emprestimoData')?.value || getTodayDateStr();
    const prazoDias = Number($('#emprestimoPrazo')?.value || 7);

    if (!alunoId || !livroId || !dataRetirada) {
      toast('Selecione aluno, livro e data de retirada.', 'warning');
      return;
    }

    // Verificar disponibilidade
    const livroRef = state.livros.find(l => String(l.id) === String(livroId));
    if (!livroRef) {
      toast('Livro não encontrado.', 'warning');
      return;
    }

    const disponiveis = getDisponiveisParaLivro(livroRef);
    if (disponiveis <= 0) {
      toast(`Não há exemplares disponíveis de "${livroRef.titulo}" para empréstimo.`, 'warning');
      return;
    }

    const dataLimite = addDaysToDate(dataRetirada, prazoDias);

    state.emprestimos.push({
      id: uid(),
      alunoId: String(alunoId),
      livroId: String(livroId),
      dataRetirada: String(dataRetirada),
      dataLimite: String(dataLimite),
      devolvido: false,
      dataDevolucao: '',
    });

    const alunoRef = state.alunos.find(a => String(a.id) === String(alunoId));
    addRelatorio(`${alunoRef?.nome || 'Aluno'} realizou empréstimo do livro '${livroRef.titulo}' (Prazo: ${formatDateLocal(dataLimite)}) ${formatarDataHoraExtenso()}.`);

    persistAll();
    toast(`Empréstimo registrado com prazo até ${formatDateLocal(dataLimite)}!`, 'success');
    renderAll();
  });

  // 4. SCANNER DE QR CODE / CÓDIGO DE BARRAS
  $('#btnAbrirScannerLivro')?.addEventListener('click', () => {
    iniciarScannerCamera('livro');
  });

  $('#btnAbrirScannerEmprestimo')?.addEventListener('click', () => {
    iniciarScannerCamera('emprestimo');
  });

  $('#btnFecharScanner')?.addEventListener('click', pararScannerCamera);
  $('#btnCancelarScanner')?.addEventListener('click', pararScannerCamera);

  $('#scannerManualBuscarBtn')?.addEventListener('click', () => {
    const val = $('#scannerManualInput')?.value || '';
    if (!val.trim()) {
      toast('Digite um ISBN ou código.', 'warning');
      return;
    }
    processarCodigoLido(val, currentScannerTarget);
  });

  $('#scannerManualInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = $('#scannerManualInput')?.value || '';
      if (val.trim()) processarCodigoLido(val, currentScannerTarget);
    }
  });

  // 5. NOTIFICAÇÕES (SINO, BANNER E TABS)
  $('#notifBellBtn')?.addEventListener('click', () => {
    openModal('#modalNotificacoes');
    renderNotificationsModalList();
  });

  $('#btnVerNotificacoesBanner')?.addEventListener('click', () => {
    activeNotifFilter = 'vencidos';
    $$('.notif-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-filter') === 'vencidos'));
    openModal('#modalNotificacoes');
    renderNotificationsModalList();
  });

  $$('.notif-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.notif-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeNotifFilter = tab.getAttribute('data-filter') || 'todos';
      renderNotificationsModalList();
    });
  });

  // 6. FILTROS DA TABELA DE EMPRÉSTIMOS
  $$('.emp-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.emp-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeEmpFilter = btn.getAttribute('data-emp-filter') || 'todos';
      renderEmprestimosTable();
    });
  });

  // 7. CONTROLES DA PRATELEIRA VIRTUAL
  $('#shelfGroupBy')?.addEventListener('change', (e) => {
    shelfState.groupBy = e.target.value;
    persistAll();
    renderPrateleiraVirtual();
  });

  $('#shelfSortBy')?.addEventListener('change', (e) => {
    shelfState.sortBy = e.target.value;
    persistAll();
    renderPrateleiraVirtual();
  });

  $('#shelfFilterCategory')?.addEventListener('change', (e) => {
    shelfState.filterCategory = e.target.value;
    renderPrateleiraVirtual();
  });

  $('#shelfFilterStatus')?.addEventListener('change', (e) => {
    shelfState.filterStatus = e.target.value;
    renderPrateleiraVirtual();
  });

  $('#shelfSearchInput')?.addEventListener('input', (e) => {
    shelfState.search = e.target.value;
    renderPrateleiraVirtual();
  });

  $('#btnViewSpines')?.addEventListener('click', () => {
    $('#btnViewSpines')?.classList.add('active');
    $('#btnViewGrid')?.classList.remove('active');
    shelfState.viewMode = 'spines';
    persistAll();
    renderPrateleiraVirtual();
  });

  $('#btnViewGrid')?.addEventListener('click', () => {
    $('#btnViewGrid')?.classList.add('active');
    $('#btnViewSpines')?.classList.remove('active');
    shelfState.viewMode = 'grid';
    persistAll();
    renderPrateleiraVirtual();
  });

  // 8. CLIQUE EM LIVROS NA PRATELEIRA
  $('#shelfContainer')?.addEventListener('click', (ev) => {
    const bookEl = ev.target?.closest?.('[data-action="ver-livro"]');
    if (bookEl) {
      const id = bookEl.getAttribute('data-id');
      if (id) abrirModalDetalhesLivro(id);
    }
  });

  // 9. IMPRESSÃO DE ETIQUETA QR
  $('#btnImprimirEtiqueta')?.addEventListener('click', imprimirEtiqueta);

  // 10. BOTÃO RESET COM CONFIRMAÇÃO DETALHADA E AVISO DE BACKUP
  $('#resetBtn')?.addEventListener('click', openResetConfirmationModal);
  $('#btnResetComBackup')?.addEventListener('click', executarResetComBackup);
  $('#btnResetSemBackup')?.addEventListener('click', executarResetSemBackup);

  // 11. FECHAMENTO GENÉRICO DE MODAIS
  $$('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-close-modal');
      if (target) closeModal(target);
    });
  });

  // Fechar modal ao clicar no fundo
  $$('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        if (backdrop.id === 'modalQrScanner') pararScannerCamera();
        closeModal(backdrop);
      }
    });
  });

  // 12. TABELAS DE LIVROS E ALUNOS (AÇÕES)
  $('#livrosBody')?.addEventListener('click', (ev) => {
    const qrBtn = ev.target?.closest?.('button[data-action="qr"]');
    if (qrBtn) {
      abrirModalEtiquetaQr(qrBtn.getAttribute('data-id'));
      return;
    }
    const editBtn = ev.target?.closest?.('button[data-action="editar"]');
    if (editBtn) {
      iniciarEdicaoLivro(editBtn.getAttribute('data-id'));
      return;
    }
    const delBtn = ev.target?.closest?.('button[data-action="apagar"]');
    if (delBtn) {
      apagarLivro(delBtn.getAttribute('data-id'));
      return;
    }
  });

  $('#alunosBody')?.addEventListener('click', (ev) => {
    const editBtn = ev.target?.closest?.('button[data-action="editar"]');
    if (editBtn) {
      iniciarEdicaoAluno(editBtn.getAttribute('data-id'));
      return;
    }
    const delBtn = ev.target?.closest?.('button[data-action="apagar"]');
    if (delBtn) {
      apagarAluno(delBtn.getAttribute('data-id'));
      return;
    }
  });

  // 13. TABELA DE EMPRÉSTIMOS (AÇÕES)
  $('#emprestimosBody')?.addEventListener('click', (ev) => {
    const devBtn = ev.target?.closest?.('button[data-action="dev"]');
    if (devBtn) {
      registrarDevolucao(devBtn.getAttribute('data-id'));
      return;
    }
    const copyBtn = ev.target?.closest?.('button[data-action="notif-copy"]');
    if (copyBtn) {
      copiarAvisoWhatsApp(copyBtn.getAttribute('data-id'));
      return;
    }
  });

  // Ações dentro do modal de notificações
  $('#notifListContainer')?.addEventListener('click', (ev) => {
    const devBtn = ev.target?.closest?.('button[data-action="notif-dev"]');
    if (devBtn) {
      registrarDevolucao(devBtn.getAttribute('data-id'));
      return;
    }
    const copyBtn = ev.target?.closest?.('button[data-action="notif-copy"]');
    if (copyBtn) {
      copiarAvisoWhatsApp(copyBtn.getAttribute('data-id'));
      return;
    }
  });

  // 14. DEMAIS CONTROLES (BUSCAS, BACKUP, RELATÓRIOS)
  $('#logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem(LS_AUTH_KEY);
    location.href = './login.html';
  });

  $('#livroBusca')?.addEventListener('input', renderLivrosTable);
  $('#alunoBusca')?.addEventListener('input', renderAlunosTable);
  $('#emprestimoBusca')?.addEventListener('input', renderEmprestimosTable);

  $('#livroLimparBusca')?.addEventListener('click', () => { const el = $('#livroBusca'); if (el) el.value = ''; renderLivrosTable(); });
  $('#alunoLimparBusca')?.addEventListener('click', () => { const el = $('#alunoBusca'); if (el) el.value = ''; renderAlunosTable(); });
  $('#emprestimoLimparBusca')?.addEventListener('click', () => { const el = $('#emprestimoBusca'); if (el) el.value = ''; renderEmprestimosTable(); });

  $('#livrosPopularBtn')?.addEventListener('click', popularLivrosExemplo);

  $('#livroExportar')?.addEventListener('click', () => {
    downloadJsonFile({ livros: state.livros }, 'livros-export.json');
  });

  $('#alunoExportar')?.addEventListener('click', () => {
    downloadJsonFile({ alunos: state.alunos }, 'alunos-export.json');
  });

  $('#downloadBackupBtn')?.addEventListener('click', () => {
    downloadJsonFile(getBackup(state), `biblioteca-backup-${new Date().toISOString().split('T')[0]}.json`);
  });

  $('#importarBtn')?.addEventListener('click', () => {
    const texto = $('#importarDados')?.value || '';
    if (!texto.trim()) {
      toast('Cole um JSON válido para importar.', 'warning');
      return;
    }
    if (!importFromJson(texto)) {
      toast('JSON inválido. Verifique o conteúdo.', 'warning');
      return;
    }
    persistAll();
    renderAll();
    toast('Dados importados com sucesso!', 'success');
  });

  $('#gerarRelatorioBtn')?.addEventListener('click', () => {
    gerarRelatorioResumo();
    toast('Relatório gerado.', 'info');
  });

  $('#exportarPdfBtn')?.addEventListener('click', exportarRelatorioPDF);
  $('#limparRelatoriosBtn')?.addEventListener('click', apagarRelatorios);
}

// ==========================================
// BOOT
// ==========================================

function boot() {
  state.alunos = load(LS_KEYS.alunos, []);
  state.livros = load(LS_KEYS.livros, []);
  state.emprestimos = load(LS_KEYS.emprestimos, []);
  state.relatorios = load(LS_KEYS.relatorios, []);

  state.alunos = Array.isArray(state.alunos) ? state.alunos : [];
  state.livros = Array.isArray(state.livros) ? state.livros : [];
  state.emprestimos = Array.isArray(state.emprestimos) ? state.emprestimos : [];
  state.relatorios = Array.isArray(state.relatorios) ? state.relatorios : [];

  const savedShelf = load(LS_KEYS.prateleira, null);
  if (savedShelf && typeof savedShelf === 'object') {
    shelfState = { ...shelfState, ...savedShelf };
    if ($('#shelfGroupBy')) $('#shelfGroupBy').value = shelfState.groupBy || 'categoria';
    if ($('#shelfSortBy')) $('#shelfSortBy').value = shelfState.sortBy || 'titulo-asc';
    if (shelfState.viewMode === 'grid') {
      $('#btnViewGrid')?.classList.add('active');
      $('#btnViewSpines')?.classList.remove('active');
    }
  }

  // Preencher data padrão de retirada (hoje)
  const dataInput = $('#emprestimoData');
  if (dataInput && !dataInput.value) {
    dataInput.value = getTodayDateStr();
  }

  wireEvents();
  renderAll();
}

boot();



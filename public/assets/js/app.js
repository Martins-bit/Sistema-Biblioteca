// ============================================================
// app.js - Lógica completa do Sistema da Biblioteca
// Frontend consumindo a API real (backend Express + SQLite).
// ============================================================

import { criarCombobox, syncComboboxes } from './combobox.js?v=3';

// ---------------- Helpers básicos ----------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(str) {
  const AMP = '&' + 'amp;';
  const LT = '&' + 'lt;';
  const GT = '&' + 'gt;';
  const QUOT = '&' + 'quot;';
  return String(str ?? '')
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT)
    .replace(/'/g, '&#039;');
}

function hojeISO() {
  return new Date().toISOString().split('T')[0];
}

function formatarData(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('pt-BR');
}

function toast(msg, tipo = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.borderColor = tipo === 'erro' ? '#ef4444' : tipo === 'aviso' ? '#f59e0b' : 'rgba(229,231,235,0.5)';
  clearTimeout(el.__timer);
  el.__timer = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

function abrirModal(sel) {
  const m = $(sel);
  if (m) m.classList.add('show');
}

function fecharModal(sel) {
  const m = $(sel);
  if (m) m.classList.remove('show');
}

// Fecha modais pelos botões [data-close-modal]
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close-modal]');
  if (btn) {
    const sel = btn.getAttribute('data-close-modal');
    fecharModal(sel);
  }
});

// ---------------- API ----------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* resposta sem JSON */ }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : `Erro ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ---------------- Estado global ----------------

const state = {
  turmas: [],
  alunos: [],
  livros: [],
  categorias: [], // mantido vazio: categoria é texto livre no livro
  emprestimos: [],
  dashboard: null,
  filtroEmprestimos: 'todos',
  buscaAluno: '',
  buscaLivro: '',
  buscaEmprestimo: '',
  ordemLivros: 'alfabetica-asc',
  shelf: { groupBy: 'categoria', sortBy: 'titulo-asc', categoria: '', genero: '', classificacao: 'todos', localizacao: 'todos', status: '', busca: '' },
  shelfView: 'spines', // 'spines' = estante de madeira | 'grid' = catálogo de cards
  rankingTab: 'alunos',
  relatorioAtual: null, // dados do último relatório gerado (para CSV/impressão)
  devolucaoEmprestimoId: null,
  editandoAlunoId: null,
  editandoLivroId: null,
  localizarLivroId: null,
  scannerContexto: null, // 'livro' | 'emprestimo'
  dedPreview: []
};

// ---------------- Constantes de conservação ----------------

const NIVEL_CONSERVACAO = { 'Novo': 5, 'Ótimo': 4, 'Bom': 3, 'Regular': 2, 'Danificado': 1 };
const ESTADOS_CONSERVACAO = Object.keys(NIVEL_CONSERVACAO);

function estadoPiorou(saida, devolucao) {
  const s = NIVEL_CONSERVACAO[saida];
  const d = NIVEL_CONSERVACAO[devolucao];
  if (!s || !d) return false;
  return d < s;
}

// ---------------- Estrelas ----------------

// ---------------- Estrelas e situação ----------------

function situacaoAlunoLabel(a) {
  if (a.bloqueado) return { texto: 'Bloqueado temporariamente', classe: 'situacao-bloqueado' };
  const n = Number(a.nota) || 0;
  if (n >= 4.5) return { texto: 'Excelente', classe: 'situacao-excelente' };
  if (n >= 3.5) return { texto: 'Boa', classe: 'situacao-boa' };
  return { texto: 'Regular', classe: 'situacao-regular' };
}

function situacaoBadgeHTML(a) {
  const s = situacaoAlunoLabel(a);
  let extra = '';
  if (a.bloqueado && a.bloqueioFim) {
    const dias = a.diasRestantes;
    extra = dias != null && dias > 0
      ? `<div class="situacao-detalhe">Faltam ${dias} dia(s) para poder realizar um novo empréstimo.</div>`
      : `<div class="situacao-detalhe">Disponível em ${formatarData(a.bloqueioFim)}.</div>`;
  }
  return `<span class="situacao-badge ${s.classe}">${s.texto}</span>${extra}`;
}

function renderEstrelas(nota, estrelas) {
  const n = Number(nota) || 0;
  const classe = n >= 4.5 ? 'good' : n >= 3 ? 'mid' : 'bad';
  const notaFmt = n.toFixed(1).replace('.', ',');
  return `<span class="stars small">${escapeHtml(estrelas || '☆☆☆☆☆')}</span><span class="stars-note ${classe}">${notaFmt}</span>`;
}

// ---------------- Capas ----------------

const CORES_CAPA = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6'];

function corCapa(titulo) {
  let h = 0;
  const s = String(titulo || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CORES_CAPA[h % CORES_CAPA.length];
}

function capaPlaceholderHTML(titulo, classe = 'cover-placeholder') {
  return `<div class="${classe}" style="background: linear-gradient(135deg, ${corCapa(titulo)}, ${corCapa(titulo)}cc);">📖</div>`;
}

function capaThumbHTML(livro) {
  if (livro.capaUrl) {
    return `<img class="cover-thumb" src="${escapeHtml(livro.capaUrl)}" alt="Capa de ${escapeHtml(livro.titulo)}"
      onerror="this.outerHTML='${capaPlaceholderHTML(livro.titulo).replace(/'/g, '&#39;')}'" />`;
  }
  return capaPlaceholderHTML(livro.titulo);
}

// ---------------- Status de empréstimo ----------------

function statusEmprestimo(e) {
  const hoje = hojeISO();
  if (e.devolvido) {
    const atrasada = e.dataLimite && e.dataDevolucao && e.dataDevolucao > e.dataLimite;
    return { chave: 'devolvido', label: atrasada ? 'Devolvido (atrasado)' : 'Devolvido', pill: 'badge-returned' };
  }
  if (e.dataLimite && e.dataLimite < hoje) {
    return { chave: 'vencido', label: 'Vencido', pill: 'badge-overdue' };
  }
  if (e.dataLimite) {
    const limite = new Date(e.dataLimite + 'T00:00:00');
    const tresDias = new Date(); tresDias.setDate(tresDias.getDate() + 3);
    if (limite <= tresDias) return { chave: 'vencendo', label: 'Vence em breve', pill: 'badge-warning' };
    return { chave: 'no_prazo', label: 'No prazo', pill: 'badge-ok' };
  }
  return { chave: 'no_prazo', label: 'Ativo', pill: 'badge-ok' };
}

function pillStatus(e) {
  const st = statusEmprestimo(e);
  return `<span class="status-pill ${st.pill}">${st.label}</span>`;
}

// ---------------- Exportação CSV ----------------

function baixarCSV(nomeArquivo, linhas) {
  if (!linhas || !linhas.length) { toast('Nada para exportar.', 'aviso'); return; }
  const csv = linhas.map(l => l.map(c => {
    const s = String(c ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Arquivo "${nomeArquivo}" exportado!`);
}

function baixarJSON(nomeArquivo, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// CARREGAMENTO DE DADOS
// ============================================================

async function carregarTurmas() {
  try {
    const data = await api('/api/turmas');
    state.turmas = data.turmas || [];
    popularSelectTurmas($('#alunoTurma'));
    popularSelectTurmas($('#editarAlunoTurma'));
    popularSelectTurmas($('#dedTurmaPadrao'));
  } catch (e) {
    console.error('Erro ao carregar turmas:', e);
  }
}

function popularSelectTurmas(select) {
  if (!select) return;
  const valorAtual = select.value;
  select.innerHTML = '<option value="">Selecione...</option>' +
    state.turmas.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (valorAtual && state.turmas.includes(valorAtual)) select.value = valorAtual;
}

// Popula os dropdowns de Aluno e Livro do formulário de empréstimo
function popularSelectsEmprestimo() {
  const selAluno = $('#emprestimoAluno');
  if (selAluno) {
    const atual = selAluno.value;
    selAluno.innerHTML = '<option value="">Selecione...</option>' +
      state.alunos.map(a =>
        `<option value="${a.id}">${escapeHtml(a.nome)} — ${escapeHtml(a.turma)}${a.bloqueado ? ' (BLOQUEADO)' : ''}</option>`
      ).join('');
    if (atual && state.alunos.some(a => String(a.id) === String(atual))) selAluno.value = atual;
    if (selAluno.__combobox) selAluno.__combobox.sync();
  }

  const selLivro = $('#emprestimoLivro');
  if (selLivro) {
    const atual = selLivro.value;
    selLivro.innerHTML = '<option value="">Selecione...</option>' +
      state.livros.map(l => {
        const disp = disponiveisLivro(l.id);
        const sufixo = disp > 0 ? `(${disp} disponível(is))` : '(sem exemplares disponíveis)';
        return `<option value="${l.id}" ${disp === 0 ? 'disabled' : ''}>${escapeHtml(l.titulo)} ${sufixo}</option>`;
      }).join('');
    if (atual && state.livros.some(l => String(l.id) === String(atual))) selLivro.value = atual;
    if (selLivro.__combobox) selLivro.__combobox.sync();
  }

  atualizarSituacaoEmprestimo();
}

// Exibe a situação do aluno selecionado no formulário de empréstimo
// e habilita/desabilita o botão de confirmar.
function atualizarSituacaoEmprestimo() {
  const selAluno = $('#emprestimoAluno');
  const box = $('#emprestimoSituacaoAluno');
  const btn = $('#emprestarBtn');
  if (!selAluno || !box || !btn) return;

  const aluno = state.alunos.find(a => String(a.id) === String(selAluno.value));
  if (!aluno) {
    box.style.display = 'none';
    box.innerHTML = '';
    btn.disabled = false;
    return;
  }

  const s = situacaoAlunoLabel(aluno);
  const notaFmt = (Number(aluno.nota) || 0).toFixed(1).replace('.', ',');
  let detalhe = `Situação: <b>${escapeHtml(s.texto)}</b>`;
  if (aluno.bloqueado && aluno.bloqueioFim) {
    const dias = aluno.diasRestantes;
    detalhe = aluno.diasRestantes != null && dias > 0
      ? `Situação: <b>Bloqueado até ${formatarData(aluno.bloqueioFim)}</b> — faltam ${dias} dia(s) para poder realizar um novo empréstimo.`
      : `Situação: <b>Bloqueado até ${formatarData(aluno.bloqueioFim)}</b>.`;
  }

  box.style.display = 'block';
  box.innerHTML = `
    <b>${escapeHtml(aluno.nome)} — ${escapeHtml(aluno.turma)}</b><br/>
    Avaliação: <span class="stars small">${escapeHtml(aluno.estrelas || '☆☆☆☆☆')}</span> ${notaFmt}<br/>
    ${detalhe}
  `;
  box.className = 'emprestimo-situacao ' + (aluno.bloqueado ? 'bloqueado' : 'liberado');

  // Bloqueio também no frontend (a regra real está no backend)
  btn.disabled = !!aluno.bloqueado;
  btn.title = aluno.bloqueado ? 'Aluno temporariamente bloqueado por avaliação abaixo de 3,0' : '';
}

async function carregarAlunos() {
  state.alunos = await api('/api/alunos');
}

async function carregarLivros() {
  state.livros = await api('/api/livros');
}

// Categorias são TEXTO LIVRE no livro. O filtro da Estante gera as opções
// automaticamente a partir das categorias existentes nos próprios livros.
function categoriasExistentes() {
  return [...new Set(state.livros.map(l => String(l.categoria || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function carregarEmprestimos() {
  state.emprestimos = await api('/api/emprestimos');
}

async function carregarDashboard() {
  try {
    state.dashboard = await api('/api/dashboard');
  } catch (e) {
    console.error('Erro ao carregar dashboard:', e);
  }
}

function disponiveisLivro(livroId) {
  const livro = state.livros.find(l => l.id === livroId);
  if (!livro) return 0;
  const ativos = state.emprestimos.filter(e => e.livroId === livroId && !e.devolvido).length;
  return Math.max(0, (livro.acervo || 0) - ativos);
}

function totalEmprestimosLivro(livroId) {
  return state.emprestimos.filter(e => e.livroId === livroId).length;
}

async function recarregarTudo() {
  await Promise.all([carregarAlunos(), carregarLivros(), carregarEmprestimos(), carregarDashboard()]);
  popularSelectsCategorias();
  const passos = [
    ['renderDashboard', renderDashboard],
    ['renderAlunos', renderAlunos],
    ['renderLivros', renderLivros],
    ['renderEstante', renderEstante],
    ['renderEmprestimos', renderEmprestimos],
    ['renderHistoricoAtividades', renderHistoricoAtividades],
    ['atualizarBadgeNotificacoes', atualizarBadgeNotificacoes],
    ['popularSelectsEmprestimo', popularSelectsEmprestimo]
  ];
  for (const [nome, fn] of passos) {
    try { fn(); }
    catch (e) { console.error('[recarregarTudo] falhou em ' + nome + ':', e); }
  }
}

// ============================================================
// DASHBOARD (painel resumo)
// ============================================================

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return;

  $('#statLivros').textContent = d.livrosTitulos ?? 0;
  $('#statDisponiveis').textContent = d.exemplaresDisponiveis ?? 0;
  $('#statEmprestados').textContent = d.exemplaresEmprestados ?? 0;
  $('#statAlunos').textContent = d.alunosTotal ?? 0;
  $('#statEmprestimosAtivos').textContent = d.emprestimosAtivos ?? 0;
  $('#statEmprestimosVencidos').textContent = d.emprestimosAtrasados ?? 0;
  $('#statDevolucoesHoje').textContent = d.devolucoesHoje ?? 0;

  // Banner de alerta
  const banner = $('#dashboardAlertBanner');
  if (d.emprestimosAtrasados > 0) {
    banner.style.display = 'flex';
    $('#alertBannerTitle').textContent = `Atenção: ${d.emprestimosAtrasados} empréstimo(s) com prazo vencido!`;
    $('#alertBannerDesc').textContent = 'Alunos precisam devolver livros pendentes.';
  } else {
    banner.style.display = 'none';
  }

  // Devoluções recentes
  const tbody = $('#devolucoesRecentesBody');
  const devol = d.devolucoesRecentes || [];
  if (!devol.length) {
    tbody.innerHTML = '';
    $('#devolucoesRecentesEmpty').style.display = 'block';
  } else {
    $('#devolucoesRecentesEmpty').style.display = 'none';
    tbody.innerHTML = devol.map(e => {
      let conservacao = '—';
      if (e.estadoSaida && e.estadoDevolucao) {
        const piorou = estadoPiorou(e.estadoSaida, e.estadoDevolucao);
        conservacao = `${escapeHtml(e.estadoSaida)} → <strong style="${piorou ? 'color: var(--danger);' : 'color: #15803d;'}">${escapeHtml(e.estadoDevolucao)}</strong>${piorou ? ' ⚠️' : ''}`;
      } else if (e.estadoDevolucao) {
        conservacao = escapeHtml(e.estadoDevolucao);
      }
      return `<tr>
        <td>${escapeHtml(e.alunoNome)}</td>
        <td>${escapeHtml(e.alunoTurma)}</td>
        <td>${escapeHtml(e.livroTitulo)}</td>
        <td>${formatarData(e.dataDevolucao)}</td>
        <td>${conservacao}</td>
      </tr>`;
    }).join('');
  }
}

// ============================================================
// ALUNOS
// ============================================================

function renderAlunos() {
  const busca = state.buscaAluno.trim().toLowerCase();
  const lista = state.alunos.filter(a =>
    !busca || a.nome.toLowerCase().includes(busca) || String(a.turma).toLowerCase().includes(busca)
  );

  $('#alunosCountSmall').textContent = `${state.alunos.length} aluno(s)`;

  const tbody = $('#alunosBody');
  if (!lista.length) {
    tbody.innerHTML = '';
    $('#alunosEmpty').style.display = 'block';
    return;
  }
  $('#alunosEmpty').style.display = 'none';

  tbody.innerHTML = lista.map(a => `
    <tr>
      <td>${escapeHtml(a.nome)}</td>
      <td><span class="pill">${escapeHtml(a.turma)}</span></td>
      <td>${a.total ?? 0} (${a.ativos ?? 0} ativo(s))</td>
      <td>${renderEstrelas(a.nota, a.estrelas)} ${situacaoBadgeHTML(a)}</td>
      <td class="table-actions">
        <div class="inline-actions">
          <button type="button" class="secondary btn-small" data-editar-aluno="${a.id}">✏️ Editar</button>
          <button type="button" class="danger btn-small" data-excluir-aluno="${a.id}">🗑️ Excluir</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function cadastrarAluno(e) {
  e.preventDefault();
  const nome = $('#alunoNome').value.trim();
  const turma = $('#alunoTurma').value;

  if (!nome) { toast('Informe o nome do aluno.', 'erro'); return; }
  if (!turma) { toast('Selecione a sala/turma.', 'erro'); return; }

  try {
    await api('/api/alunos', { method: 'POST', body: { nome, turma } });
    $('#alunoNome').value = '';
    $('#alunoTurma').value = '';
    toast(`Aluno "${nome}" cadastrado com sucesso!`);
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function abrirEditarAluno(id) {
  const aluno = state.alunos.find(a => a.id === id);
  if (!aluno) return;
  state.editandoAlunoId = id;
  $('#editarAlunoNome').value = aluno.nome;
  popularSelectTurmas($('#editarAlunoTurma'));
  $('#editarAlunoTurma').value = aluno.turma;
  abrirModal('#modalEditarAluno');
}

async function salvarEdicaoAluno() {
  const nome = $('#editarAlunoNome').value.trim();
  const turma = $('#editarAlunoTurma').value;
  if (!nome) { toast('Informe o nome do aluno.', 'erro'); return; }
  if (!turma) { toast('Selecione a sala/turma.', 'erro'); return; }

  try {
    await api(`/api/alunos/${state.editandoAlunoId}`, { method: 'PUT', body: { nome, turma } });
    fecharModal('#modalEditarAluno');
    toast('Aluno atualizado com sucesso!');
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

async function excluirAluno(id) {
  const aluno = state.alunos.find(a => a.id === id);
  if (!aluno) return;
  if (!confirm(`Excluir o aluno "${aluno.nome}"?\n\nO histórico de empréstimos concluídos dele também será removido.`)) return;
  try {
    await api(`/api/alunos/${id}`, { method: 'DELETE' });
    toast('Aluno excluído com sucesso.');
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function exportarAlunos() {
  baixarCSV('alunos.csv', [
    ['Nome', 'Turma', 'Empréstimos', 'Devolvidos', 'Atrasos', 'Nota', 'Estrelas'],
    ...state.alunos.map(a => [a.nome, a.turma, a.total ?? 0, a.concluidos ?? 0, a.atrasos ?? 0, a.nota ?? 5, a.estrelas ?? ''])
  ]);
}

// ---------------- Importação DED ----------------

function parseDedTexto(texto, turmaPadrao) {
  const resultados = [];
  const linhas = String(texto || '').split(/\r?\n/);
  const turmas = /^(?:\d{1,2}\s*(?:°|º|o)?\s*[A-Da-d])$/;

  for (let linha of linhas) {
    linha = linha.trim();
    if (!linha) continue;

    let partes = linha.includes(';') ? linha.split(';') : (linha.includes('\t') ? linha.split('\t') : null);
    if (partes && partes.length >= 2) {
      partes = partes.map(parte => parte.trim().replace(/^"|"$/g, ''));
      if (/nome|aluno|matr[íi]cula|turma/i.test(linha) && /nome|aluno/i.test(linha)) continue;
      const turma = partes.find(parte => turmas.test(parte.replace(/\s*ANO\s*/i, ' '))) || turmaPadrao || '';
      const nome = partes.find(parte => /[a-zA-ZÀ-ÿ]/.test(parte) && !turmas.test(parte) && !/^(matr[íi]cula|aluno|nome)$/i.test(parte) && !/^\d+$/.test(parte));
      if (nome && nome.length > 2) {
        resultados.push({ nome, turma });
        continue;
      }
    }

    // Formato colunar: "1  1234567  Maria Silva Santos  7ºA"
    const colunas = linha.split(/\s{2,}|\t+/).map(s => s.trim()).filter(Boolean);
    if (colunas.length >= 2) {
      const turmaCand = colunas.find(coluna => turmas.test(coluna.replace(/\s*ANO\s*/i, ' ')));
      const pareceTurma = !!turmaCand;
      if (pareceTurma) {
        const nome = colunas.filter(c => c !== turmaCand && !/^\d+$/.test(c) && !/^(matr[íi]cula|aluno|nome)$/i.test(c)).join(' ');
        if (nome && nome.length > 2) {
          resultados.push({ nome, turma: turmaCand });
          continue;
        }
      }
    }

    // Linha simples: nome no meio, turma no fim (ex.: "1 1234567 Maria Silva 7ºA")
    const m = linha.match(/^(?:\d+\s+)?(?:\d{4,}\s+)?(.+?)\s+(\d{1,2}\s*[°º]?\s*[A-Da-d])$/);
    if (m) {
      const nome = m[1].replace(/\s{2,}/g, ' ').trim();
      if (nome.length > 2 && !/^\d+$/.test(nome)) {
        resultados.push({ nome, turma: m[2] });
        continue;
      }
    }

    // Apenas nome (usa turma padrão)
    const soNome = linha.replace(/^\d+\s+/, '').replace(/^\d{4,}\s+/, '').trim();
    if (soNome.length > 2 && /[a-zA-ZÀ-ÿ]/.test(soNome) && !/^\d+$/.test(soNome) && turmaPadrao) {
      resultados.push({ nome: soNome, turma: turmaPadrao });
    }
  }
  return resultados;
}

function processarDed() {
  const texto = $('#dedTextoInput').value;
  const turmaPadrao = $('#dedTurmaPadrao').value;
  if (!texto.trim()) { toast('Cole o texto ou carregue um arquivo primeiro.', 'aviso'); return; }

  const alunos = parseDedTexto(texto, turmaPadrao);
  if (!alunos.length) {
    toast('Nenhum aluno identificado. Verifique o formato.', 'aviso');
    return;
  }

  state.dedPreview = alunos;
  $('#dedTotalEncontrados').textContent = alunos.length;
  $('#dedPreviewContainer').style.display = 'block';

  const nomesExistentes = new Set(state.alunos.map(a => a.nome.toLowerCase()));
  $('#dedPreviewBody').innerHTML = alunos.map((a, i) => {
    const duplicado = $('#dedIgnorarDuplicados').checked && nomesExistentes.has(a.nome.toLowerCase());
    return `<tr>
      <td style="padding:8px 12px;">${i + 1}</td>
      <td style="padding:8px 12px;">${escapeHtml(a.nome)}</td>
      <td style="padding:8px 12px;">${escapeHtml(a.turma || '(sem turma)')}</td>
      <td style="padding:8px 12px;">${duplicado ? '<span class="status-pill badge-warning">Duplicado</span>' : '<span class="status-pill badge-ok">Novo</span>'}</td>
    </tr>`;
  }).join('');

  $('#btnDedConfirmarImportacao').disabled = false;
}

async function confirmarImportacaoDed() {
  const ignorarDuplicados = $('#dedIgnorarDuplicados').checked;
  const nomesExistentes = new Set(state.alunos.map(a => a.nome.toLowerCase()));

  let importados = 0, ignorados = 0;
  for (const a of state.dedPreview) {
    if (!a.turma) { ignorados++; continue; }
    if (ignorarDuplicados && nomesExistentes.has(a.nome.toLowerCase())) { ignorados++; continue; }
    try {
      await api('/api/alunos', { method: 'POST', body: { nome: a.nome, turma: a.turma } });
      nomesExistentes.add(a.nome.toLowerCase());
      importados++;
    } catch (e) {
      ignorados++;
    }
  }

  fecharModal('#modalImportarDed');
  $('#dedTextoInput').value = '';
  $('#dedPreviewContainer').style.display = 'none';
  $('#btnDedConfirmarImportacao').disabled = true;
  toast(`Importação concluída: ${importados} aluno(s) importado(s), ${ignorados} ignorado(s).`);
  await recarregarTudo();
}

// ============================================================
// LIVROS
// ============================================================

function renderLivros() {
  const busca = state.buscaLivro.trim().toLowerCase();
  let lista = state.livros.filter(l =>
    !busca || l.titulo.toLowerCase().includes(busca) || l.autor.toLowerCase().includes(busca) || l.categoria.toLowerCase().includes(busca)
  );

  const ordem = state.ordemLivros;
  if (ordem === 'alfabetica-asc') lista.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  else if (ordem === 'alfabetica-desc') lista.sort((a, b) => b.titulo.localeCompare(a.titulo, 'pt-BR'));
  else if (ordem === 'autor') lista.sort((a, b) => a.autor.localeCompare(b.autor, 'pt-BR'));
  else if (ordem === 'mais-emprestados') lista.sort((a, b) => totalEmprestimosLivro(b.id) - totalEmprestimosLivro(a.id));
  else if (ordem === 'menos-emprestados') lista.sort((a, b) => totalEmprestimosLivro(a.id) - totalEmprestimosLivro(b.id));
  else if (ordem === 'disponiveis') lista.sort((a, b) => disponiveisLivro(b.id) - disponiveisLivro(a.id));

  const totalExemplares = state.livros.reduce((s, l) => s + (l.acervo || 0), 0);
  const totalEmprestados = state.emprestimos.filter(e => !e.devolvido).length;
  $('#livrosCountSmall').textContent = `${state.livros.length} livro(s)`;
  $('#livrosDisponiveisSmall').textContent = `${Math.max(0, totalExemplares - totalEmprestados)} disponíveis`;

  const tbody = $('#livrosBody');
  if (!lista.length) {
    tbody.innerHTML = '';
    $('#livrosEmpty').style.display = 'block';
    return;
  }
  $('#livrosEmpty').style.display = 'none';

  if (ordem === 'categoria') {
    // Agrupado por categoria com linhas divisórias
    const grupos = new Map();
    for (const l of lista) {
      if (!grupos.has(l.categoria)) grupos.set(l.categoria, []);
      grupos.get(l.categoria).push(l);
    }
    const cats = [...grupos.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    let html = '';
    for (const cat of cats) {
      const livros = grupos.get(cat);
      html += `<tr class="table-category-header"><td colspan="7">📂 ${escapeHtml(cat)} — ${livros.length} livro(s)</td></tr>`;
      html += livros.map(l => linhaLivro(l)).join('');
    }
    tbody.innerHTML = html;
  } else {
    tbody.innerHTML = lista.map(l => linhaLivro(l)).join('');
  }
}

function formatarLocalizacao(livroOuLetra, numero) {
  const letra = String(livroOuLetra || '').trim().toUpperCase();
  const valorNumero = Number.parseInt(numero, 10);

  if (letra && Number.isInteger(valorNumero)) {
    return `${letra}-${String(valorNumero).padStart(2, '0')}`;
  }

  if (letra) {
    return letra;
  }

  return '';
}

function normalizarBuscaTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function livroTemLocalizacao(livro) {
  return !!formatarLocalizacao(livro.localizacaoLetra, livro.localizacaoNumero);
}

function classificacaoAtendeFiltro(livro, filtro) {
  const classificacao = String(livro.classificacao || '').trim();
  if (filtro === 'todos' || !filtro) return true;
  if (filtro === 'sem') return !classificacao;

  const fundamental = classificacao === 'Ensino Fundamental' || classificacao === 'Fundamental e Médio';
  const medio = classificacao === 'Ensino Médio' || classificacao === 'Fundamental e Médio';

  if (filtro === 'fundamental') return fundamental;
  if (filtro === 'medio') return medio;
  return true;
}

function compararLocalizacao(a, b) {
  const aLoc = formatarLocalizacao(a.localizacaoLetra, a.localizacaoNumero);
  const bLoc = formatarLocalizacao(b.localizacaoLetra, b.localizacaoNumero);

  if (!aLoc && !bLoc) return a.titulo.localeCompare(b.titulo, 'pt-BR');
  if (!aLoc) return 1;
  if (!bLoc) return -1;

  const aLetra = String(a.localizacaoLetra || '').toUpperCase();
  const bLetra = String(b.localizacaoLetra || '').toUpperCase();
  const aNumero = Number.parseInt(a.localizacaoNumero, 10) || 0;
  const bNumero = Number.parseInt(b.localizacaoNumero, 10) || 0;

  if (aLetra !== bLetra) return aLetra.localeCompare(bLetra, 'pt-BR');
  if (aNumero !== bNumero) return aNumero - bNumero;
  return a.titulo.localeCompare(b.titulo, 'pt-BR');
}

function dadosMetadataLivro(l) {
  const metadados = [];
  if (l.genero) metadados.push(`Gênero: ${escapeHtml(l.genero)}`);
  if (l.classificacao) metadados.push(`Classificação: ${escapeHtml(l.classificacao)}`);

  const localizacao = formatarLocalizacao(l.localizacaoLetra, l.localizacaoNumero);
  if (localizacao) metadados.push(`Localização: ${escapeHtml(localizacao)}`);

  if (!metadados.length) return '';
  return `<div style="margin-top:4px; font-size:11px; color:var(--muted); line-height:1.4;">${metadados.map(item => `<div>${item}</div>`).join('')}</div>`;
}

function linhaLivro(l) {
  const disp = disponiveisLivro(l.id);
  return `<tr>
    <td>${capaThumbHTML(l)}</td>
    <td>${escapeHtml(l.titulo)}</td>
    <td>${escapeHtml(l.autor)}</td>
    <td>
      <span class="pill">${escapeHtml(l.categoria)}</span>
      ${dadosMetadataLivro(l)}
    </td>
    <td>${l.acervo}</td>
    <td><strong style="color: ${disp > 0 ? '#15803d' : 'var(--danger)'};">${disp}</strong></td>
    <td class="table-actions">
      <div class="inline-actions">
        <button type="button" class="secondary btn-small" data-etiqueta-livro="${l.id}">🏷️ Etiqueta</button>
        <button type="button" class="secondary btn-small" data-editar-livro="${l.id}">✏️ Editar</button>
        <button type="button" class="danger btn-small" data-excluir-livro="${l.id}">🗑️</button>
      </div>
    </td>
  </tr>`;
}

async function cadastrarLivro(e) {
  e.preventDefault();
  const titulo = $('#livroTitulo').value.trim();
  const autor = $('#livroAutor').value.trim();
  const categoria = $('#livroCategoria').value.trim();
  const acervo = parseInt($('#livroAcervo').value, 10) || 1;
  const capaUrl = $('#livroCapa').value.trim();
  const isbn = $('#livroIsbn').value.trim();
  const genero = $('#livroGenero').value.trim();
  const classificacao = $('#livroClassificacao').value;
  const localizacao = $('#livroLocalizacao').value.trim();
  const localizacaoInfo = (() => {
    const texto = String(localizacao || '').trim();
    if (!texto) return { localizacaoLetra: null, localizacaoNumero: null };

    const match = texto.match(/^([A-Za-z]+)\s*[-/ ]\s*(\d+)$/);
    if (match) {
      return {
        localizacaoLetra: match[1].toUpperCase(),
        localizacaoNumero: Math.max(1, parseInt(match[2], 10) || 1)
      };
    }

    const fallback = texto.match(/^([A-Za-z]+)\s*(\d+)$/);
    if (fallback) {
      return {
        localizacaoLetra: fallback[1].toUpperCase(),
        localizacaoNumero: Math.max(1, parseInt(fallback[2], 10) || 1)
      };
    }

    return { localizacaoLetra: null, localizacaoNumero: null };
  })();

  if (!titulo || !autor || !categoria) { toast('Preencha título, autor e categoria.', 'erro'); return; }

  try {
    await api('/api/livros', { method: 'POST', body: {
      titulo,
      autor,
      categoria,
      acervo,
      capaUrl: capaUrl || null,
      isbn: isbn || null,
      classificacao: classificacao || null,
      genero: genero || null,
      localizacaoLetra: localizacaoInfo.localizacaoLetra,
      localizacaoNumero: localizacaoInfo.localizacaoNumero
    } });

    $('#livroTitulo').value = '';
    $('#livroAutor').value = '';
    $('#livroCategoria').value = '';
    $('#livroGenero').value = '';
    $('#livroClassificacao').value = '';
    $('#livroLocalizacao').value = '';
    $('#livroAcervo').value = '1';
    $('#livroCapa').value = '';
    $('#livroIsbn').value = '';
    atualizarPreviewCapa();
    toast(`Livro "${titulo}" cadastrado com sucesso!`);
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function atualizarPreviewCapa() {
  const url = $('#livroCapa').value.trim();
  const img = $('#livroCapaPreview');
  if (url) {
    img.src = url;
    img.style.display = 'block';
    img.onerror = () => { img.style.display = 'none'; };
  } else {
    img.style.display = 'none';
  }
}

function abrirEditarLivro(id) {
  const livro = state.livros.find(l => l.id === id);
  if (!livro) return;
  state.editandoLivroId = id;
  $('#editarLivroTitulo').value = livro.titulo;
  $('#editarLivroAutor').value = livro.autor;
  $('#editarLivroCategoria').value = livro.categoria;
  $('#editarLivroGenero').value = livro.genero || '';
  $('#editarLivroClassificacao').value = livro.classificacao || '';
  $('#editarLivroLocalizacao').value = formatarLocalizacao(livro.localizacaoLetra, livro.localizacaoNumero);
  $('#editarLivroAcervo').value = livro.acervo;
  $('#editarLivroCapa').value = livro.capaUrl || '';
  abrirModal('#modalEditarLivro');
}

async function salvarEdicaoLivro() {
  const titulo = $('#editarLivroTitulo').value.trim();
  const autor = $('#editarLivroAutor').value.trim();
  const categoria = $('#editarLivroCategoria').value.trim();
  const acervo = parseInt($('#editarLivroAcervo').value, 10) || 1;
  const capaUrl = $('#editarLivroCapa').value.trim();
  const genero = $('#editarLivroGenero').value.trim();
  const classificacao = $('#editarLivroClassificacao').value;
  const localizacao = $('#editarLivroLocalizacao').value.trim();
  const localizacaoInfo = (() => {
    const texto = String(localizacao || '').trim();
    if (!texto) return { localizacaoLetra: null, localizacaoNumero: null };

    const match = texto.match(/^([A-Za-z]+)\s*[-/ ]\s*(\d+)$/);
    if (match) {
      return {
        localizacaoLetra: match[1].toUpperCase(),
        localizacaoNumero: Math.max(1, parseInt(match[2], 10) || 1)
      };
    }

    const fallback = texto.match(/^([A-Za-z]+)\s*(\d+)$/);
    if (fallback) {
      return {
        localizacaoLetra: fallback[1].toUpperCase(),
        localizacaoNumero: Math.max(1, parseInt(fallback[2], 10) || 1)
      };
    }

    return { localizacaoLetra: null, localizacaoNumero: null };
  })();

  if (!titulo || !autor || !categoria) { toast('Preencha título, autor e categoria.', 'erro'); return; }

  try {
    await api(`/api/livros/${state.editandoLivroId}`, { method: 'PUT', body: {
      titulo,
      autor,
      categoria,
      acervo,
      capaUrl: capaUrl || null,
      genero: genero || null,
      classificacao: classificacao || null,
      localizacaoLetra: localizacaoInfo.localizacaoLetra,
      localizacaoNumero: localizacaoInfo.localizacaoNumero
    } });
    fecharModal('#modalEditarLivro');
    toast('Livro atualizado com sucesso!');
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

async function excluirLivro(id) {
  const livro = state.livros.find(l => l.id === id);
  if (!livro) return;
  if (!confirm(`Excluir o livro "${livro.titulo}"?\n\nO histórico de empréstimos concluídos dele também será removido.`)) return;
  try {
    await api(`/api/livros/${id}`, { method: 'DELETE' });
    toast('Livro excluído com sucesso.');
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function exportarLivros() {
  baixarCSV('livros.csv', [
    ['Título', 'Autor', 'Categoria', 'Exemplares', 'Disponíveis', 'URL da capa'],
    ...state.livros.map(l => [l.titulo, l.autor, l.categoria, l.acervo, disponiveisLivro(l.id), l.capaUrl || ''])
  ]);
}

// ---------------- Etiqueta QR ----------------

function abrirEtiqueta(id) {
  const livro = state.livros.find(l => l.id === id);
  if (!livro) return;

  $('#labelBookTitle').textContent = livro.titulo;
  $('#labelBookAuthor').textContent = livro.autor;
  $('#labelBookCategory').textContent = livro.categoria;
  $('#labelBookCopies').textContent = `${livro.acervo} exemplar(es)`;

  const container = $('#qrCodeContainer');
  container.innerHTML = '';

  if (typeof QRCode !== 'undefined') {
    try {
      new QRCode(container, {
        text: `LIVRO:${livro.id}:${livro.titulo}`,
        width: 120,
        height: 120
      });
    } catch (e) {
      container.innerHTML = '<div style="font-size:11px;color:#94a3b8;">QR indisponível</div>';
    }
  } else {
    container.innerHTML = '<div style="font-size:11px;color:#94a3b8;text-align:center;padding:40px 8px;">Biblioteca QR não carregada (assets/js/vendor/qrcode.min.js ausente)</div>';
  }

  abrirModal('#modalQrEtiqueta');
}

// ---------------- Scanner QR / ISBN ----------------

let html5Scanner = null;

function abrirScanner(contexto) {
  state.scannerContexto = contexto;
  abrirModal('#modalQrScanner');
  mostrarFeedbackScanner('');

  // Câmera só funciona se a biblioteca vendor estiver carregada
  if (typeof Html5Qrcode === 'undefined') {
    mostrarFeedbackScanner('📷 Leitura por câmera indisponível: biblioteca html5-qrcode não encontrada em assets/js/vendor/. Use a digitação manual abaixo.', 'aviso');
    return;
  }

  try {
    html5Scanner = new Html5Qrcode('qrReaderElem');
    html5Scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (textoDecodificado) => {
        mostrarFeedbackScanner(`Código lido: ${textoDecodificado}`, 'ok');
        processarCodigoLido(textoDecodificado);
      }
    ).catch(() => {
      mostrarFeedbackScanner('Não foi possível acessar a câmera. Use a digitação manual.', 'erro');
    });
  } catch (e) {
    mostrarFeedbackScanner('Erro ao iniciar o leitor. Use a digitação manual.', 'erro');
  }
}

async function fecharScanner() {
  if (html5Scanner) {
    try { await html5Scanner.stop(); } catch (e) {}
    try { html5Scanner.clear(); } catch (e) {}
    html5Scanner = null;
  }
  fecharModal('#modalQrScanner');
}

function mostrarFeedbackScanner(msg, tipo) {
  const el = $('#scannerFeedback');
  if (!el) return;
  el.style.display = msg ? 'block' : 'none';
  el.textContent = msg;
  el.style.background = tipo === 'erro' ? '#fee2e2' : tipo === 'aviso' ? '#fef3c7' : '#dcfce7';
  el.style.color = tipo === 'erro' ? '#991b1b' : tipo === 'aviso' ? '#92400e' : '#166534';
}

async function processarCodigoLido(codigo) {
  const valor = String(codigo || '').trim();
  const qr = valor.match(/^LIVRO\s*:\s*(\d+)\s*:/i);
  if (qr) {
    const livroQr = state.livros.find(l => Number(l.id) === Number(qr[1]));
    if (livroQr) {
      if (state.scannerContexto === 'emprestimo') {
        const sel = $('#emprestimoLivro');
        sel.value = String(livroQr.id);
        if (sel.__combobox) sel.__combobox.sync();
      } else {
        $('#livroTitulo').value = livroQr.titulo;
        $('#livroAutor').value = livroQr.autor;
        $('#livroCategoria').value = livroQr.categoria;
        $('#livroGenero').value = livroQr.genero || '';
        $('#livroClassificacao').value = livroQr.classificacao || '';
        $('#livroLocalizacao').value = formatarLocalizacao(livroQr.localizacaoLetra, livroQr.localizacaoNumero);
        $('#livroAcervo').value = livroQr.acervo || 1;
        $('#livroIsbn').value = livroQr.isbn || '';
        if (livroQr.capaUrl) $('#livroCapa').value = livroQr.capaUrl;
        atualizarPreviewCapa();
      }
      await fecharScanner();
      toast(state.scannerContexto === 'emprestimo'
        ? `Livro "${livroQr.titulo}" selecionado!`
        : `Dados do livro "${livroQr.titulo}" preenchidos!`);
      return;
    }
  }
  const isbn = valor.replace(/[^0-9Xx]/g, '').toUpperCase();
  const livroLocal = state.livros.find(l => l.isbn && String(l.isbn).replace(/[^0-9Xx]/g, '').toUpperCase() === isbn);
  if (livroLocal && state.scannerContexto === 'emprestimo') {
    const sel = $('#emprestimoLivro');
    sel.value = String(livroLocal.id);
    if (sel.__combobox) sel.__combobox.sync();
    await fecharScanner();
    toast(`Livro "${livroLocal.titulo}" selecionado!`);
    return;
  }
  if (state.scannerContexto === 'emprestimo') {
    // Localiza livro pelo título contendo o código ou abre busca
    const livro = state.livros.find(l => l.titulo.toLowerCase().includes(codigo.toLowerCase()));
    if (livro) {
      const sel = $('#emprestimoLivro');
      sel.value = String(livro.id);
      if (sel.__combobox) sel.__combobox.sync();
      await fecharScanner();
      toast(`Livro "${livro.titulo}" selecionado!`);
    } else if (isbn.length >= 10) {
      await buscarIsbnEPreencher(isbn, true);
    } else {
      mostrarFeedbackScanner('Livro não encontrado pelo código. Tente buscar pelo ISBN.', 'aviso');
    }
  } else {
    if (isbn.length >= 10) {
      await buscarIsbnEPreencher(isbn, false);
    } else {
      mostrarFeedbackScanner(`Código "${codigo}" não parece um ISBN.`, 'aviso');
    }
  }
}

async function buscarIsbnEPreencher(isbn, selecionarEmprestimo) {
  mostrarFeedbackScanner(`Buscando ISBN ${isbn} nas bases públicas...`, 'ok');
  try {
    let dados = null;
    for (const fonte of [`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`, `https://openlibrary.org/isbn/${isbn}.json`]) {
      try {
        const resposta = await fetch(fonte);
        if (!resposta.ok) continue;
        const recebido = await resposta.json();
        if (recebido.items?.[0]?.volumeInfo) {
          const info = recebido.items[0].volumeInfo;
          dados = { title: info.title, authors: (info.authors || []).map(name => ({ name })), cover: info.imageLinks?.thumbnail };
        } else if (recebido.title) {
          dados = recebido;
        }
        if (dados?.title) break;
      } catch (e) {}
    }
    if (!dados) throw new Error('não encontrado');
    const titulo = dados.title || '';
    let autor = dados.authors?.[0]?.name || '';
    if (dados.authors && dados.authors.length) {
      try {
        const resAutor = await fetch(`https://openlibrary.org${dados.authors[0].key}.json`);
        const dadosAutor = await resAutor.json();
        autor = dadosAutor.name || '';
      } catch (e) {}
    }
    if (!titulo) throw new Error('sem título');

    if (selecionarEmprestimo) {
      const livro = state.livros.find(l => l.titulo.toLowerCase() === titulo.toLowerCase());
      if (livro) {
        const sel = $('#emprestimoLivro');
        sel.value = String(livro.id);
        if (sel.__combobox) sel.__combobox.sync();
        await fecharScanner();
        toast(`Livro "${livro.titulo}" selecionado!`);
        return;
      }
    }

    $('#livroTitulo').value = titulo;
    if (autor) $('#livroAutor').value = autor;
    $('#livroIsbn').value = isbn;
    if (dados.cover) $('#livroCapa').value = dados.cover.replace('http://', 'https://');
    atualizarPreviewCapa();
    await fecharScanner();
    toast(`Dados do ISBN preenchidos! Verifique e cadastre o livro.`);
  } catch (e) {
    mostrarFeedbackScanner('ISBN não encontrado nas bases públicas. Preencha manualmente.', 'erro');
  }
}

function buscarManualScanner() {
  const codigo = $('#scannerManualInput').value.trim();
  if (!codigo) { toast('Digite um código/ISBN.', 'aviso'); return; }
  processarCodigoLido(codigo);
}

// ============================================================
// ESTANTE (cards com capas)
// ============================================================

function statusLivroEstante(livro) {
  const disp = disponiveisLivro(livro.id);
  if (disp > 0) return { chave: 'disponivel', label: 'Disponível', pill: 'badge-ok' };
  if ((livro.acervo || 0) > 0) return { chave: 'emprestado', label: 'Emprestado', pill: 'badge-overdue' };
  return { chave: 'indisponivel', label: 'Indisponível', pill: 'badge-returned' };
}

function popularSelectsCategorias() {
  // Categoria agora é texto livre no cadastro/edição — só o filtro da Estante
  // precisa ser preenchido, e as opções vêm das categorias dos próprios livros.
  const shelfCategoria = $('#shelfFilterCategory');
  if (!shelfCategoria) return;

  const categorias = categoriasExistentes();
  const atual = state.shelf.categoria || shelfCategoria.value || '';
  shelfCategoria.innerHTML = '<option value="">Todas as Categorias</option>' +
    categorias.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  shelfCategoria.value = categorias.includes(atual) ? atual : '';
  state.shelf.categoria = shelfCategoria.value;
}

function renderEstante() {
  const { groupBy, sortBy, categoria, genero, classificacao, localizacao, status, busca } = state.shelf;

  const filtroCat = $('#shelfFilterCategory');
  const filtroGenero = $('#shelfFilterGenre');
  const filtroClassificacao = $('#shelfFilterClassificacao');
  const filtroLocalizacao = $('#shelfFilterLocation');

  const categorias = categoriasExistentes();
  filtroCat.innerHTML = '<option value="">Todas as Categorias</option>' +
    categorias.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  const generos = [...new Set(state.livros.map(l => l.genero).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  filtroGenero.innerHTML = '<option value="">Todos os Gêneros</option>' +
    generos.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');

  if (categorias.includes(state.shelf.categoria)) {
    filtroCat.value = state.shelf.categoria;
  } else {
    state.shelf.categoria = '';
    filtroCat.value = '';
  }

  if (generos.includes(state.shelf.genero)) {
    filtroGenero.value = state.shelf.genero;
  } else {
    state.shelf.genero = '';
    filtroGenero.value = '';
  }

  if (!['todos', 'fundamental', 'medio', 'sem'].includes(state.shelf.classificacao)) {
    state.shelf.classificacao = 'todos';
  }
  filtroClassificacao.value = state.shelf.classificacao || 'todos';

  if (!['todos', 'sem'].includes(state.shelf.localizacao)) {
    state.shelf.localizacao = 'todos';
  }
  filtroLocalizacao.value = state.shelf.localizacao || 'todos';

  let lista = [...state.livros];

  if (categoria) lista = lista.filter(l => l.categoria === categoria);
  if (genero) lista = lista.filter(l => l.genero === genero);
  if (classificacao && classificacao !== 'todos') lista = lista.filter(l => classificacaoAtendeFiltro(l, classificacao));
  if (localizacao === 'sem') lista = lista.filter(l => !livroTemLocalizacao(l));
  if (status) lista = lista.filter(l => statusLivroEstante(l).chave === status);

  if (busca.trim()) {
    const buscaNormalizada = normalizarBuscaTexto(busca);
    lista = lista.filter(l => {
      const textosBusca = [
        l.titulo,
        l.autor,
        l.categoria,
        l.genero,
        l.classificacao,
        formatarLocalizacao(l.localizacaoLetra, l.localizacaoNumero),
        `${l.localizacaoLetra || ''}${l.localizacaoNumero || ''}`,
        l.localizacaoLetra ? `estante${l.localizacaoLetra}` : ''
      ].map(normalizarBuscaTexto);
      return textosBusca.some(texto => texto.includes(buscaNormalizada));
    });
  }

  if (sortBy === 'titulo-asc') lista.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  else if (sortBy === 'titulo-desc') lista.sort((a, b) => b.titulo.localeCompare(a.titulo, 'pt-BR'));
  else if (sortBy === 'autor-asc') lista.sort((a, b) => a.autor.localeCompare(b.autor, 'pt-BR'));
  else if (sortBy === 'acervo-desc') lista.sort((a, b) => b.acervo - a.acervo);
  else if (sortBy === 'recentes') lista.sort((a, b) => (b.id || 0) - (a.id || 0));
  else if (sortBy === 'populares') lista.sort((a, b) => totalEmprestimosLivro(b.id) - totalEmprestimosLivro(a.id));
  else if (sortBy === 'localizacao') lista.sort(compararLocalizacao);

  const container = $('#shelfContainer');
  $('#estanteTotalLivros').textContent = `${lista.length} livro(s) encontrados de ${state.livros.length} no acervo`;

  if (!lista.length) {
    container.innerHTML = '<div class="empty">Nenhum livro encontrado com os filtros selecionados.</div>';
    return;
  }

  const grupos = new Map();
  if (groupBy !== 'nenhum') {
    for (const l of lista) {
      let chave;
      if (groupBy === 'categoria') chave = l.categoria;
      else if (groupBy === 'autor') chave = l.autor;
      else if (groupBy === 'estante') chave = livroTemLocalizacao(l) ? `Estante ${l.localizacaoLetra}` : 'Sem localização';
      else chave = statusLivroEstante(l).label;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(l);
    }
  }

  const iconeGrupo = groupBy === 'categoria' ? '📂' : groupBy === 'autor' ? '✍️' : groupBy === 'estante' ? '📍' : '🟢';

  if (state.shelfView === 'spines') {
    if (groupBy === 'nenhum') {
      container.innerHTML = secaoEstanteMadeira('🏢 Acervo completo', lista, iconeGrupo, false);
    } else {
      const chaves = [...grupos.keys()].sort((a, b) => {
        if (a === 'Sem localização') return 1;
        if (b === 'Sem localização') return -1;
        return a.localeCompare(b, 'pt-BR');
      });
      container.innerHTML = chaves.map(chave =>
        secaoEstanteMadeira(`${iconeGrupo} ${chave}`, grupos.get(chave), iconeGrupo, true)
      ).join('');
    }
    return;
  }

  if (groupBy === 'nenhum') {
    container.innerHTML = `<div class="estante-grid">${lista.map(cardEstante).join('')}</div>`;
  } else {
    const chaves = [...grupos.keys()].sort((a, b) => {
      if (a === 'Sem localização') return 1;
      if (b === 'Sem localização') return -1;
      return a.localeCompare(b, 'pt-BR');
    });
    container.innerHTML = chaves.map(chave => `
      <div class="wood-shelf-section">
        <div class="wood-shelf-header">
          <div class="wood-shelf-title">${iconeGrupo} ${escapeHtml(chave)}</div>
          <span class="wood-shelf-count">${grupos.get(chave).length} livro(s)</span>
        </div>
        <div style="padding: 16px;">
          <div class="estante-grid">${grupos.get(chave).map(cardEstante).join('')}</div>
        </div>
      </div>
    `).join('');
  }
}

/**
 * Monta uma seção de estante de madeira com os livros em pé (lombadas 3D).
 * Cada lombada mostra o título vertical, ícone e ponto de status (verde = disponível, vermelho = emprestado).
 */
function secaoEstanteMadeira(titulo, livros, iconeGrupo, comHeader) {
  const lombadas = livros.map(livro => {
    const st = statusLivroEstante(livro);
    const fora = st.chave !== 'disponivel';
    return `
      <div class="spine-book" data-detalhes-livro="${livro.id}"
           style="background: linear-gradient(180deg, ${corCapa(livro.titulo)}, ${corCapa(livro.titulo)}b3);"
           title="${escapeHtml(livro.titulo)} — ${escapeHtml(livro.autor)} (${st.label})">
        <span class="spine-icon">📖</span>
        <span class="spine-title">${escapeHtml(livro.titulo)}</span>
        <span class="spine-status-dot ${fora ? 'out' : ''}"></span>
      </div>
    `;
  }).join('');

  return `
    <div class="wood-shelf-section">
      ${comHeader ? `
      <div class="wood-shelf-header">
        <div class="wood-shelf-title">${escapeHtml(titulo)}</div>
        <span class="wood-shelf-count">${livros.length} livro(s)</span>
      </div>` : ''}
      <div class="wood-shelf-stage">
        <div class="shelf-books-row">${lombadas}</div>
        <div class="wood-plank"></div>
      </div>
    </div>
  `;
}

function cardEstante(livro) {
  const st = statusLivroEstante(livro);
  const disp = disponiveisLivro(livro.id);
  const loc = formatarLocalizacao(livro.localizacaoLetra, livro.localizacaoNumero) || 'Localização não cadastrada';
  const capa = livro.capaUrl
    ? `<img src="${escapeHtml(livro.capaUrl)}" alt="Capa de ${escapeHtml(livro.titulo)}" loading="lazy"
         onerror="this.style.display='none'; this.parentElement.querySelector('.placeholder').style.display='flex';" />
       <div class="placeholder" style="display:none;"><span class="emoji">📖</span><span>${escapeHtml(livro.titulo)}</span></div>`
    : `<div class="placeholder"><span class="emoji">📖</span><span>${escapeHtml(livro.titulo)}</span></div>`;

  return `
    <div class="estante-card" data-detalhes-livro="${livro.id}" title="Ver detalhes">
      <div class="estante-cover">${capa}
        <span class="status-pill ${st.pill}" style="position:absolute; top:8px; right:8px; z-index:2; box-shadow:0 2px 8px rgba(0,0,0,0.25);">${st.label}</span>
      </div>
      <div class="estante-body">
        <div class="estante-title">${escapeHtml(livro.titulo)}</div>
        <div class="estante-author">${escapeHtml(livro.autor)}</div>
        <div class="estante-meta-row">
          <span class="estante-tag">${escapeHtml(livro.categoria)}</span>
          ${livro.genero ? `<span class="estante-tag estante-tag-alt">${escapeHtml(livro.genero)}</span>` : ''}
        </div>
        <div class="estante-meta-row estante-meta-row-compact">
          <span class="estante-tag estante-tag-muted">${escapeHtml(livro.classificacao || 'Classificação não definida')}</span>
        </div>
        <div class="estante-location">
          <span class="estante-location-icon">📍</span>
          <span>${escapeHtml(loc)}</span>
        </div>
        <div class="estante-footer">
          <span class="estante-availability">${disp > 0 ? 'Disponível' : 'Emprestado'}</span>
          <small class="muted" style="font-weight:900;">${disp} disp.</small>
        </div>
        <div class="estante-actions">
          <button type="button" class="secondary btn-small" data-localizar-livro="${livro.id}">📍 Localizar</button>
          <button type="button" class="secondary btn-small" data-editar-livro="${livro.id}">✏️ Editar</button>
        </div>
      </div>
    </div>
  `;
}

function abrirDetalhesLivro(id) {
  const livro = state.livros.find(l => l.id === id);
  if (!livro) return;
  const st = statusLivroEstante(livro);
  const disp = disponiveisLivro(livro.id);
  const totalEmp = totalEmprestimosLivro(livro.id);
  const localizacao = formatarLocalizacao(livro.localizacaoLetra, livro.localizacaoNumero) || 'Localização não cadastrada';

  $('#detalhesTituloModal').textContent = `📖 ${livro.titulo}`;
  $('#detalhesLivroConteudo').innerHTML = `
    <div style="display:flex; flex-direction:column; gap:14px;">
      <div style="display:flex; gap:16px; align-items:flex-start;">
        <div style="width:120px; height:170px; border-radius:10px; overflow:hidden; flex-shrink:0; background:#f1f5f9; display:flex; align-items:center; justify-content:center;">
          ${livro.capaUrl
            ? `<img src="${escapeHtml(livro.capaUrl)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=\"font-size:48px;\">📖</span>'" />`
            : `<span style="font-size:48px;">📖</span>`}
        </div>
        <div style="flex:1; display:flex; flex-direction:column; gap:8px; font-size:13px; font-weight:750;">
          <div><strong>Autor:</strong> ${escapeHtml(livro.autor)}</div>
          <div><strong>Categoria:</strong> ${escapeHtml(livro.categoria)}</div>
          <div><strong>Gênero:</strong> ${escapeHtml(livro.genero || '—')}</div>
          <div><strong>Classificação:</strong> ${escapeHtml(livro.classificacao || 'Classificação não definida')}</div>
          <div><strong>Exemplares:</strong> ${livro.acervo}</div>
          <div><strong>Disponíveis:</strong> ${disp}</div>
          <div><strong>Total de empréstimos:</strong> ${totalEmp}</div>
          <div><span class="status-pill ${st.pill}">${st.label}</span></div>
        </div>
      </div>
      <div style="padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(59,130,246,0.25); background: rgba(96,165,250,0.08); display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:13px; font-weight:900;">
        <span style="color: var(--muted);">📍 Localização física</span>
        <strong style="font-size:16px; color: var(--text);">${escapeHtml(localizacao)}</strong>
      </div>
    </div>
  `;

  $('#detalhesLivroAcoes').innerHTML = `
    <button type="button" class="secondary" data-etiqueta-livro="${livro.id}">🏷️ Etiqueta QR</button>
    <button type="button" class="secondary" data-editar-livro="${livro.id}">✏️ Editar</button>
    <button type="button" data-ir-emprestar="${livro.id}">🔄 Emprestar</button>
  `;

  abrirModal('#modalDetalhesLivro');
}

function abrirLocalizarLivro(id) {
  const livro = state.livros.find(l => l.id === id);
  if (!livro) return;
  state.localizarLivroId = id;

  const st = statusLivroEstante(livro);
  const disp = disponiveisLivro(livro.id);
  const loc = formatarLocalizacao(livro.localizacaoLetra, livro.localizacaoNumero);
  const temLoc = livroTemLocalizacao(livro);
  const capa = livro.capaUrl
    ? `<img src="${escapeHtml(livro.capaUrl)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'; this.parentElement.querySelector('.localizar-placeholder').style.display='flex';" /><div class="localizar-placeholder" style="display:none; align-items:center; justify-content:center; width:100%; height:100%; font-size:48px;">📖</div>`
    : `<div style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-size:48px;">📖</div>`;

  $('#localizarLivroConteudo').innerHTML = `
    <div style="display:flex; flex-direction:column; gap:14px;">
      <div style="display:flex; gap:16px; align-items:flex-start;">
        <div style="width:110px; height:158px; border-radius:10px; overflow:hidden; flex-shrink:0; background:#f1f5f9;">
          ${capa}
        </div>
        <div style="flex:1; display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:750; min-width:0;">
          <div style="font-size:15px; font-weight:1000; line-height:1.3;">${escapeHtml(livro.titulo)}</div>
          <div><strong>Autor:</strong> ${escapeHtml(livro.autor)}</div>
          <div><strong>Categoria:</strong> ${escapeHtml(livro.categoria)}</div>
          <div><strong>Gênero:</strong> ${escapeHtml(livro.genero || '—')}</div>
          <div><strong>Classificação:</strong> ${escapeHtml(livro.classificacao || 'Classificação não definida')}</div>
          <div><strong>Disponibilidade:</strong>
            <span class="status-pill ${st.pill}">${st.label}</span>
            <span style="color:var(--muted);">(${disp} de ${livro.acervo} exemplares)</span>
          </div>
        </div>
      </div>
      ${temLoc ? `
      <div style="text-align:center; padding:20px 14px; border-radius:14px; border:2px solid rgba(59,130,246,0.45); background:linear-gradient(180deg, rgba(96,165,250,0.16), rgba(96,165,250,0.08));">
        <div style="font-size:13px; font-weight:900; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;">📍 Localização física</div>
        <div style="font-size:17px; font-weight:900; color:#1d4ed8;">Estante ${escapeHtml(String(livro.localizacaoLetra || '').toUpperCase())} — posição ${escapeHtml(String(livro.localizacaoNumero ?? '').padStart(2, '0'))}</div>
        <div style="font-size:34px; font-weight:1000; letter-spacing:0.06em; color:var(--text); margin-top:4px;">${escapeHtml(loc)}</div>
      </div>`
      : `
      <div style="text-align:center; padding:20px 14px; border-radius:14px; border:2px dashed rgba(148,163,184,0.6); background:#f8fafc;">
        <div style="font-size:13px; font-weight:900; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;">📍 Localização física</div>
        <div style="font-size:18px; font-weight:1000; color:var(--muted);">Localização não cadastrada</div>
        <div style="font-size:12px; color:var(--muted); margin-top:6px;">Use “✏️ Editar” para cadastrar a estante e a posição deste livro.</div>
      </div>`}
    </div>
  `;

  abrirModal('#modalLocalizarLivro');
}

function irEmprestar(livroId) {
  fecharModal('#modalDetalhesLivro');
  if (window.__activateSection) window.__activateSection('emprestimos');
  setTimeout(() => {
    const sel = $('#emprestimoLivro');
    if (!sel) return;
    sel.value = String(livroId);
    if (sel.__combobox) sel.__combobox.sync();
  }, 100);
}

// ============================================================
// EMPRÉSTIMOS
// ============================================================

function renderEmprestimos() {
  const busca = state.buscaEmprestimo.trim().toLowerCase();
  const filtro = state.filtroEmprestimos;

  let lista = state.emprestimos.filter(e => {
    const st = statusEmprestimo(e);
    if (filtro === 'devolvidos' && !e.devolvido) return false;
    if (filtro !== 'todos' && filtro !== 'devolvidos' && st.chave !== filtro) return false;
    if (busca) {
      const alvo = `${e.alunoNome} ${e.alunoTurma} ${e.livroTitulo} ${st.label}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  const tbody = $('#emprestimosBody');
  if (!lista.length) {
    tbody.innerHTML = '';
    $('#emprestimosEmpty').style.display = 'block';
    return;
  }
  $('#emprestimosEmpty').style.display = 'none';

  tbody.innerHTML = lista.map(e => {
    const st = statusEmprestimo(e);
    let conservacao = '—';
    if (e.estadoSaida || e.estadoDevolucao) {
      const piorou = e.estadoSaida && e.estadoDevolucao && estadoPiorou(e.estadoSaida, e.estadoDevolucao);
      conservacao = `${escapeHtml(e.estadoSaida || '?')} → <strong style="${piorou ? 'color: var(--danger);' : 'color: #15803d;'}">${escapeHtml(e.estadoDevolucao || '?')}</strong>${piorou ? ' ⚠️' : ''}`;
    }
    return `<tr>
      <td>${escapeHtml(e.alunoNome)}<br/><small class="muted">${escapeHtml(e.alunoTurma)}</small></td>
      <td>${escapeHtml(e.livroTitulo)}</td>
      <td>${formatarData(e.dataRetirada)}</td>
      <td>${formatarData(e.dataLimite)}</td>
      <td>${pillStatus(e)}</td>
      <td>${e.devolvido ? formatarData(e.dataDevolucao) + `<br/><small>${conservacao}</small>` : '—'}</td>
      <td class="table-actions">
        <div class="inline-actions">
          ${!e.devolvido ? `<button type="button" class="btn-small" data-devolver="${e.id}">📥 Devolver</button>` : ''}
          <button type="button" class="secondary btn-small" data-historico="${e.id}">🗂️ Histórico</button>
          ${!e.devolvido ? `<button type="button" class="danger btn-small" data-cancelar-emprestimo="${e.id}">✖</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function registrarEmprestimo() {
  const alunoId = $('#emprestimoAluno').value;
  const livroId = $('#emprestimoLivro').value;
  const dataRetirada = $('#emprestimoData').value || hojeISO();
  const prazo = parseInt($('#emprestimoPrazo').value, 10) || 7;
  const estadoSaida = $('#emprestimoEstadoSaida').value;
  const obsSaida = $('#emprestimoObsSaida').value.trim();

  if (!alunoId) { toast('Selecione o aluno.', 'erro'); return; }
  if (!livroId) { toast('Selecione o livro.', 'erro'); return; }

  // Bloqueio também verificado no frontend (o backend recusa de qualquer forma)
  const alunoSel = state.alunos.find(a => String(a.id) === String(alunoId));
  if (alunoSel && alunoSel.bloqueado) {
    const fim = alunoSel.bloqueioFim ? formatarData(alunoSel.bloqueioFim) : 'em breve';
    toast(`Aluno temporariamente bloqueado. Novo empréstimo disponível em ${fim}.`, 'erro');
    return;
  }

  const limite = new Date(dataRetirada + 'T00:00:00');
  limite.setDate(limite.getDate() + prazo);
  const dataLimite = limite.toISOString().split('T')[0];

  try {
    await api('/api/emprestimos', {
      method: 'POST',
      body: { alunoId: Number(alunoId), livroId: Number(livroId), dataRetirada, dataLimite, estadoSaida, obsSaida: obsSaida || null }
    });
    toast('Empréstimo registrado com sucesso!');
    $('#emprestimoObsSaida').value = '';
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function abrirDevolucao(id) {
  const e = state.emprestimos.find(x => x.id === id);
  if (!e) return;
  state.devolucaoEmprestimoId = id;

  $('#devolucaoInfo').textContent = `${e.alunoNome} (${e.alunoTurma}) — "${e.livroTitulo}"`;
  $('#devolucaoEstadoSaida').textContent = e.estadoSaida || 'Não registrado';
  $('#devolucaoEstado').value = e.estadoSaida || 'Bom';
  $('#devolucaoObs').value = '';
  $('#devolucaoData').value = hojeISO();
  atualizarComparacaoDevolucao();
  abrirModal('#modalDevolucao');
}

function atualizarComparacaoDevolucao() {
  const e = state.emprestimos.find(x => x.id === state.devolucaoEmprestimoId);
  if (!e) return;
  const estadoSel = $('#devolucaoEstado').value;
  const preview = $('#devolucaoEstadoPreview');
  preview.textContent = estadoSel;
  const piorou = e.estadoSaida ? estadoPiorou(e.estadoSaida, estadoSel) : false;
  preview.classList.toggle('piorou', piorou);
  $('#avisoDeterioracao').classList.toggle('show', piorou);
}

async function confirmarDevolucao() {
  const id = state.devolucaoEmprestimoId;
  const dataDevolucao = $('#devolucaoData').value || hojeISO();
  const estadoDevolucao = $('#devolucaoEstado').value;
  const obsDevolucao = $('#devolucaoObs').value.trim();

  try {
    await api(`/api/emprestimos/${id}`, {
      method: 'PUT',
      body: { dataDevolucao, estadoDevolucao, obsDevolucao: obsDevolucao || null }
    });
    fecharModal('#modalDevolucao');
    toast('Devolução registrada com sucesso! Reputação do aluno atualizada.');
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

async function abrirHistorico(id) {
  try {
    const e = await api(`/api/emprestimos/${id}`);
    const piorou = e.estadoSaida && e.estadoDevolucao && estadoPiorou(e.estadoSaida, e.estadoDevolucao);

    const linha = (label, valor) => `
      <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:13px;">
        <span class="muted" style="font-weight:900;">${label}</span>
        <span style="font-weight:800; text-align:right;">${valor}</span>
      </div>`;

    $('#historicoConteudo').innerHTML = `
      ${linha('Aluno', `${escapeHtml(e.alunoNome)} (${escapeHtml(e.alunoTurma)})`)}
      ${linha('Livro', `${escapeHtml(e.livroTitulo)} — ${escapeHtml(e.livroAutor || '')}`)}
      ${linha('Data de retirada', formatarData(e.dataRetirada))}
      ${linha('Prazo limite', formatarData(e.dataLimite))}
      ${linha('Status', e.devolvido ? 'Devolvido' : pillStatus(e))}
      ${e.devolvido ? linha('Data de devolução', formatarData(e.dataDevolucao)) : ''}
      <div style="margin-top:14px;">
        <div style="font-size:12px; font-weight:1000; color:#065f46; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:8px;">📦 Conservação do livro</div>
        <div class="estado-comparacao" style="margin-bottom:0;">
          <div class="estado-box">
            <div class="titulo">Na saída</div>
            <div class="valor">${escapeHtml(e.estadoSaida || '—')}</div>
          </div>
          <div class="estado-seta">➜</div>
          <div class="estado-box">
            <div class="titulo">Na devolução</div>
            <div class="valor ${piorou ? 'piorou' : ''}">${escapeHtml(e.estadoDevolucao || '—')}${piorou ? ' ⚠️' : ''}</div>
          </div>
        </div>
        ${e.obsSaida ? linha('Observação na saída', escapeHtml(e.obsSaida)) : ''}
        ${e.obsDevolucao ? linha('Observação na devolução', escapeHtml(e.obsDevolucao)) : ''}
        ${piorou ? '<div class="aviso-deterioracao show" style="margin-top:10px;">⚠️ O livro foi devolvido em estado pior do que na saída. Penalização aplicada na reputação do aluno.</div>' : ''}
      </div>
    `;
    abrirModal('#modalHistorico');
  } catch (err) {
    toast(err.message, 'erro');
  }
}

async function cancelarEmprestimo(id) {
  const e = state.emprestimos.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`Cancelar o empréstimo de "${e.livroTitulo}" para ${e.alunoNome}?`)) return;
  try {
    await api(`/api/emprestimos/${id}`, { method: 'DELETE' });
    toast('Empréstimo cancelado.');
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

// ============================================================
// NOTIFICAÇÕES (prazos)
// ============================================================

function calcularNotificacoes() {
  const hoje = hojeISO();
  const tresDias = new Date(); tresDias.setDate(tresDias.getDate() + 3);
  const limite3 = tresDias.toISOString().split('T')[0];

  const ativos = state.emprestimos.filter(e => !e.devolvido);
  const vencidos = ativos.filter(e => e.dataLimite && e.dataLimite < hoje);
  const breve = ativos.filter(e => e.dataLimite && e.dataLimite >= hoje && e.dataLimite <= limite3);
  return { vencidos, breve, total: vencidos.length + breve.length };
}

function atualizarBadgeNotificacoes() {
  const { total } = calcularNotificacoes();
  const badge = $('#notifBadge');
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderNotificacoes(filtro = 'todos') {
  const { vencidos, breve } = calcularNotificacoes();
  const lista = filtro === 'vencidos' ? vencidos : filtro === 'breve' ? breve : [...vencidos, ...breve];

  $('#notifTotalCount').textContent = vencidos.length + breve.length;
  $('#notifVencidosCount').textContent = vencidos.length;
  $('#notifBreveCount').textContent = breve.length;

  const container = $('#notifListContainer');
  if (!lista.length) {
    container.innerHTML = '';
    $('#notifEmpty').style.display = 'block';
    return;
  }
  $('#notifEmpty').style.display = 'none';

  container.innerHTML = lista.map(e => {
    const vencido = e.dataLimite < hojeISO();
    return `
      <div class="notif-card ${vencido ? 'overdue' : 'warning'}">
        <div class="notif-card-header">
          <span class="notif-student">${escapeHtml(e.alunoNome)} — ${escapeHtml(e.alunoTurma)}</span>
          <span class="status-pill ${vencido ? 'badge-overdue' : 'badge-warning'}">${vencido ? '⚠️ Vencido' : '⏳ Vence em breve'}</span>
        </div>
        <div class="notif-book">📖 ${escapeHtml(e.livroTitulo)}</div>
        <div class="notif-meta">
          <span>Retirada: ${formatarData(e.dataRetirada)}</span>
          <span>Prazo: ${formatarData(e.dataLimite)}</span>
        </div>
        <div class="notif-actions">
          <button type="button" class="btn-small" data-devolver="${e.id}">📥 Registrar devolução</button>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// RELATÓRIOS
// ============================================================

function periodoRelatorio() {
  const periodo = $('#relatorioPeriodo').value;
  const de = $('#relatorioDe').value;
  const ate = $('#relatorioAte').value;
  return { periodo, de, ate };
}

function filtrarEmprestimosPeriodo({ periodo, de, ate }) {
  const hoje = hojeISO();
  let deCalc = de, ateCalc = ate;
  if (periodo === 'hoje') { deCalc = hoje; ateCalc = hoje; }
  if (periodo === '7d') { const d = new Date(); d.setDate(d.getDate() - 6); deCalc = d.toISOString().split('T')[0]; ateCalc = hoje; }
  if (periodo === '30d') { const d = new Date(); d.setDate(d.getDate() - 29); deCalc = d.toISOString().split('T')[0]; ateCalc = hoje; }
  return state.emprestimos.filter(e => {
    const data = e.dataRetirada;
    if (periodo === 'mes') return data.slice(0, 7) === hoje.slice(0, 7);
    if (periodo === 'ano') return data.slice(0, 4) === hoje.slice(0, 4);
    if (periodo === 'hoje') return data === hoje;
    if (periodo === '7d' || periodo === '30d') {
      if (deCalc && data < deCalc) return false;
      if (ateCalc && data > ateCalc) return false;
      return true;
    }
    if (periodo === 'personalizado') {
      if (de && data < de) return false;
      if (ate && data > ate) return false;
    }
    return true;
  });
}

function gerarRelatorio() {
  const per = periodoRelatorio();
  const emprestimos = filtrarEmprestimosPeriodo(per);

  const devolvidos = emprestimos.filter(e => e.devolvido);
  const ativos = emprestimos.filter(e => !e.devolvido);
  const atrasadosAtivos = ativos.filter(e => e.dataLimite && e.dataLimite < hojeISO());
  const atrasadosDevolvidos = devolvidos.filter(e => e.dataLimite && e.dataDevolucao && e.dataDevolucao > e.dataLimite);
  const noPrazo = devolvidos.filter(e => !e.dataLimite || !e.dataDevolucao || e.dataDevolucao <= e.dataLimite);
  const deterioracoes = devolvidos.filter(e => e.estadoSaida && e.estadoDevolucao && estadoPiorou(e.estadoSaida, e.estadoDevolucao));

  const rotuloPeriodo = per.periodo === 'hoje' ? 'Hoje'
    : per.periodo === '7d' ? 'Últimos 7 dias'
    : per.periodo === '30d' ? 'Últimos 30 dias'
    : per.periodo === 'mes' ? 'Mês atual'
    : per.periodo === 'ano' ? 'Ano atual'
    : per.periodo === 'personalizado' ? `${per.de || 'início'} a ${per.ate || 'hoje'}`
    : 'Geral (todo o histórico)';

  // Movimento detalhado: cada empréstimo do período, mais recente primeiro
  const movimentos = [...emprestimos]
    .sort((a, b) => (b.dataRetirada || '').localeCompare(a.dataRetirada || ''))
    .map(e => ({
      id: e.id,
      aluno: e.alunoNome,
      turma: e.alunoTurma,
      livro: e.livroTitulo,
      retirada: e.dataRetirada,
      limite: e.dataLimite,
      devolvido: !!e.devolvido,
      devolucao: e.dataDevolucao,
      estadoSaida: e.estadoSaida || null,
      estadoDevolucao: e.estadoDevolucao || null,
      obsSaida: e.obsSaida || null,
      obsDevolucao: e.obsDevolucao || null,
      piorou: e.estadoSaida && e.estadoDevolucao && estadoPiorou(e.estadoSaida, e.estadoDevolucao)
    }));

  state.relatorioAtual = {
    geradoEm: new Date().toLocaleString('pt-BR'),
    periodo: rotuloPeriodo,
    kpis: {
      total: emprestimos.length,
      devolvidos: devolvidos.length,
      ativos: ativos.length,
      atrasados: atrasadosAtivos.length + atrasadosDevolvidos.length,
      noPrazo: noPrazo.length,
      deterioracoes: deterioracoes.length
    },
    movimentos
  };

  renderRelatorio();
  toast('Relatório gerado com dados reais do sistema!');
}

function renderRelatorio() {
  const r = state.relatorioAtual;
  if (!r) return;

  const area = $('#reportArea');
  const kpi = (num, lbl) => `<div class="report-kpi"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;

  // Rankings calculados a partir dos movimentos reais do período
  const porLivro = {};
  const porAluno = {};
  const porSala = {};
  r.movimentos.forEach(m => {
    porLivro[m.livro] = (porLivro[m.livro] || 0) + 1;
    porAluno[m.aluno] = (porAluno[m.aluno] || 0) + 1;
    const sala = m.turma || '—';
    porSala[sala] = (porSala[sala] || 0) + 1;
  });
  const topLivros = Object.entries(porLivro).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topAlunos = Object.entries(porAluno).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topSalas = Object.entries(porSala).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const listaRanking = (titulo, emoji, itens, unidade) => itens.length ? `
    <div class="report-section">
      <h4>${emoji} ${titulo}</h4>
      <ol class="report-list">
        ${itens.map(([nome, qtd]) => `<li><strong>${escapeHtml(nome)}</strong> — ${qtd} ${unidade}</li>`).join('')}
      </ol>
    </div>` : '';

  const celulaConservacao = (m) => {
    if (!m.estadoSaida && !m.estadoDevolucao) return '<span class="muted">—</span>';
    const saida = m.estadoSaida ? `<span class="cons-saida">${escapeHtml(m.estadoSaida)}</span>` : '<span class="muted">?</span>';
    if (!m.devolvido) return `${saida} <span class="muted">→ (em posse)</span>`;
    if (!m.estadoDevolucao) return `${saida} → <span class="muted">não registrado</span>`;
    const classe = m.piorou ? 'piorou' : 'ok';
    const aviso = m.piorou ? ' ⚠️' : '';
    return `${saida} → <span class="cons-dev ${classe}">${escapeHtml(m.estadoDevolucao)}${aviso}</span>`;
  };

  const statusMovimento = (m) => {
    if (!m.devolvido) {
      if (m.limite && m.limite < hojeISO()) return '<span class="status-pill badge-overdue">⚠️ Em atraso</span>';
      return '<span class="status-pill badge-ok">Em posse</span>';
    }
    if (m.limite && m.devolucao && m.devolucao > m.limite) return '<span class="status-pill badge-returned">Devolvido (atrasado)</span>';
    return '<span class="status-pill badge-ok">Devolvido no prazo</span>';
  };

  area.innerHTML = `
    <h3>📊 Relatório de Empréstimos</h3>
    <div class="report-meta">
      <span class="chip">Período: ${escapeHtml(r.periodo)}</span>
      <span class="chip">Gerado em ${escapeHtml(r.geradoEm)}</span>
      <span class="chip">${r.movimentos.length} movimento(s)</span>
    </div>

    <div class="report-section">
      <h4>Resumo do período</h4>
      <div class="report-kpis">
        ${kpi(r.kpis.total, 'Empréstimos')}
        ${kpi(r.kpis.devolvidos, 'Devolvidos')}
        ${kpi(r.kpis.ativos, 'Em posse')}
        ${kpi(r.kpis.atrasados, 'Com atraso')}
        ${kpi(r.kpis.noPrazo, 'No prazo')}
        ${kpi(r.kpis.deterioracoes, 'Livros deteriorados')}
      </div>
    </div>

    ${listaRanking('Livros mais emprestados', '📈', topLivros, 'empréstimo(s)')}
    ${listaRanking('Alunos que mais pegaram livros', '👨', topAlunos, 'empréstimo(s)')}
    ${listaRanking('Salas que mais pegaram livros', '🏫', topSalas, 'empréstimo(s)')}

    <div class="report-section">
      <h4>Movimento de empréstimos (quem pegou, quando e como estava o livro)</h4>
      ${r.movimentos.length ? `
      <table class="report-table">
        <thead>
          <tr>
            <th>Aluno</th>
            <th>Turma</th>
            <th>Livro</th>
            <th>Pegou em</th>
            <th>Prazo</th>
            <th>Devolvido em</th>
            <th>Estado do livro (saída → devolução)</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          ${r.movimentos.map(m => `
          <tr>
            <td>${escapeHtml(m.aluno)}</td>
            <td>${escapeHtml(m.turma)}</td>
            <td>${escapeHtml(m.livro)}</td>
            <td>${formatarData(m.retirada)}</td>
            <td>${formatarData(m.limite)}</td>
            <td>${m.devolvido ? formatarData(m.devolucao) : '—'}</td>
            <td>${celulaConservacao(m)}${m.obsDevolucao ? `<br/><small class="muted">Obs.: ${escapeHtml(m.obsDevolucao)}</small>` : ''}</td>
            <td>${statusMovimento(m)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty">Nenhum empréstimo registrado neste período.</div>'}
    </div>
  `;
}

function imprimirRelatorio() {
  if (!state.relatorioAtual) { toast('Gere um relatório antes de imprimir.', 'aviso'); return; }
  window.print();
}

function exportarRelatorioCSV() {
  const r = state.relatorioAtual;
  if (!r) { toast('Gere um relatório antes de exportar.', 'aviso'); return; }

  const linhas = [
    ['Relatório de Empréstimos da Biblioteca'],
    ['Período', r.periodo],
    ['Gerado em', r.geradoEm],
    [],
    ['Resumo do período'],
    ['Empréstimos', r.kpis.total],
    ['Devolvidos', r.kpis.devolvidos],
    ['Em posse', r.kpis.ativos],
    ['Com atraso', r.kpis.atrasados],
    ['Devoluções no prazo', r.kpis.noPrazo],
    ['Livros deteriorados', r.kpis.deterioracoes],
    [],
    ['Movimento de empréstimos'],
    ['Aluno', 'Turma', 'Livro', 'Pegou em', 'Prazo', 'Devolvido em', 'Estado na saída', 'Estado na devolução', 'Observação devolução', 'Situação'],
    ...r.movimentos.map(m => [
      m.aluno, m.turma, m.livro, m.retirada, m.limite || '',
      m.devolvido ? m.devolucao : '',
      m.estadoSaida || '', m.estadoDevolucao || '', m.obsDevolucao || '',
      m.devolvido ? (m.limite && m.devolucao > m.limite ? 'Devolvido (atrasado)' : 'Devolvido no prazo') : 'Em posse'
    ])
  ];

  baixarCSV('relatorio-emprestimos.csv', linhas);
}

// ---------------- Relatórios salvos ----------------

async function salvarRelatorioAtual() {
  const r = state.relatorioAtual;
  if (!r) { toast('Gere um relatório antes de salvar.', 'aviso'); return; }

  const conteudo = JSON.stringify({
    periodo: r.periodo,
    geradoEm: r.geradoEm,
    kpis: r.kpis,
    movimentos: r.movimentos
  });

  try {
    await api('/api/relatorios', { method: 'POST', body: { mensagem: conteudo } });
    toast('Relatório salvo com sucesso!');
    await carregarRelatoriosSalvos();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

async function carregarRelatoriosSalvos() {
  try {
    const salvos = await api('/api/relatorios');
    const lista = $('#savedReportsList');
    const vazio = $('#savedReportsEmpty');

    if (!salvos.length) {
      lista.innerHTML = '';
      vazio.style.display = 'block';
      return;
    }
    vazio.style.display = 'none';

    lista.innerHTML = salvos.map(s => {
      let titulo = 'Relatório';
      let data = s.criado_em;
      try {
        const dados = JSON.parse(s.mensagem);
        if (dados.periodo) titulo = `Relatório — ${dados.periodo}`;
        if (dados.geradoEm) data = dados.geradoEm;
      } catch (e) {
        titulo = String(s.mensagem).slice(0, 60);
      }
      return `
        <div class="saved-report-item">
          <div class="sr-info">
            <div class="sr-title">📄 ${escapeHtml(titulo)}</div>
            <div class="sr-date">${escapeHtml(String(data))}</div>
          </div>
          <div style="display:flex; gap:6px;">
            <button type="button" class="secondary btn-small" data-ver-relatorio="${s.id}">👁️ Ver</button>
            <button type="button" class="danger btn-small" data-apagar-relatorio="${s.id}">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar relatórios salvos:', err);
  }
}

function verRelatorioSalvo(id) {
  api('/api/relatorios').then(salvos => {
    const s = salvos.find(x => String(x.id) === String(id));
    if (!s) { toast('Relatório não encontrado.', 'erro'); return; }
    try {
      const dados = JSON.parse(s.mensagem);
      state.relatorioAtual = {
        geradoEm: dados.geradoEm || s.criado_em,
        periodo: dados.periodo || 'Salvo',
        kpis: dados.kpis || { total: 0, devolvidos: 0, ativos: 0, atrasados: 0, noPrazo: 0, deterioracoes: 0 },
        movimentos: dados.movimentos || []
      };
      renderRelatorio();
      $('#reportArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('Relatório salvo carregado. Use Imprimir ou Exportar CSV se quiser.');
    } catch (e) {
      toast('Relatório salvo em formato antigo/inválido.', 'aviso');
    }
  }).catch(err => toast(err.message, 'erro'));
}

async function apagarRelatorioSalvo(id) {
  if (!confirm('Apagar este relatório salvo?')) return;
  try {
    await api(`/api/relatorios/${id}`, { method: 'DELETE' });
    toast('Relatório apagado.');
    await carregarRelatoriosSalvos();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

async function apagarRelatoriosSalvos() {
  if (!confirm('Apagar TODOS os relatórios salvos no sistema?')) return;
  try {
    await api('/api/relatorios', { method: 'DELETE' });
    toast('Todos os relatórios salvos foram apagados.');
    await carregarRelatoriosSalvos();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function renderHistoricoAtividades() {
  // Histórico real derivado dos empréstimos (registro e devolução)
  const eventos = [];
  for (const e of state.emprestimos) {
    eventos.push({
      data: e.dataRetirada,
      tipo: '📤 Empréstimo',
      aluno: `${e.alunoNome} (${e.alunoTurma})`,
      livro: e.livroTitulo
    });
    if (e.devolvido) {
      const piorou = e.estadoSaida && e.estadoDevolucao && estadoPiorou(e.estadoSaida, e.estadoDevolucao);
      eventos.push({
        data: e.dataDevolucao,
        tipo: piorou ? '📥 Devolução ⚠️' : '📥 Devolução',
        aluno: `${e.alunoNome} (${e.alunoTurma})`,
        livro: e.livroTitulo
      });
    }
  }
  eventos.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const tbody = $('#relatoriosBody');
  if (!eventos.length) {
    tbody.innerHTML = '';
    $('#relatoriosEmpty').style.display = 'block';
    return;
  }
  $('#relatoriosEmpty').style.display = 'none';
  tbody.innerHTML = eventos.slice(0, 100).map(ev => `
    <tr>
      <td>${formatarData(ev.data)}</td>
      <td>${ev.tipo}</td>
      <td>${escapeHtml(ev.aluno)}</td>
      <td>${escapeHtml(ev.livro)}</td>
    </tr>
  `).join('');
}

// ---------------- Backup ----------------

async function baixarBackup() {
  try {
    const data = await api('/api/backup');
    baixarJSON(`biblioteca-backup-${hojeISO()}.json`, data);
    toast('Backup baixado com sucesso!');
  } catch (err) {
    toast(err.message, 'erro');
  }
}

async function importarBackup() {
  const texto = $('#importarDados').value.trim();
  if (!texto) { toast('Cole o JSON do backup primeiro.', 'aviso'); return; }
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch (e) {
    toast('JSON inválido. Verifique o conteúdo colado.', 'erro');
    return;
  }
  if (!confirm('Importar os dados do backup? Registros duplicados serão ignorados.')) return;
  try {
    const r = await api('/api/backup', { method: 'POST', body: dados });
    toast(`Importação concluída: ${r.inseridos.alunos} aluno(s), ${r.inseridos.livros} livro(s), ${r.inseridos.emprestimos} empréstimo(s).`);
    $('#importarDados').value = '';
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

async function abrirModalReset() {
  // Contagens reais para o modal
  try {
    const d = await api('/api/dashboard');
    $('#resetStatusCounts').textContent = `${d.alunosTotal} aluno(s) • ${d.livrosTitulos} livro(s) • ${d.emprestimosAtivos} empréstimo(s) ativo(s)`;
  } catch (e) {
    $('#resetStatusCounts').textContent = '';
  }
  abrirModal('#modalConfirmarReset');
}

async function resetarTudo(comBackup) {
  if (comBackup) {
    try {
      const data = await api('/api/backup');
      baixarJSON(`biblioteca-backup-${hojeISO()}.json`, data);
    } catch (err) {
      if (!confirm('Falha ao gerar o backup. Apagar mesmo assim?')) return;
    }
  }
  try {
    await api('/api/backup', { method: 'DELETE' });
    fecharModal('#modalConfirmarReset');
    toast('Todos os dados foram apagados.');
    await recarregarTudo();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

// ============================================================
// RANKING
// ============================================================

function periodoRanking() {
  const periodo = $('#rankingPeriodo').value;
  const de = $('#rankingDe').value;
  const ate = $('#rankingAte').value;
  return { periodo, de, ate };
}

async function carregarRanking() {
  const per = periodoRanking();
  const qs = new URLSearchParams();
  qs.set('periodo', per.periodo);
  if (per.periodo === 'personalizado') {
    if (per.de) qs.set('de', per.de);
    if (per.ate) qs.set('ate', per.ate);
  }

  try {
    const [alunos, salas] = await Promise.all([
      api(`/api/ranking/alunos?${qs}`),
      api(`/api/ranking/salas?${qs}`)
    ]);
    renderRankingAlunos(alunos);
    renderRankingSalas(salas);
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function posBadge(pos) {
  const classe = pos === 1 ? 'p1' : pos === 2 ? 'p2' : pos === 3 ? 'p3' : '';
  return `<span class="pos-badge ${classe}">${pos}º</span>`;
}

function renderRankingAlunos(data) {
  const leitores = data.leitores || [];
  const reputacao = data.reputacao || [];

  const linhaAluno = (a) => `
    <tr>
      <td>${posBadge(a.posicao)}</td>
      <td>${escapeHtml(a.nome)}</td>
      <td><span class="pill">${escapeHtml(a.turma)}</span></td>
      <td>${a.totalEmprestimos}</td>
      <td>${a.devolvidos}</td>
      <td>${a.atrasos > 0 ? `<strong style="color: var(--danger);">${a.atrasos}</strong>` : '0'}</td>
      <td>${renderEstrelas(a.nota, a.estrelas)}</td>
    </tr>`;

  $('#rankingLeitoresBody').innerHTML = leitores.map(linhaAluno).join('');
  $('#rankingLeitoresEmpty').style.display = leitores.length ? 'none' : 'block';

  $('#rankingReputacaoBody').innerHTML = reputacao.map(linhaAluno).join('');
  $('#rankingReputacaoEmpty').style.display = reputacao.length ? 'none' : 'block';
}

function renderRankingSalas(data) {
  const salas = data.salas || [];
  $('#rankingSalasBody').innerHTML = salas.map(s => `
    <tr>
      <td>${posBadge(s.posicao)}</td>
      <td><strong>${escapeHtml(s.turma)}</strong></td>
      <td>${s.totalEmprestimos} empréstimo(s)</td>
      <td>${s.alunosParticipantes} aluno(s)</td>
      <td>${s.devolvidosNoPrazo}</td>
    </tr>
  `).join('');
  $('#rankingSalasEmpty').style.display = salas.length ? 'none' : 'block';
}

// ============================================================
// TEMA / PERSONALIZAÇÃO
// ============================================================

const LS_TEMA = 'biblioteca_tema_v1';

const PALETAS = [
  { nome: 'Verde Esmeralda', primary: '#22C55E', dark: '#15803D' },
  { nome: 'Azul Oceano', primary: '#3B82F6', dark: '#1D4ED8' },
  { nome: 'Roxo Real', primary: '#8B5CF6', dark: '#6D28D9' },
  { nome: 'Rosa Vibrante', primary: '#EC4899', dark: '#BE185D' },
  { nome: 'Laranja Solar', primary: '#F97316', dark: '#C2410C' },
  { nome: 'Vermelho Rubi', primary: '#EF4444', dark: '#B91C1C' },
  { nome: 'Ciano Tropical', primary: '#06B6D4', dark: '#0E7490' },
  { nome: 'Índigo Noturno', primary: '#6366F1', dark: '#4338CA' }
];

const WALLPAPERS = [
  { nome: 'Nenhum', css: null },
  { nome: 'Gradiente Verde', css: 'linear-gradient(135deg, #d1fae5, #a7f3d0, #6ee7b7)' },
  { nome: 'Gradiente Azul', css: 'linear-gradient(135deg, #dbeafe, #bfdbfe, #93c5fd)' },
  { nome: 'Gradiente Rosé', css: 'linear-gradient(135deg, #fce7f3, #fbcfe8, #f9a8d4)' },
  { nome: 'Gradiente Âmbar', css: 'linear-gradient(135deg, #fef3c7, #fde68a, #fcd34d)' },
  { nome: 'Biblioteca Clássica', css: 'linear-gradient(180deg, #fef3c7 0%, #fde68a 50%, #d97706 100%)' }
];

function aplicarTema(tema) {
  const root = document.documentElement;
  if (tema.primary) {
    root.style.setProperty('--primary', tema.primary);
    root.style.setProperty('--primary-dark', tema.dark || tema.primary);
  }
  if (tema.bg) root.style.setProperty('--bg', tema.bg);
  if (tema.card) root.style.setProperty('--card', tema.card);

  if (tema.wallpaper) {
    document.body.classList.add('has-custom-bg');
    root.style.setProperty('--custom-bg-img', tema.wallpaper);
    root.style.setProperty('--custom-overlay', `rgba(248, 250, 252, ${(tema.opacity ?? 85) / 100})`);
    root.style.setProperty('--custom-blur', `${tema.blur ?? 0}px`);
  } else {
    document.body.classList.remove('has-custom-bg');
    root.style.setProperty('--custom-bg-img', 'none');
  }

  if (tema.libraryName) {
    const brand = document.querySelector('.sidebar .brand .title span');
    if (brand) brand.textContent = tema.libraryName;
    $('#subtitleText').textContent = tema.libraryName;
  }
  if (tema.librarianName) {
    $('#helloText').textContent = `Olá, ${tema.librarianName} 👋`;
    document.querySelector('.avatar .name').textContent = tema.librarianName;
  }
}

function carregarTema() {
  try {
    const raw = localStorage.getItem(LS_TEMA);
    if (raw) aplicarTema(JSON.parse(raw));
  } catch (e) {}
}

function salvarTema() {
  const tema = {
    primary: $('#themeColorPrimary').value,
    dark: escurecerCor($('#themeColorPrimary').value, 30),
    bg: $('#themeColorBg').value,
    card: $('#themeColorCard').value,
    wallpaper: window.__temaWallpaper || null,
    opacity: parseInt($('#themeBgOpacity').value, 10) || 85,
    blur: parseInt($('#themeBgBlur').value, 10) || 0,
    libraryName: $('#themeLibraryName').value.trim(),
    librarianName: $('#themeLibrarianName').value.trim()
  };
  localStorage.setItem(LS_TEMA, JSON.stringify(tema));
  aplicarTema(tema);
  fecharModal('#modalPersonalizacao');
  toast('Personalização salva!');
}

function escurecerCor(hex, porcento) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - porcento / 100)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - porcento / 100)));
  const b = Math.max(0, Math.round((n & 255) * (1 - porcento / 100)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function renderPaletas() {
  const container = $('#themePalettesContainer');
  container.innerHTML = PALETAS.map((p, i) => `
    <div class="theme-palette-card" data-palette="${i}">
      <div class="theme-palette-dots">
        <span class="theme-palette-dot" style="background:${p.primary};"></span>
        <span class="theme-palette-dot" style="background:${p.dark};"></span>
      </div>
      <div class="theme-palette-name">${escapeHtml(p.nome)}</div>
    </div>
  `).join('');

  container.addEventListener('click', (e) => {
    const card = e.target.closest('[data-palette]');
    if (!card) return;
    const p = PALETAS[parseInt(card.getAttribute('data-palette'), 10)];
    $('#themeColorPrimary').value = p.primary;
    $('#themeColorPrimaryHex').textContent = p.primary;
    $$('.theme-palette-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
  });
}

function renderWallpapers() {
  const container = $('#themeWallpapersContainer');
  container.innerHTML = WALLPAPERS.map((w, i) => `
    <div class="theme-wallpaper-card" data-wallpaper="${i}">
      <div class="theme-wallpaper-thumb" style="${w.css ? `background:${w.css};` : 'background:#f1f5f9;'}"></div>
      <div class="theme-palette-name">${escapeHtml(w.nome)}</div>
    </div>
  `).join('');

  container.addEventListener('click', (e) => {
    const card = e.target.closest('[data-wallpaper]');
    if (!card) return;
    const w = WALLPAPERS[parseInt(card.getAttribute('data-wallpaper'), 10)];
    window.__temaWallpaper = w.css || null;
    $('#themeBgControlsContainer').style.display = w.css ? 'block' : 'none';
    $$('.theme-wallpaper-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
  });
}

function abrirPersonalizacao() {
  // Preenche campos com valores atuais
  const root = document.documentElement;
  $('#themeColorPrimary').value = rgbParaHex(getComputedStyle(root).getPropertyValue('--primary').trim()) || '#22C55E';
  $('#themeColorPrimaryHex').textContent = $('#themeColorPrimary').value;
  $('#themeColorBg').value = rgbParaHex(getComputedStyle(root).getPropertyValue('--bg').trim()) || '#F8FAFC';
  $('#themeColorBgHex').textContent = $('#themeColorBg').value;
  $('#themeColorCard').value = rgbParaHex(getComputedStyle(root).getPropertyValue('--card').trim()) || '#FFFFFF';
  $('#themeColorCardHex').textContent = $('#themeColorCard').value;
  abrirModal('#modalPersonalizacao');
}

function rgbParaHex(cor) {
  if (!cor) return null;
  if (cor.startsWith('#')) return cor;
  const m = cor.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function restaurarTemaPadrao() {
  fecharModal('#modalPersonalizacao');
  abrirModal('#modalConfirmarResetTema');
}

function confirmarRestauracaoTema() {
  localStorage.removeItem(LS_TEMA);
  window.location.reload();
}

// ============================================================
// EVENTOS / INIT
// ============================================================

function bindEventos() {
  // ----- Alunos -----
  $('#alunoForm').addEventListener('submit', cadastrarAluno);
  $('#alunoBusca').addEventListener('input', (e) => { state.buscaAluno = e.target.value; renderAlunos(); });
  $('#alunoLimparBusca').addEventListener('click', () => { $('#alunoBusca').value = ''; state.buscaAluno = ''; renderAlunos(); });
  $('#alunoExportar').addEventListener('click', exportarAlunos);
  $('#salvarEdicaoAlunoBtn').addEventListener('click', salvarEdicaoAluno);
  $('#btnAbrirModalDed').addEventListener('click', () => abrirModal('#modalImportarDed'));
  $('#btnDedProcessar').addEventListener('click', processarDed);
  $('#btnDedLimpar').addEventListener('click', () => {
    $('#dedTextoInput').value = '';
    $('#dedPreviewContainer').style.display = 'none';
    $('#btnDedConfirmarImportacao').disabled = true;
  });
  $('#btnDedConfirmarImportacao').addEventListener('click', confirmarImportacaoDed);
  $('#dedArquivoInput').addEventListener('change', (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const reader = new FileReader();
    reader.onload = () => { $('#dedTextoInput').value = reader.result; };
    reader.readAsText(arquivo, 'utf-8');
  });

  // Ações da tabela de alunos (delegação)
  $('#alunosBody').addEventListener('click', (e) => {
    const btnEditar = e.target.closest('[data-editar-aluno]');
    const btnExcluir = e.target.closest('[data-excluir-aluno]');
    if (btnEditar) abrirEditarAluno(Number(btnEditar.getAttribute('data-editar-aluno')));
    if (btnExcluir) excluirAluno(Number(btnExcluir.getAttribute('data-excluir-aluno')));
  });

  // ----- Livros -----
  $('#livroForm').addEventListener('submit', cadastrarLivro);
  $('#livroCapa').addEventListener('input', atualizarPreviewCapa);
  $('#livroBusca').addEventListener('input', (e) => { state.buscaLivro = e.target.value; renderLivros(); });
  $('#livroLimparBusca').addEventListener('click', () => { $('#livroBusca').value = ''; state.buscaLivro = ''; renderLivros(); });
  $('#livroOrdenacao').addEventListener('change', (e) => { state.ordemLivros = e.target.value; renderLivros(); });
  $('#livroExportar').addEventListener('click', exportarLivros);
  $('#salvarEdicaoLivroBtn').addEventListener('click', salvarEdicaoLivro);
  $('#btnAbrirScannerLivro').addEventListener('click', () => abrirScanner('livro'));

  $('#livrosBody').addEventListener('click', (e) => {
    const btnEtiqueta = e.target.closest('[data-etiqueta-livro]');
    const btnEditar = e.target.closest('[data-editar-livro]');
    const btnExcluir = e.target.closest('[data-excluir-livro]');
    if (btnEtiqueta) abrirEtiqueta(Number(btnEtiqueta.getAttribute('data-etiqueta-livro')));
    if (btnEditar) abrirEditarLivro(Number(btnEditar.getAttribute('data-editar-livro')));
    if (btnExcluir) excluirLivro(Number(btnExcluir.getAttribute('data-excluir-livro')));
  });

  // ----- Estante -----
  $('#shelfGroupBy').addEventListener('change', (e) => { state.shelf.groupBy = e.target.value; renderEstante(); });
  $('#shelfSortBy').addEventListener('change', (e) => { state.shelf.sortBy = e.target.value; renderEstante(); });
  $('#shelfFilterCategory').addEventListener('change', (e) => { state.shelf.categoria = e.target.value; renderEstante(); });
  $('#shelfFilterGenre').addEventListener('change', (e) => { state.shelf.genero = e.target.value; renderEstante(); });
  $('#shelfFilterClassificacao').addEventListener('change', (e) => { state.shelf.classificacao = e.target.value; renderEstante(); });
  $('#shelfFilterLocation').addEventListener('change', (e) => { state.shelf.localizacao = e.target.value; renderEstante(); });
  $('#shelfFilterStatus').addEventListener('change', (e) => { state.shelf.status = e.target.value; renderEstante(); });
  $('#shelfSearchInput').addEventListener('input', (e) => { state.shelf.busca = e.target.value; renderEstante(); });
  $('#btnViewSpines').addEventListener('click', () => {
    state.shelfView = 'spines';
    $('#btnViewSpines').classList.add('active');
    $('#btnViewGrid').classList.remove('active');
    renderEstante();
  });
  $('#btnViewGrid').addEventListener('click', () => {
    state.shelfView = 'grid';
    $('#btnViewGrid').classList.add('active');
    $('#btnViewSpines').classList.remove('active');
    renderEstante();
  });
  $('#shelfContainer').addEventListener('click', (e) => {
    const localizar = e.target.closest('[data-localizar-livro]');
    const editar = e.target.closest('[data-editar-livro]');
    const card = e.target.closest('[data-detalhes-livro]');

    if (localizar) {
      abrirLocalizarLivro(Number(localizar.getAttribute('data-localizar-livro')));
      return;
    }

    if (editar) {
      abrirEditarLivro(Number(editar.getAttribute('data-editar-livro')));
      return;
    }

    if (card) abrirDetalhesLivro(Number(card.getAttribute('data-detalhes-livro')));
  });
  $('#detalhesLivroAcoes').addEventListener('click', (e) => {
    const btnEtiqueta = e.target.closest('[data-etiqueta-livro]');
    const btnEditar = e.target.closest('[data-editar-livro]');
    const btnEmprestar = e.target.closest('[data-ir-emprestar]');
    const btnLocalizar = e.target.closest('[data-localizar-livro]');
    if (btnEtiqueta) abrirEtiqueta(Number(btnEtiqueta.getAttribute('data-etiqueta-livro')));
    if (btnEditar) abrirEditarLivro(Number(btnEditar.getAttribute('data-editar-livro')));
    if (btnEmprestar) irEmprestar(Number(btnEmprestar.getAttribute('data-ir-emprestar')));
    if (btnLocalizar) abrirLocalizarLivro(Number(btnLocalizar.getAttribute('data-localizar-livro')));
  });

  // ----- Modal Localizar Livro -----
  $('#localizarEditarBtn').addEventListener('click', () => {
    fecharModal('#modalLocalizarLivro');
    if (state.localizarLivroId) abrirEditarLivro(state.localizarLivroId);
  });

  // ----- Empréstimos -----
  $('#emprestarBtn').addEventListener('click', registrarEmprestimo);
  $('#emprestimoAluno').addEventListener('change', atualizarSituacaoEmprestimo);
  $('#btnAbrirScannerEmprestimo').addEventListener('click', () => abrirScanner('emprestimo'));
  $('#emprestimoBusca').addEventListener('input', (e) => { state.buscaEmprestimo = e.target.value; renderEmprestimos(); });
  $('#emprestimoLimparBusca').addEventListener('click', () => { $('#emprestimoBusca').value = ''; state.buscaEmprestimo = ''; renderEmprestimos(); });

  $$('.emp-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.emp-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filtroEmprestimos = btn.getAttribute('data-emp-filter');
      renderEmprestimos();
    });
  });

  $('#emprestimosBody').addEventListener('click', (e) => {
    const btnDevolver = e.target.closest('[data-devolver]');
    const btnHistorico = e.target.closest('[data-historico]');
    const btnCancelar = e.target.closest('[data-cancelar-emprestimo]');
    if (btnDevolver) abrirDevolucao(Number(btnDevolver.getAttribute('data-devolver')));
    if (btnHistorico) abrirHistorico(Number(btnHistorico.getAttribute('data-historico')));
    if (btnCancelar) cancelarEmprestimo(Number(btnCancelar.getAttribute('data-cancelar-emprestimo')));
  });

  $('#devolucaoEstado').addEventListener('change', atualizarComparacaoDevolucao);
  $('#confirmarDevolucaoBtn').addEventListener('click', confirmarDevolucao);

  // ----- Notificações -----
  $('#notifBellBtn').addEventListener('click', () => { renderNotificacoes('todos'); abrirModal('#modalNotificacoes'); });
  $('#btnVerNotificacoesBanner').addEventListener('click', () => { renderNotificacoes('vencidos'); abrirModal('#modalNotificacoes'); });
  $$('.notif-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.notif-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderNotificacoes(btn.getAttribute('data-filter'));
    });
  });
  // Devolver a partir da notificação
  $('#notifListContainer').addEventListener('click', (e) => {
    const btnDevolver = e.target.closest('[data-devolver]');
    if (btnDevolver) {
      fecharModal('#modalNotificacoes');
      abrirDevolucao(Number(btnDevolver.getAttribute('data-devolver')));
    }
  });

  // ----- Relatórios -----
  $('#relatorioPeriodo').addEventListener('change', (e) => {
    const personalizado = e.target.value === 'personalizado';
    $('#relatorioDeField').style.display = personalizado ? 'block' : 'none';
    $('#relatorioAteField').style.display = personalizado ? 'block' : 'none';
  });
  $('#gerarRelatorioBtn').addEventListener('click', gerarRelatorio);
  $('#exportarPdfBtn').addEventListener('click', imprimirRelatorio);
  $('#exportarCsvBtn').addEventListener('click', exportarRelatorioCSV);
  $('#limparRelatoriosBtn').addEventListener('click', apagarRelatoriosSalvos);
  $('#salvarRelatorioBtn').addEventListener('click', salvarRelatorioAtual);
  $('#recarregarSalvosBtn').addEventListener('click', carregarRelatoriosSalvos);
  $('#savedReportsList').addEventListener('click', (e) => {
    const btnVer = e.target.closest('[data-ver-relatorio]');
    const btnApagar = e.target.closest('[data-apagar-relatorio]');
    if (btnVer) verRelatorioSalvo(btnVer.getAttribute('data-ver-relatorio'));
    if (btnApagar) apagarRelatorioSalvo(btnApagar.getAttribute('data-apagar-relatorio'));
  });

  // ----- Backup -----
  $('#downloadBackupBtn').addEventListener('click', baixarBackup);
  $('#importarBtn').addEventListener('click', importarBackup);
  $('#resetBtn').addEventListener('click', abrirModalReset);
  $('#btnResetSemBackup').addEventListener('click', () => resetarTudo(false));
  $('#btnResetComBackup').addEventListener('click', () => resetarTudo(true));

  // ----- Ranking -----
  $('#rankingPeriodo').addEventListener('change', (e) => {
    const personalizado = e.target.value === 'personalizado';
    $('#rankingDeField').style.display = personalizado ? 'block' : 'none';
    $('#rankingAteField').style.display = personalizado ? 'block' : 'none';
  });
  $('#rankingAtualizarBtn').addEventListener('click', carregarRanking);
  $$('.ranking-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.ranking-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.rankingTab = btn.getAttribute('data-ranking-tab');
      $('#rankingAlunosContainer').style.display = state.rankingTab === 'alunos' ? 'block' : 'none';
      $('#rankingSalasContainer').style.display = state.rankingTab === 'salas' ? 'block' : 'none';
    });
  });

  // ----- Scanner -----
  $('#btnFecharScanner').addEventListener('click', fecharScanner);
  $('#btnCancelarScanner').addEventListener('click', fecharScanner);
  $('#scannerManualBuscarBtn').addEventListener('click', buscarManualScanner);
  $('#scannerManualInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); buscarManualScanner(); }
  });

  // ----- Etiqueta -----
  $('#btnImprimirEtiqueta').addEventListener('click', () => window.print());

  // ----- Tema -----
  $('#btnPersonalizarTema').addEventListener('click', abrirPersonalizacao);
  $('#navPersonalizarTema').addEventListener('click', (e) => { e.preventDefault(); abrirPersonalizacao(); });
  $('#btnSalvarTema').addEventListener('click', salvarTema);
  $('#btnRestaurarTemaPadrao').addEventListener('click', restaurarTemaPadrao);
  $('#btnConfirmarRestauracaoTema').addEventListener('click', confirmarRestauracaoTema);
  $('#themeColorPrimary').addEventListener('input', (e) => { $('#themeColorPrimaryHex').textContent = e.target.value; });
  $('#themeColorBg').addEventListener('input', (e) => { $('#themeColorBgHex').textContent = e.target.value; });
  $('#themeColorCard').addEventListener('input', (e) => { $('#themeColorCardHex').textContent = e.target.value; });
  $('#themeBgOpacity').addEventListener('input', (e) => { $('#themeBgOpacityVal').textContent = `${e.target.value}%`; });
  $('#themeBgBlur').addEventListener('input', (e) => { $('#themeBgBlurVal').textContent = `${e.target.value}px`; });
  $('#themeWallpaperFileInput').addEventListener('change', (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const reader = new FileReader();
    reader.onload = () => {
      window.__temaWallpaper = `url(${reader.result})`;
      $('#themeBgControlsContainer').style.display = 'block';
      toast('Imagem carregada! Clique em Salvar para aplicar.');
    };
    reader.readAsDataURL(arquivo);
  });
  $('#btnRemoverFundo').addEventListener('click', () => {
    window.__temaWallpaper = null;
    $('#themeBgControlsContainer').style.display = 'none';
    $$('.theme-wallpaper-card').forEach(c => c.classList.remove('active'));
  });

  // ----- Logout -----
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    localStorage.removeItem('biblioteca_auth_v1');
    window.location.href = './login.html';
  });

  // Exibe nome do usuário logado (via sessão real)
  (async function(){
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.user && data.user.username) {
          const avatar = document.querySelector('.avatar .name');
          if (avatar) avatar.textContent = data.user.username;
          const hello = $('#helloText');
          if (hello) hello.textContent = `Olá, ${data.user.username} 👋`;
        }
      }
    } catch (e) {}
  })();

  // ----- Sidebar mobile -----
  $('#sidebarToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
  });

  // ----- Atualização ao trocar de seção -----
  document.addEventListener('section:change', (e) => {
    const { section } = e.detail;
    if (section === 'dashboard') {
      carregarDashboard().then(renderDashboard);
    } else if (section === 'ranking') {
      carregarRanking();
    } else if (section === 'estante') {
      renderEstante();
    }
  });
}

async function init() {
  window.__initPasso = 'inicio';
  try {
    carregarTema();
    renderPaletas();
    renderWallpapers();
    bindEventos();
    $('#emprestimoData').value = hojeISO();
    window.__initPasso = 'setup-ok';
  } catch (e) {
    console.error('[init] falha no setup inicial:', e);
    window.__initPasso = 'setup-erro: ' + e.message;
  }

  await carregarTurmas();
  window.__initPasso = 'turmas-ok';
  await recarregarTudo();
  window.__initPasso = 'recarregar-ok';

  // Dropdowns pesquisáveis de aluno e livro (após os selects estarem populados).
  // criarCombobox é auto-reparável: se já houver API, retorna a existente.
  try {
    const selAlunoEmp = $('#emprestimoAluno');
    const selLivroEmp = $('#emprestimoLivro');
    if (selAlunoEmp) criarCombobox(selAlunoEmp, { placeholder: 'Selecione o aluno...' });
    if (selLivroEmp) criarCombobox(selLivroEmp, { placeholder: 'Selecione o livro...' });
    window.__initPasso = 'combobox-ok';
  } catch (e) {
    console.error('[init] falha ao criar comboboxes:', e);
    window.__initPasso = 'combobox-erro: ' + e.message;
  }

  await carregarRelatoriosSalvos();
}

init().catch(err => {
  console.error('Erro na inicialização:', err);
  toast('Erro ao carregar o sistema. Verifique se o servidor está rodando.', 'erro');
});
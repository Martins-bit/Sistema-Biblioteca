// public/assets/js/combobox.js
// Componente de dropdown pesquisável (combobox) reutilizável.
// Substitui <select> gigantes por um campo com busca, scroll e estado acessível.

/**
 * cria um combobox pesquisável a partir de um <select> existente.
 * mantém o <select> original no DOM (escondido) como fonte da verdade,
 * para que todo o código existente que lê `.value` continue funcionando.
 *
 * @param {HTMLSelectElement} selectEl
 * @param {{placeholder?: string, emptyText?: string, required?: boolean}} opts
 */
export function criarCombobox(selectEl, opts = {}) {
  if (!selectEl) return null;
  // Já inicializado e íntegro: retorna a API existente
  if (selectEl.__combobox) return selectEl.__combobox;

  // Estado órfão (dataset presente sem API anexada, ex. após clone/re-render):
  // remove vestígios anteriores e reinicializa do zero.
  const wrapOrfao = selectEl.closest('.cb-wrap');
  if (wrapOrfao) wrapOrfao.replaceWith(selectEl);
  delete selectEl.dataset.combobox;
  selectEl.style.display = '';

  const placeholder = opts.placeholder || selectEl.dataset.placeholder || 'Selecione...';
  const emptyText = opts.emptyText || 'Nenhuma opção encontrada';

  // Wrapper
  const wrap = document.createElement('div');
  wrap.className = 'cb-wrap';
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  selectEl.style.display = 'none';

  // Campo visível
  const box = document.createElement('div');
  box.className = 'cb-box';
  box.setAttribute('tabindex', '0');
  box.setAttribute('role', 'combobox');
  box.setAttribute('aria-expanded', 'false');
  box.setAttribute('aria-haspopup', 'listbox');
  wrap.appendChild(box);

  const label = document.createElement('span');
  label.className = 'cb-label cb-placeholder';
  label.textContent = placeholder;
  box.appendChild(label);

  const arrow = document.createElement('span');
  arrow.className = 'cb-arrow';
  arrow.textContent = '▾';
  box.appendChild(arrow);

  // Painel de opções
  const panel = document.createElement('div');
  panel.className = 'cb-panel';
  panel.setAttribute('role', 'listbox');
  wrap.appendChild(panel);

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'cb-search';
  search.placeholder = '🔍 Buscar...';
  panel.appendChild(search);

  const list = document.createElement('div');
  list.className = 'cb-list';
  panel.appendChild(list);

  let opcoes = []; // [{value, label, disabled}]
  let aberto = false;

  function lerOpcoesDoSelect() {
    const atual = selectEl.value;
    opcoes = Array.from(selectEl.options).map(o => ({
      value: o.value,
      label: o.textContent,
      disabled: o.disabled
    }));
    render(atual);
  }

  function render(filtroValor = selectEl.value) {
    const filtro = search.value.trim().toLowerCase();
    list.innerHTML = '';
    indiceAtivo = -1; // lista reconstruída: navegação recomeça
    const visiveis = opcoes.filter(o =>
      o.value !== '' && (!filtro || o.label.toLowerCase().includes(filtro))
    );

    if (!visiveis.length) {
      const vazio = document.createElement('div');
      vazio.className = 'cb-empty';
      vazio.textContent = emptyText;
      list.appendChild(vazio);
    }

    visiveis.forEach(o => {
      const item = document.createElement('div');
      item.className = 'cb-item' +
        (o.value === String(filtroValor) ? ' selected' : '') +
        (o.disabled ? ' disabled' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', o.value === String(filtroValor) ? 'true' : 'false');
      item.textContent = o.label;
      if (!o.disabled) {
        item.addEventListener('click', () => {
          selecionar(o.value);
          fechar();
        });
      }
      list.appendChild(item);
    });

    const sel = list.querySelector('.cb-item.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function abrir() {
    if (aberto) return;
    document.querySelectorAll('.cb-wrap.open').forEach(w => {
      if (w !== wrap && w.__fechar) w.__fechar();
    });
    aberto = true;
    wrap.classList.add('open');
    box.setAttribute('aria-expanded', 'true');
    search.value = '';
    indiceAtivo = -1;
    render();
    panel.style.display = 'block';
    search.focus();
  }

  function fechar() {
    aberto = false;
    wrap.classList.remove('open');
    box.setAttribute('aria-expanded', 'false');
    panel.style.display = 'none';
  }

  function selecionar(valor) {
    selectEl.value = valor;
    atualizarLabel();
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function atualizarLabel() {
    const v = String(selectEl.value);
    const op = opcoes.find(o => o.value === v);
    if (op && op.value !== '') {
      label.textContent = op.label;
      label.classList.remove('cb-placeholder');
    } else {
      label.textContent = placeholder;
      label.classList.add('cb-placeholder');
    }
  }

  box.addEventListener('click', () => (aberto ? fechar() : abrir()));
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
  });

  // ---- Navegação por teclado (Etapa 7) ----
  // Um único "item ativo" acompanhado por setas ↑/↓; Enter confirma o ativo
  // (se nada estiver ativo, mantém o comportamento antigo: 1º visível não disabled).
  let indiceAtivo = -1;

  function itensVisiveis() {
    return Array.from(list.querySelectorAll('.cb-item')).filter(el => !el.classList.contains('disabled'));
  }

  function definirAtivo(novoIndice) {
    const itens = itensVisiveis();
    if (!itens.length) { indiceAtivo = -1; return; }
    indiceAtivo = Math.max(0, Math.min(itens.length - 1, novoIndice));
    itens.forEach((el, i) => {
      const ativo = i === indiceAtivo;
      el.classList.toggle('ativo', ativo);
      if (ativo) {
        el.setAttribute('aria-selected', 'true');
        el.scrollIntoView({ block: 'nearest' });
        search.setAttribute('aria-activedescendant', el.id || '');
      } else {
        el.removeAttribute('aria-selected');
      }
    });
  }

  search.addEventListener('input', () => { indiceAtivo = -1; render(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { fechar(); box.focus(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!aberto) { abrir(); return; }
      definirAtivo(indiceAtivo < 0 ? 0 : indiceAtivo + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) { abrir(); return; }
      definirAtivo(indiceAtivo <= 0 ? 0 : indiceAtivo - 1);
      return;
    }
    if (e.key === 'Home' && aberto) { e.preventDefault(); definirAtivo(0); return; }
    if (e.key === 'End' && aberto) { e.preventDefault(); definirAtivo(itensVisiveis().length - 1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const itens = itensVisiveis();
      // Etapa 7: confirma o item ativo se houver; senão, 1º visível (comportamento original).
      const alvo = (indiceAtivo >= 0 && itens[indiceAtivo]) ? itens[indiceAtivo] : list.querySelector('.cb-item:not(.disabled)');
      if (alvo) alvo.click();
    }
  });
  document.addEventListener('click', (e) => {
    if (aberto && !wrap.contains(e.target)) fechar();
  });
  document.addEventListener('keydown', (e) => {
    if (aberto && e.key === 'Escape') fechar();
  });

  const observer = new MutationObserver(() => {
    lerOpcoesDoSelect();
    atualizarLabel();
  });
  observer.observe(selectEl, { childList: true });

  const api = {
    sync: () => { lerOpcoesDoSelect(); atualizarLabel(); },
    refresh: () => { lerOpcoesDoSelect(); atualizarLabel(); },
    fechar,
    get value() { return selectEl.value; },
    set value(v) { selecionar(v); },
    get select() { return selectEl; }
  };
  wrap.__fechar = fechar;
  selectEl.__combobox = api;

  lerOpcoesDoSelect();
  atualizarLabel();
  return api;
}

/** Sincroniza todos os comboboxes da página (chamar após popular selects) */
export function syncComboboxes() {
  document.querySelectorAll('select[data-combobox]').forEach(s => {
    if (s.__combobox) s.__combobox.sync();
  });
}

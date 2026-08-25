// ui.js - helpers de UI

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function normalize(str) {
  return (str || '').toString().toLowerCase().trim();
}

export function toast(msg, type = 'info') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.style.display = 'none';
  }, 3200);
}

export function escapeHtml(str) {
  return (str || '')
    .toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function escapeHtmlAttr(str) {
  return escapeHtml(str).replaceAll('`', '&#096;');
}

// Modal helpers
export function openModal(id) {
  const el = typeof id === 'string' ? $(id) : id;
  if (!el) return;
  el.classList.add('show');
  document.body.style.overflow = 'hidden';
}

export function closeModal(id) {
  const el = typeof id === 'string' ? $(id) : id;
  if (!el) return;
  el.classList.remove('show');
  if (!document.querySelector('.modal-backdrop.show')) {
    document.body.style.overflow = '';
  }
}

// Date helpers
export function parseDateToLocal(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    return new Date(y, mo, d);
  }
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function formatDateLocal(dateStr) {
  if (!dateStr) return '';
  const d = parseDateToLocal(dateStr);
  if (!d) return String(dateStr);
  return d.toLocaleDateString('pt-BR');
}

export function addDaysToDate(dateStr, days) {
  const d = parseDateToLocal(dateStr) || new Date();
  d.setDate(d.getDate() + Number(days));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getTodayDateStr() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Calculate loan status with days difference
export function getLoanStatus(emprestimo) {
  if (!emprestimo) return { status: 'desconhecido', text: 'Desconhecido', badgeClass: 'badge-muted' };

  if (emprestimo.devolvido) {
    return {
      status: 'devolvido',
      text: 'Devolvido',
      badgeClass: 'badge-returned',
      icon: '✅',
      daysDiff: 0
    };
  }

  const dataRetirada = emprestimo.dataRetirada;
  // If no dataLimite explicitly saved, default to 7 days from retirada
  const dataLimite = emprestimo.dataLimite || addDaysToDate(dataRetirada, 7);

  const dLimite = parseDateToLocal(dataLimite);
  const dHoje = parseDateToLocal(getTodayDateStr());

  if (!dLimite || !dHoje) {
    return { status: 'ativo', text: 'Ativo', badgeClass: 'badge-ok', icon: '🟢', dataLimite };
  }

  const diffMs = dLimite.getTime() - dHoje.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const atraso = Math.abs(diffDays);
    return {
      status: 'vencido',
      text: `Vencido há ${atraso} dia${atraso === 1 ? '' : 's'}`,
      shortText: `Vencido (${atraso}d)`,
      badgeClass: 'badge-overdue',
      icon: '⚠️',
      diffDays,
      atraso,
      dataLimite
    };
  }

  if (diffDays === 0) {
    return {
      status: 'vence_hoje',
      text: 'Vence hoje!',
      shortText: 'Vence hoje',
      badgeClass: 'badge-warning',
      icon: '⏳',
      diffDays: 0,
      dataLimite
    };
  }

  if (diffDays === 1) {
    return {
      status: 'vencendo_amanha',
      text: 'Vence amanhã',
      shortText: 'Vence amanhã',
      badgeClass: 'badge-warning',
      icon: '⏳',
      diffDays: 1,
      dataLimite
    };
  }

  if (diffDays <= 3) {
    return {
      status: 'vencendo_breve',
      text: `Vence em ${diffDays} dias`,
      shortText: `${diffDays} dias restantes`,
      badgeClass: 'badge-soon',
      icon: '⏳',
      diffDays,
      dataLimite
    };
  }

  return {
    status: 'no_prazo',
    text: `No prazo (${diffDays} dias)`,
    shortText: 'No prazo',
    badgeClass: 'badge-ok',
    icon: '🟢',
    diffDays,
    dataLimite
  };
}

// Category design themes for books on virtual shelf
export const CATEGORY_THEMES = {
  'Romance': { bg: 'linear-gradient(135deg, #e11d48, #9f1239)', color: '#fff', border: '#be123c', accent: '#f43f5e', icon: '🌹' },
  'Ficção Científica': { bg: 'linear-gradient(135deg, #6366f1, #3730a3)', color: '#fff', border: '#4f46e5', accent: '#818cf8', icon: '🚀' },
  'Fantasia': { bg: 'linear-gradient(135deg, #059669, #064e3b)', color: '#fff', border: '#047857', accent: '#34d399', icon: '🐉' },
  'Aventura': { bg: 'linear-gradient(135deg, #d97706, #92400e)', color: '#fff', border: '#b45309', accent: '#fbbf24', icon: '🧭' },
  'Suspense': { bg: 'linear-gradient(135deg, #334155, #0f172a)', color: '#fff', border: '#1e293b', accent: '#94a3b8', icon: '🔍' },
  'Biografia': { bg: 'linear-gradient(135deg, #0284c7, #075985)', color: '#fff', border: '#0369a1', accent: '#38bdf8', icon: '👤' },
  'História': { bg: 'linear-gradient(135deg, #78350f, #451a03)', color: '#fff', border: '#92400e', accent: '#d97706', icon: '🏛️' },
  'Comédia': { bg: 'linear-gradient(135deg, #ea580c, #9a3412)', color: '#fff', border: '#c2410c', accent: '#fb923c', icon: '🎭' },
  'Poesia': { bg: 'linear-gradient(135deg, #9333ea, #581c87)', color: '#fff', border: '#7e22ce', accent: '#c084fc', icon: '✒️' },
  'Didático': { bg: 'linear-gradient(135deg, #0891b2, #155e75)', color: '#fff', border: '#0e7490', accent: '#22d3ee', icon: '📐' },
  'Outro': { bg: 'linear-gradient(135deg, #475569, #1e293b)', color: '#fff', border: '#334155', accent: '#cbd5e1', icon: '📖' }
};

export function getCategoryTheme(categoria) {
  return CATEGORY_THEMES[categoria] || {
    bg: 'linear-gradient(135deg, #4b5563, #1f2937)',
    color: '#fff',
    border: '#374151',
    accent: '#9ca3af',
    icon: '📖'
  };
}



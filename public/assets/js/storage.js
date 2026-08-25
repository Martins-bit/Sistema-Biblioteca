// storage.js - armazenamento local e chaves

export const LS_KEYS = {
  alunos: 'biblioteca_alunos_v1',
  livros: 'biblioteca_livros_v1',
  emprestimos: 'biblioteca_emprestimos_v1',
  feedback: 'biblioteca_feedback_v1',
  relatorios: 'biblioteca_relatorios_v1',
  prateleira: 'biblioteca_prateleira_v1'
};

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getBackup({ alunos, livros, emprestimos, relatorios }) {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    alunos,
    livros,
    emprestimos,
    relatorios
  };
}

export function setFromBackup({ data, uidFn, setState }) {
  if (!data || typeof data !== 'object') throw new Error('JSON inválido');

  const a = Array.isArray(data.alunos) ? data.alunos : [];
  const l = Array.isArray(data.livros) ? data.livros : [];
  const p = Array.isArray(data.emprestimos) ? data.emprestimos : [];

  const alunos = a
    .map(x => ({
      id: x.id || uidFn(),
      nome: String(x.nome || ''),
      turma: String(x.turma || '')
    }))
    .filter(x => x.nome.trim() && x.turma.trim());

  const livros = l
    .map(x => ({
      id: x.id || uidFn(),
      titulo: String(x.titulo || ''),
      autor: String(x.autor || ''),
      categoria: String(x.categoria || ''),
      acervo: Number(x.acervo || 1)
    }))
    .filter(x => x.titulo.trim() && x.autor.trim() && x.categoria.trim());

  const emprestimos = p
    .map(x => ({
      id: x.id || uidFn(),
      alunoId: String(x.alunoId || ''),
      livroId: String(x.livroId || ''),
      dataRetirada: String(x.dataRetirada || ''),
      dataLimite: String(x.dataLimite || ''),
      devolvido: Boolean(x.devolvido),
      dataDevolucao: String(x.dataDevolucao || '')
    }))
    .filter(x => x.alunoId && x.livroId && x.dataRetirada);

  const r = Array.isArray(data.relatorios) ? data.relatorios : [];
  const relatorios = r
    .map(x => ({
      id: x.id || uidFn(),
      mensagem: String(x.mensagem || ''),
      criadoEm: String(x.criadoEm || new Date().toISOString())
    }))
    .filter(x => x.mensagem.trim());

  setState({ alunos, livros, emprestimos, relatorios });
}


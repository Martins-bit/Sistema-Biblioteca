// services/turmas.js
// Fonte única de verdade para a lista de salas/turmas do sistema.
// Qualquer parte do backend (validação, ranking, relatórios) e o frontend
// (via GET /api/turmas) devem usar esta lista.

const TURMAS = [
  '6°A', '6°B',
  '7°A', '7°B',
  '8°A', '8°B',
  '9°A', '9°B',
  '1°A', '1°B',
  '2°A', '2°B',
  '3°A', '3°B'
];

/**
 * Normaliza valores legados/free-form de turma para o padrão canônico.
 * Exemplos aceitos: "7ºA", "7°A", "7 A", "7ANO A", "7º ANO A", "8o b" -> "7°A" / "8°B"
 * Retorna a turma canônica quando reconhecida; caso contrário, retorna o
 * valor original aparado (compatibilidade com registros antigos fora do padrão).
 */
function normalizarTurma(valor) {
  if (valor === null || valor === undefined) return null;

  const bruto = String(valor).trim();
  if (!bruto) return null;

  let s = bruto
    .toUpperCase()
    .replace(/\s*ANO\s*/g, ' ')   // "7º ANO A" -> "7º A"
    .replace(/\s+/g, ' ')
    .trim();

  // Formatos: "7A", "7 A", "7ºA", "7°A", "7O A", "7-A" ...
  const m = s.match(/^(\d{1,2})\s*[°ºO]?\s*[-–—]?\s*([A-D])?$/);
  if (m) {
    const num = m[1];
    const letra = m[2] || '';
    const candidato = `${num}°${letra}`;
    if (TURMAS.includes(candidato)) return candidato;
    // Número reconhecido mas fora da lista (ex.: "10°A") — mantém normalizado
    return candidato;
  }

  // Já está no formato canônico?
  if (TURMAS.includes(s)) return s;

  // Desconhecida: preserva o original (não descarta dados antigos)
  return bruto;
}

/**
 * Valida se a turma informada é aceitável para cadastro.
 * Aceita qualquer valor que, normalizado, corresponda à lista canônica.
 */
function turmaValida(valor) {
  const norm = normalizarTurma(valor);
  return !!norm && TURMAS.includes(norm);
}

module.exports = { TURMAS, normalizarTurma, turmaValida };
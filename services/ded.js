// services/ded.js
// Etapa 6B — parser e validações do arquivo DED (Diário Escolar Digital).
//
// Responsabilidades:
//  - decodificar bytes (UTF-8 / UTF-8 BOM / fallback Latin-1) sem corromper acentos;
//  - detectar separador (vírgula, ponto e vírgula, TAB);
//  - localizar colunas matrícula/nome/turma pelo cabeçalho (sem posições fixas);
//  - normalizar matrícula (texto, zeros à esquerda preservados) e nome;
//  - detectar turmas distintas e duplicidades no próprio arquivo.
//
// Este serviço é puro (sem acesso ao banco) — as rotas em routes/ded.js
// fazem a parte de banco/mapeamento/preview/commit.

// Limite máximo de linhas aceitas (proteção contra arquivos gigantes).
const MAX_LINHAS = 5000;
// Limite máximo de colunas por linha (linhas comuns têm 3).
const MAX_COLUNAS = 20;

// ---------------------------------------------------------------------------
// DECODIFICAÇÃO
// ---------------------------------------------------------------------------

/**
 * Decodifica um Buffer para texto.
 * Remove BOM UTF-8. Tenta UTF-8 estrito; se houver bytes inválidos
 * (arquivo salvo em Latin-1/Windows-1252), reinterpreta como Latin-1.
 * Nunca lança — nomes com acento (ã, á, é, ç, º, °) são preservados.
 */
function decodificarArquivo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  let texto = buffer.toString('utf8');
  // Detecta bytes que não são UTF-8 válido (formam U+FFFD na conversão).
  const temSequenciaInvalida = texto.includes('\uFFFD');
  if (temSequenciaInvalida) {
    texto = buffer.toString('latin1');
  }

  // Remove BOM (UTF-8 ou latin1 renderizado).
  return texto.replace(/^\uFEFF/, '');
}

// ---------------------------------------------------------------------------
// DETECÇÃO DE SEPARADOR
// ---------------------------------------------------------------------------

/**
 * Detecta o separador a partir da primeira linha útil.
 * Conta ocorrências fora de aspas. TAB vence empatado (arquivos .tsv).
 */
function detectarSeparador(texto) {
  const primeiraLinha = String(texto || '').split(/\r?\n/).find(l => l.trim()) || '';
  const contagem = (caractere) => {
    let n = 0, dentroDeAspas = false;
    for (const ch of primeiraLinha) {
      if (ch === '"') dentroDeAspas = !dentroDeAspas;
      else if (ch === caractere && !dentroDeAspas) n++;
    }
    return n;
  };
  const candidatos = [
    { sep: '\t', n: contagem('\t') },
    { sep: ';', n: contagem(';') },
    { sep: ',', n: contagem(',') }
  ].sort((a, b) => b.n - a.n);

  if (!candidatos[0] || candidatos[0].n === 0) return '\t'; // linha única sem separador
  return candidatos[0].sep;
}

// ---------------------------------------------------------------------------
// NORMALIZAÇÃO DE CAMPOS
// ---------------------------------------------------------------------------

/**
 * Normaliza matrícula. Regras (Etapa 6B, obrigatórias):
 *  - trim; somente números; zeros à esquerda preservados; vazia => null;
 *  - letras ou símbolos => { valor: null, invalida: true } (não "limpa" caracteres).
 */
function normalizarMatricula(valor) {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return { valor: null, invalida: false };
  if (!/^\d+$/.test(bruto)) return { valor: null, invalida: true, original: bruto };
  return { valor: bruto, invalida: false }; // texto puro — NÃO converter p/ número
}

/**
 * Normaliza nome: trim, colapsa espaços, remove caracteres de controle.
 * Preserva acentos e a grafia original. Vazio => inválido.
 */
function normalizarNome(valor) {
  let s = String(valor ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ') // controles
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/**
 * Normaliza turma do DED (trim + colapso de espaços) para comparação estável.
 * Não tenta converter para turma canônica — isso é papel do mapeamento.
 */
function normalizarTurmaDed(valor) {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// CABEÇALHO / COLUNAS
// ---------------------------------------------------------------------------

// Reconhece variações do cabeçalho (case/acento-insensível).
function cabeçalhoEh(valor, tipo) {
  const s = String(valor ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos p/ comparar
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
  if (tipo === 'matricula') return s === 'matricula';
  if (tipo === 'nome') return s === 'nome' || s === 'aluno' || s === 'nomealuno';
  if (tipo === 'turma') return s === 'turma' || s === 'sala' || s === 'classe';
  return false;
}

/**
 * Divide uma linha respeitando aspas CSV.
 */
function dividirLinha(linha, sep) {
  const campos = [];
  let atual = '', dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
    } else if (ch === sep && !dentroDeAspas) {
      campos.push(atual); atual = '';
    } else {
      atual += ch;
    }
  }
  campos.push(atual);
  return campos.map(c => c.trim());
}

// ---------------------------------------------------------------------------
// PARSE PRINCIPAL
// ---------------------------------------------------------------------------

/**
 * Faz o parse completo do texto do arquivo DED.
 * Retorna { ok, erro?, separador, linhas: [{linha, matricula, invalida, nome, turmaDed}] }.
 * Não valida contra o banco — apenas estrutura e normalização.
 */
function parseArquivo(texto) {
  if (!texto || !texto.trim()) return { ok: false, erro: 'Arquivo vazio.' };

  const separador = detectarSeparador(texto);
  const todas = texto.split(/\r?\n/);
  if (todas.length > MAX_LINHAS) {
    return { ok: false, erro: `Arquivo muito grande. Limite de ${MAX_LINHAS} linhas.` };
  }

  // 1) Procura linha de cabeçalho entre as primeiras linhas.
  let idxCabecalho = -1;
  let colunas = null; // { matricula, nome, turma } -> índices
  for (let i = 0; i < Math.min(todas.length, 10); i++) {
    if (!todas[i].trim()) continue;
    const campos = dividirLinha(todas[i], separador);
    if (campos.length > MAX_COLUNAS) return { ok: false, erro: 'Arquivo com colunas demais.' };
    const idx = { matricula: -1, nome: -1, turma: -1 };
    campos.forEach((c, j) => {
      if (cabeçalhoEh(c, 'matricula')) idx.matricula = j;
      else if (cabeçalhoEh(c, 'nome')) idx.nome = j;
      else if (cabeçalhoEh(c, 'turma')) idx.turma = j;
    });
    if (idx.nome !== -1 && idx.turma !== -1) {
      idxCabecalho = i;
      colunas = idx;
      break;
    }
  }

  // Sem cabeçalho: assume ordem matrícula, nome, turma (formato conhecido do DED).
  const semCabecalho = colunas === null;
  if (semCabecalho) {
    colunas = { matricula: 0, nome: 1, turma: 2 };
  }

  const linhas = [];
  for (let i = (idxCabecalho === -1 ? 0 : idxCabecalho + 1); i < todas.length; i++) {
    const bruta = todas[i];
    if (!bruta || !bruta.trim()) continue;
    const campos = dividirLinha(bruta, separador);
    if (campos.length > MAX_COLUNAS) continue; // linha maluca: ignora

    const matriculaNorm = normalizarMatricula(campos[colunas.matricula]);
    const nome = normalizarNome(campos[colunas.nome]);
    const turmaDed = normalizarTurmaDed(campos[colunas.turma]);

    let erro = null;
    if (matriculaNorm.invalida) erro = `Matrícula inválida: "${matriculaNorm.original}"`;
    else if (!nome) erro = 'Nome vazio.';
    else if (!turmaDed) erro = 'Turma vazia.';

    linhas.push({
      linha: i + 1,
      matricula: matriculaNorm.valor,
      matriculaInvalida: matriculaNorm.invalida,
      nome,
      turmaDed,
      erro
    });
  }

  if (!linhas.length) return { ok: false, erro: 'Nenhuma linha de dados encontrada no arquivo.' };
  return { ok: true, separador, comCabecalho: !semCabecalho, linhas };
}

/**
 * Turmas distintas do arquivo (ordenadas por primeira aparição).
 */
function turmasDistintas(linhas) {
  const vistas = new Map();
  for (const l of linhas) {
    if (l.turmaDed && !vistas.has(l.turmaDed)) vistas.set(l.turmaDed, true);
  }
  return [...vistas.keys()];
}

module.exports = {
  MAX_LINHAS,
  MAX_COLUNAS,
  decodificarArquivo,
  detectarSeparador,
  normalizarMatricula,
  normalizarNome,
  normalizarTurmaDed,
  dividirLinha,
  parseArquivo,
  turmasDistintas
};

// services/isbn.js — Normalização, validação e conversão de ISBN
// + busca com FALLBACK entre fontes (BrasilAPI, Google Books, Open Library).
// Sem dependências externas: usa fetch nativo (Node 18+).

// ---------------- Normalização / validação ----------------

// Remove hífens, espaços e qualquer caractere não numérico (mantém X final).
function limparIsbn(valor) {
  return String(valor || '')
    .replace(/-/g, '')
    .replace(/\s/g, '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
}

function validarIsbn10(isbn) {
  if (!/^[0-9]{9}[0-9X]$/.test(isbn)) return false;
  let soma = 0;
  for (let i = 0; i < 10; i++) {
    const d = isbn[i] === 'X' ? 10 : Number(isbn[i]);
    soma += d * (10 - i);
  }
  return soma % 11 === 0;
}

function validarIsbn13(isbn) {
  if (!/^[0-9]{13}$/.test(isbn)) return false;
  let soma = 0;
  for (let i = 0; i < 13; i++) {
    soma += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return soma % 10 === 0;
}

// Converte ISBN-10 → ISBN-13 (prefixo 978) com dígito verificador correto.
function isbn10Para13(isbn10) {
  const base = '978' + isbn10.slice(0, 9);
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const dv = (10 - (soma % 10)) % 10;
  return base + dv;
}

// Converte ISBN-13 → ISBN-10 APENAS quando prefixo é 978 (nunca 979).
function isbn13Para10(isbn13) {
  if (!isbn13.startsWith('978')) return null;
  const base = isbn13.slice(3, 12);
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(base[i]) * (10 - i);
  const resto = soma % 11;
  const dv = resto === 0 ? '0' : resto === 1 ? 'X' : String(11 - resto);
  return base + dv;
}

// Normaliza e valida; devolve { valido, isbn, isbn13, isbn10, candidatos }
function normalizarIsbn(valor) {
  const isbn = limparIsbn(valor);
  if (!isbn) return { valido: false, isbn: null, isbn13: null, isbn10: null, candidatos: [] };

  let isbn13 = null;
  let isbn10 = null;

  if (isbn.length === 13) {
    if (!validarIsbn13(isbn)) return { valido: false, isbn, isbn13: null, isbn10: null, candidatos: [] };
    isbn13 = isbn;
    isbn10 = isbn13Para10(isbn); // null quando começa com 979
  } else if (isbn.length === 10) {
    if (!validarIsbn10(isbn)) return { valido: false, isbn, isbn13: null, isbn10: null, candidatos: [] };
    isbn10 = isbn;
    isbn13 = isbn10Para13(isbn);
  } else {
    return { valido: false, isbn, isbn13: null, isbn10: null, candidatos: [] };
  }

  // Ordem de consulta: o ISBN informado primeiro, depois o equivalente.
  const candidatos = [];
  if (isbn.length === 13) {
    candidatos.push(isbn13);
    if (isbn10) candidatos.push(isbn10);
  } else {
    candidatos.push(isbn10);
    candidatos.push(isbn13);
  }
  return { valido: true, isbn, isbn13, isbn10, candidatos: [...new Set(candidatos)] };
}

module.exports = {
  limparIsbn,
  validarIsbn10,
  validarIsbn13,
  isbn10Para13,
  isbn13Para10,
  normalizarIsbn
};

// ---------------- Mapeamento simples de assuntos → Categoria / Gênero ----------------
// Pequeno e claro: só traduz termos comuns das APIs (categories/subjects).
const MAPA_ASSUNTOS = {
  categoria: [
    [/fic[cç][aã]o policial|crime|mystery|thriller/i, 'Literatura'],
    [/science fiction|fic[cç][aã]o cient[ií]fica|fantasy|fantasia/i, 'Literatura'],
    [/fiction|literatura|romance|novel|poesia|poetry|contos|cr[aô]nica/i, 'Literatura'],
    [/history|hista|hist[óo]ria/i, 'História'],
    [/science|ci[êe]nc/i, 'Ciências'],
    [/biolog|f[ií]sica|qu[ií]mica|astronomia|matem[aá]tica/i, 'Ciências'],
    [/biograph|biograf|autobiograf|mem[oó]ria/i, 'Biografia'],
    [/philosoph|filosof/i, 'Filosofia'],
    [/geograph|geograf/i, 'Geografia'],
    [/art|arte|arquitetura|m[uú]sica|cinema|teatro/i, 'Arte'],
    [/education|educa[cç][aã]o|pedagogia|did[aá]tico|escolar/i, 'Educação'],
    [/infantil|juvenile|juvenile fiction|crian[cç]a|infantojuvenil/i, 'Infantil'],
    [/sociolog|sociedade|pol[ií]tic|econom/i, 'Sociedade']
  ],
  genero: [
    [/romance/i, 'Romance'],
    [/aventura|adventure/i, 'Aventura'],
    [/fantasia|fantasy/i, 'Fantasia'],
    [/fic[cç][aã]o cient[ií]fica|science fiction|sci-?fi/i, 'Ficção Científica'],
    [/terror|horror|sobrenatural/i, 'Terror'],
    [/policial|crime|mystery|mist[ée]rio|detetive|suspense|thriller/i, 'Suspense'],
    [/biograf|autobiograf|mem[oó]ria/i, 'Biografia'],
    [/poesia|poetry|poema/i, 'Poesia'],
    [/contos|short stories|cr[oô]nica/i, 'Contos'],
    [/hist[óo]ria(?! em)|history(?! of book)/i, 'História'],
    [/quadrinhos|comic|graphic novel|mang[aá]/i, 'Quadrinhos'],
    [/did[aá]tico|textbook|educa/i, 'Didático'],
    [/infantil|juvenile|crian[cç]a/i, 'Infantil']
  ]
};

// Retorna { categoria, genero } a partir de uma lista de assuntos.
// Se nada confiar, devolve vazio (não inventa).
function mapearAssuntos(assuntos) {
  if (!Array.isArray(assuntos) || !assuntos.length) return { categoria: '', genero: '' };
  const texto = assuntos.join(' | ');
  let categoria = '';
  let genero = '';
  for (const [re, valor] of MAPA_ASSUNTOS.categoria) {
    if (re.test(texto)) { categoria = valor; break; }
  }
  for (const [re, valor] of MAPA_ASSUNTOS.genero) {
    if (re.test(texto)) { genero = valor; break; }
  }
  return { categoria, genero };
}

// ---------------- Consultas às fontes ----------------
// Cada função devolve { titulo, autores:[], capa, assuntos:[], editora, ano, fonte }
// ou null. Não considera "falha" a falta de capa/categoria: só título/autor importam.

async function buscarBrasilAPI(isbn) {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/isbn/v1/${isbn}`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d?.title) return null;
    // Proteção contra falso positivo: se a API devolve o ISBN do registro,
    // ele deve bater com o ISBN consultado.
    if (d.isbn) {
      const retorno = limparIsbn(d.isbn);
      if (retorno && retorno !== isbn && retorno !== isbn10Para13(isbn.slice(0, 10))) {
        // tolera equivalência 10↔13; caso contrário, desconfia
        if (retorno !== isbn) return null;
      }
    }
    return {
      titulo: d.title,
      autores: Array.isArray(d.authors) ? d.authors : (d.subtitle ? [d.subtitle] : []),
      subtitulo: d.subtitle || '',
      capa: d.cover_url || null,
      assuntos: Array.isArray(d.subjects) ? d.subjects : [],
      editora: d.publisher || '',
      ano: d.year ? String(d.year) : '',
      fonte: 'BrasilAPI'
    };
  } catch (e) {
    return null;
  }
}

async function buscarGoogleBooks(isbn, tentativa = 0) {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (res.status === 429 && tentativa < 1) {
      await new Promise(r => setTimeout(r, 800));
      return buscarGoogleBooks(isbn, tentativa + 1);
    }
    if (!res.ok) return null;
    const d = await res.json();
    const info = d.items?.[0]?.volumeInfo;
    if (!info?.title) return null;
    return {
      titulo: info.title,
      autores: info.authors || [],
      subtitulo: info.subtitle || '',
      capa: info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null,
      assuntos: info.categories || [],
      editora: info.publisher || '',
      ano: info.publishedDate ? String(info.publishedDate).slice(0, 4) : '',
      fonte: 'Google Books'
    };
  } catch (e) {
    return null;
  }
}

async function buscarOpenLibrary(isbn) {
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d?.title) return null;

    // Capa: usamos o formato L (melhor resolução) via covers.openlibrary.org
    let capa = null;
    if (Array.isArray(d.covers) && d.covers.length) {
      capa = `https://covers.openlibrary.org/b/id/${d.covers[0]}-L.jpg`;
    }

    // Assuntos: no registro por ISBN vêm só as chaves de "subjects";
    // tentamos a edição para pegar os nomes legíveis.
    let assuntos = [];
    if (Array.isArray(d.subjects) && d.subjects.length) {
      assuntos = d.subjects
        .map(s => typeof s === 'string' ? s : (typeof s.key === 'string' ? decodeURIComponent(s.key.split('/').pop().replace(/_/g, ' ')) : ''))
        .filter(Boolean);
    }

    return {
      titulo: d.title,
      autores: [],
      subtitulo: d.subtitle || '',
      capa,
      assuntos,
      editora: Array.isArray(d.publishers) ? d.publishers.join(', ') : '',
      ano: Array.isArray(d.publish_date) ? d.publish_date[0] : (d.publish_date || ''),
      fonte: 'Open Library'
    };
  } catch (e) {
    return null;
  }
}

// Busca complementar: título/autor via Open Library Search API.
// Só é usada quando uma fonte retornou dados parciais e outra completar.
async function buscarOpenLibraryPorTitulo(titulo, autor) {
  try {
    const q = new URLSearchParams({ q: `${titulo} ${autor || ''}`.trim(), fields: 'title,author_name,cover_i,subject', limit: '1' });
    const res = await fetch(`https://openlibrary.org/search.json?${q}`);
    if (!res.ok) return null;
    const d = await res.json();
    const doc = d.docs?.[0];
    if (!doc?.title) return null;
    // Correspondência frouxa mas não cega: título precisa ter semelhança
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm(doc.title).slice(0, 12) !== norm(titulo).slice(0, 12)) return null;
    return {
      titulo: doc.title,
      autores: doc.author_name || [],
      capa: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
      assuntos: doc.subject || [],
      editora: (doc.publisher || [])[0] || '',
      ano: doc.first_publish_year ? String(doc.first_publish_year) : '',
      fonte: 'Open Library (busca)'
    };
  } catch (e) {
    return null;
  }
}

// ---------------- Fusão de resultados ----------------
// Nunca substitui um valor válido por vazio. Prioridade: primeiro resultado não vazio.
function fundirResultados(principal, complemento) {
  if (!complemento) return principal;
  const pegar = (a, b) => (a && String(a).trim() ? a : (b && String(b).trim() ? b : ''));
  return {
    titulo: pegar(principal.titulo, complemento.titulo),
    autores: (principal.autores?.length ? principal.autores : complemento.autores) || [],
    subtitulo: pegar(principal.subtitulo, complemento.subtitulo),
    capa: principal.capa || complemento.capa || null,
    assuntos: (principal.assuntos?.length ? principal.assuntos : complemento.assuntos) || [],
    editora: pegar(principal.editora, complemento.editora),
    ano: pegar(principal.ano, complemento.ano),
    fontes: [...new Set([...(principal.fontes || [principal.fonte]), ...(complemento.fontes || [complemento.fonte])])]
  };
}

// ---------------- Busca principal ----------------
// Fallback em cascata: BrasilAPI → Google Books → Open Library,
// tentando o ISBN informado e o equivalente (10 ↔ 13).
// Dados parciais são complementados pela próxima fonte (ou busca por título).
async function buscarLivroPorIsbn(valor) {
  const { valido, isbn, isbn10, isbn13, candidatos } = normalizarIsbn(valor);
  if (!valido) {
    return { encontrado: false, motivo: 'ISBN inválido (verifique o formato e o dígito verificador).', isbn: null, fontes: [] };
  }

  const fontes = [buscarBrasilAPI, buscarGoogleBooks, buscarOpenLibrary];
  let resultado = null;

  for (const buscar of fontes) {
    for (const cand of candidatos) {
      const r = await buscar(cand);
      if (r && r.titulo) {
        resultado = resultado ? fundirResultados(resultado, r) : r;
        break; // já temos título desta fonte; passa para complementar na próxima
      }
    }
    // Parada adiantada: já temos título, autor e capa/assuntos úteis
    if (resultado && resultado.titulo && resultado.autores.length && (resultado.capa || resultado.assuntos.length)) {
      break;
    }
  }

  // Complementação: temos título mas faltam capa/assuntos → busca por título no OL
  if (resultado && resultado.titulo && (!resultado.capa || !resultado.assuntos.length)) {
    const complemento = await buscarOpenLibraryPorTitulo(resultado.titulo, resultado.autores[0]);
    if (complemento) resultado = fundirResultados(resultado, complemento);
  }

  if (!resultado || !resultado.titulo) {
    return { encontrado: false, motivo: 'Não encontrado em nenhuma base (BrasilAPI, Google Books, Open Library).', isbn: isbn, fontes: [] };
  }

  const { categoria, genero } = mapearAssuntos(resultado.assuntos);
  const autor = (resultado.autores && resultado.autores[0]) || '';

  return {
    encontrado: true,
    isbn: isbn13 || isbn10 || isbn,
    isbn10: isbn10 || null,
    isbn13: isbn13 || null,
    titulo: resultado.titulo,
    subtitulo: resultado.subtitulo || '',
    autor,
    categoria,
    genero,
    capa: resultado.capa || null,
    assuntos: resultado.assuntos || [],
    editora: resultado.editora || '',
    ano: resultado.ano || '',
    fontes: resultado.fontes?.length ? resultado.fontes : (resultado.fonte ? [resultado.fonte] : []),
    mensagem: `Livro encontrado via ${resultado.fontes ? resultado.fontes.join(' + ') : 'base pública'}.`
  };
}

module.exports.buscarLivroPorIsbn = buscarLivroPorIsbn;
module.exports.mapearAssuntos = mapearAssuntos;

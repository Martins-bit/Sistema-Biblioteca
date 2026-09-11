const { buscarLivroPorIsbn } = require('../services/isbn');

const casos = [
  ['9788535914849', '1984 — George Orwell (trad. brasileira)'],
  ['0-306-40615-2', 'Internacional ISBN-10 com hífens'],
  ['9780306406157', 'Mesmo livro, ISBN-13 equivalente'],
  ['9788525406958', 'Brasileiro (Companhia das Letras)'],
  ['9999999999999', 'ISBN inexistente (DV válido, mas nenhuma API conhece)'],
  ['9788535910629', 'Vidas Secas — Graciliano Ramos (brasileiro)'],
  ['9780132350884', 'Clean Code — internacional (ISBN-13)']
];

(async () => {
  for (const [isbn, desc] of casos) {
    try {
      const r = await buscarLivroPorIsbn(isbn);
      if (r.encontrado) {
        console.log(`ENCONTRADO | ${desc}`);
        console.log(`  título="${r.titulo}" autor="${r.autor}"`);
        console.log(`  categoria="${r.categoria || '—'}" genero="${r.genero || '—'}" capa=${r.capa ? 'sim' : 'não'} ano="${r.ano || '—'}"`);
        console.log(`  fontes=${(r.fontes || []).join(' + ')}`);
      } else {
        console.log(`NAO ENCONTRADO | ${desc} | motivo: ${r.motivo}`);
      }
    } catch (e) {
      console.log(`ERRO | ${desc} | ${e.message}`);
    }
  }
})();

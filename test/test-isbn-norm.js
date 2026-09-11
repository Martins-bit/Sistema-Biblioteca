const { normalizarIsbn } = require('../services/isbn');

const casos = [
  ['978-85-359-1484-9', true],
  ['9788535914849', true],
  ['0-306-40615-2', true],
  ['0306406152', true],
  ['9798535914848', true],   // 979 válido: não converte para 10
  ['9781234567890', false],  // DV errado (o correto seria 7)
  ['12345', false],
  ['', false],
  ['978-85-359-0277-8', true]
];

let falhas = 0;
for (const [entrada, esperado] of casos) {
  const r = normalizarIsbn(entrada);
  const ok = r.valido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | "${entrada}" → valido=${r.valido} isbn13=${r.isbn13} isbn10=${r.isbn10} (esperado=${esperado})`);
}

// Verificações específicas
const r1 = normalizarIsbn('0-306-40615-2');
if (r1.isbn13 !== '9780306406157') { console.log('FAIL conversao 10->13:', r1.isbn13); falhas++; } else console.log('PASS conversao 10->13 = 9780306406157');

const r2 = normalizarIsbn('9780306406157');
if (r2.isbn10 !== '0306406152') { console.log('FAIL conversao 13->10:', r2.isbn10); falhas++; } else console.log('PASS conversao 13->10 = 0306406152');

const r3 = normalizarIsbn('9791234567896');
if (r3.valido && r3.isbn10 !== null) { console.log('FAIL 979 nao deveria converter para 10'); falhas++; } else console.log('PASS 979 sem conversao 10');

console.log(falhas === 0 ? 'TODOS OS TESTES DE ISBN PASSARAM' : `${falhas} FALHAS`);
process.exit(falhas === 0 ? 0 : 1);

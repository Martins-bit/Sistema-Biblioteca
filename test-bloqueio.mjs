// Testes de bloqueio, recuperação e regra de 3,0 estrelas (executados contra o servidor local)
const BASE = 'http://localhost:3000';
let cookie = null;

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const sc = res.headers.get('set-cookie');
  if (sc && !cookie) cookie = sc.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

function assert(nome, cond, extra = '') {
  console.log((cond ? '✅' : '❌') + ' ' + nome + (extra ? ' — ' + extra : ''));
  if (!cond) process.exitCode = 1;
}

(async () => {
  await req('POST', '/api/auth/login', { email: 'admin@biblioteca.local', password: '1234' });

  const hoje = new Date().toISOString().split('T')[0];

  // ---- Preparação: alunos e livros de teste ----
  const turma = '8\u00B0A';
  const alunos = {};
  for (const nome of ['QA Cinco', 'QA TresUm', 'QA Exato', 'QA DoisNove', 'QA Dois', 'QA Devolucao', 'QA Bloqueio']) {
    const r = await req('POST', '/api/alunos', { nome, turma });
    alunos[nome] = r.data.id;
  }
  const l1 = (await req('POST', '/api/livros', { titulo: 'QA Livro A', autor: 'QA', categoria: 'Teste', acervo: 10 })).data.id;
  const l2 = (await req('POST', '/api/livros', { titulo: 'QA Livro B', autor: 'QA', categoria: 'Teste', acervo: 10 })).data.id;
  const l3 = (await req('POST', '/api/livros', { titulo: 'QA Livro C', autor: 'QA', categoria: 'Teste', acervo: 10 })).data.id;
  assert('Alunos e livros de teste criados', Object.values(alunos).every(Boolean) && l1 && l2 && l3);

  async function nota(id) {
    return (await req('GET', `/api/alunos/${id}/reputacao`)).data;
  }
  async function tentarEmprestimo(alunoId, livroId) {
    return req('POST', '/api/emprestimos', {
      alunoId, livroId, dataRetirada: hoje,
      dataLimite: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      estadoSaida: 'Bom'
    });
  }
  async function devolver(empId, dias, estado) {
    const d = new Date(); d.setDate(d.getDate() + dias);
    return req('PUT', `/api/emprestimos/${empId}`, {
      dataDevolucao: d.toISOString().split('T')[0], estadoDevolucao: estado
    });
  }

  // ---- Teste: aluno sem histórico (nota 5,0 = Excelente) ----
  let n = await nota(alunos['QA Cinco']);
  assert('Aluno novo tem nota 5,0', n.nota === 5, `nota=${n.nota} situação=${n.situacao}`);
  let r = await tentarEmprestimo(alunos['QA Cinco'], l1);
  assert('Aluno 5,0 consegue emprestar', r.status === 201);
  await devolver(r.data.id, 0, 'Bom'); // devolvido no prazo, mesmo estado

  // ---- Construir notas: devoluções atrasadas derrubam a nota ----
  // QA DoisNove: precisa cair abaixo de 3,0
  // Cada atraso de 13 dias = -0.51 (teto 0.50) => 3 atrasos: 5 - 1.5 = 3.5... vamos usar 3 atrasos grandes
  // 5.0 - (0.5*4) = 3.0 exato (QA Exato)
  // QA Exato: 4 atrasos grandes (teto de penalidade -0,50 cada) => 5 - 2 = 3,0
  for (let i = 0; i < 4; i++) {
    const e = await tentarEmprestimo(alunos['QA Exato'], l1);
    await devolver(e.data.id, 30, 'Bom');
  }
  n = await nota(alunos['QA Exato']);
  assert('QA Exato caiu para 3,0 (permitido)', n.nota === 3, `nota=${n.nota}`);
  r = await tentarEmprestimo(alunos['QA Exato'], l1);
  assert('Aluno com 3,0 exato PODE emprestar', r.status === 201);
  await devolver(r.data.id, 0, 'Bom');

  // QA DoisNove: 4 atrasos grandes (5 - 2 = 3,0) + 2 atrasos de 4 dias (-0,33 cada) => ~2,3
  // Obs.: devolver(id, X) usa hoje+X; como o limite é hoje+7, "4 dias de atraso" = devolver em hoje+11
  for (let i = 0; i < 4; i++) {
    const e = await tentarEmprestimo(alunos['QA DoisNove'], l1);
    await devolver(e.data.id, 30, 'Bom');
  }
  let e2 = await tentarEmprestimo(alunos['QA DoisNove'], l1);
  await devolver(e2.data.id, 11, 'Bom');
  let e3 = await tentarEmprestimo(alunos['QA DoisNove'], l1);
  await devolver(e3.data.id, 11, 'Bom');
  n = await nota(alunos['QA DoisNove']);
  assert('QA DoisNove abaixo de 3,0', n.nota < 3, `nota=${n.nota}`);

  // ---- Bloqueio: API direta deve recusar ----
  const sitAntes = await nota(alunos['QA DoisNove']);
  assert('Situação = Bloqueado temporariamente', sitAntes.bloqueado === true && sitAntes.situacao === 'Bloqueado temporariamente', JSON.stringify(sitAntes.situacao));
  assert('Bloqueio tem dataFim (~21 dias)', !!sitAntes.bloqueioFim);
  r = await tentarEmprestimo(alunos['QA DoisNove'], l1);
  assert('API recusa empréstimo de bloqueado (403)', r.status === 403, JSON.stringify(r.data.error || '').slice(0, 80));

  // Segunda tentativa não deve criar bloqueio duplicado
  const antes = await req('GET', '/api/alunos/' + alunos['QA DoisNove'] + '/reputacao');
  r = await tentarEmprestimo(alunos['QA DoisNove'], l2);
  assert('Nova tentativa também recusada', r.status === 403);
  const depois = await nota(alunos['QA DoisNove']);
  assert('Data de fim do bloqueio não mudou (sem duplicar)', antes.data.bloqueioFim === depois.bloqueioFim, `${antes.data.bloqueioFim}`);

  // ---- Recuperação gradual ----
  // QA Devolucao: devoluções no prazo, mesmo estado => nota sobe lentamente
  const dev = alunos['QA Devolucao'];
  // derruba a nota para ~2,6 com atrasos grandes
  for (let i = 0; i < 5; i++) {
    const e = await tentarEmprestimo(dev, l2);
    await devolver(e.data.id, 30, 'Bom');
  }
  const antesRec = await nota(dev);
  assert('QA Devolucao abaixo de 3,0 (bloqueado)', antesRec.bloqueado === true, `nota=${antesRec.nota}`);

  // ---- Histórico da avaliação ----
  const hist = (await req('GET', `/api/alunos/${dev}/historico-avaliacao`)).data;
  assert('Histórico da avaliação registrou eventos', Array.isArray(hist) && hist.length > 0, `${hist.length} eventos`);
  assert('Histórico tem bloqueio_iniciado', hist.some(h => h.tipo === 'bloqueio_iniciado'));
  assert('Histórico tem devolucao_atrasada', hist.some(h => h.tipo === 'devolucao_atrasada'));

  console.log('\n=== Resumo ===');
  for (const [nome, id] of Object.entries(alunos)) {
    if (!id) continue;
    const x = await nota(id);
    console.log(`${nome}: nota=${x.nota} estrelas=${x.estrelas} situação=${x.situacao}${x.bloqueioFim ? ' até ' + x.bloqueioFim : ''}`);
  }
})();

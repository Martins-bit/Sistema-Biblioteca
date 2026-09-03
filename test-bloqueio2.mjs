// Teste focado: bloqueio, recuperação, estado do livro, re-bloqueio
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

  const iso = (d) => d.toISOString().split('T')[0];
  const turma = '8\u00B0A';
  const nome = 'QA Bloqueio Teste ' + Date.now();

  const alunoId = (await req('POST', '/api/alunos', { nome, turma })).data.id;
  const livroId = (await req('POST', '/api/livros', { titulo: 'QA Livro Z ' + Date.now(), autor: 'QA', categoria: 'Teste', acervo: 10 })).data.id;
  console.log('  (debug) alunoId =', alunoId);

  async function emprestar(diasPrazo = 7, estado = 'Bom') {
    const ret = new Date(); ret.setDate(ret.getDate() - diasPrazo);
    const lim = new Date(ret); lim.setDate(lim.getDate() + diasPrazo);
    return req('POST', '/api/emprestimos', {
      alunoId, livroId, dataRetirada: iso(ret), dataLimite: iso(lim), estadoSaida: estado
    });
  }
  async function devolver(id, deltaDias, estado) {
    const d = new Date(); d.setDate(d.getDate() + deltaDias);
    return req('PUT', `/api/emprestimos/${id}`, { dataDevolucao: iso(d), estadoDevolucao: estado });
  }
  const nota = async () => (await req('GET', `/api/alunos/${alunoId}/reputacao`)).data;

  // ---- 1. Derrubar a nota abaixo de 3,0 com atrasos ----
  for (let i = 0; i < 4; i++) {
    const e = await emprestar(7);
    await devolver(e.data.id, 23, 'Bom'); // 16 dias de atraso => -0,50 (teto)
  }
  const pequeno = await emprestar(7);
  await devolver(pequeno.data.id, 9, 'Bom'); // +2 dias de atraso => -0,29
  let n = await nota();
  assert('Nota caiu abaixo de 3,0 (atrasos)', n.nota < 3, `nota=${n.nota}`);
  assert('Situação: Bloqueado temporariamente', n.bloqueado && n.situacao === 'Bloqueado temporariamente');

  // ---- 2. API recusa empréstimo ----
  let r = await emprestar(7);
  assert('API recusa empréstimo (403)', r.status === 403, (r.data.error || '').slice(0, 90));
  assert('Mensagem menciona data de liberação', /Novo empréstimo disponível em/.test(r.data.error || ''));

  // ---- 3. Sem bloqueio duplicado ----
  const fim1 = n.bloqueioFim;
  r = await emprestar(7);
  n = await nota();
  assert('Bloqueio não duplicado', n.bloqueioFim === fim1);

  // ---- 4. Simular fim do bloqueio (dataFim no passado): volta a poder emprestar, nota mantida ----
  const Database = (await import('better-sqlite3')).default;
  const db = new Database('biblioteca.db');
  console.log('  (debug) bloqueios antes:', JSON.stringify(db.prepare('SELECT id,dataFim,encerrado FROM bloqueios WHERE alunoId = ?').all(alunoId)));
  const upd = db.prepare("UPDATE bloqueios SET dataFim = date('now', '-1 day') WHERE alunoId = ?").run(alunoId);
  console.log('  (debug) linhas alteradas:', upd.changes);
  db.close();
  n = await nota();
  assert('Após 21 dias: desbloqueado, nota mantida (não volta a 5)', !n.bloqueado && n.nota < 3, `nota=${n.nota}`);

  // ---- 5. Empréstimo correto recupera gradualmente ----
  const antes = n.nota;
  r = await emprestar(7);
  assert('Desbloqueado consegue emprestar', r.status === 201);
  await devolver(r.data.id, -1, 'Bom'); // adiantado, mesmo estado => +0,08
  n = await nota();
  assert('Recuperação gradual (+0,08 por empréstimo correto)', n.nota > antes && n.nota - antes <= 0.1, `${antes} -> ${n.nota}`);

  // ---- 6. Estado pior penaliza; mesmo estado não ----
  r = await emprestar(7, 'Ótimo');
  await devolver(r.data.id, -1, 'Regular'); // adiantado, mas piorou 1 nível => +0,08 -0,25 = -0,17
  n = await nota();
  const depoisPiorou = n.nota;
  assert('Devolver em estado pior penalizou', depoisPiorou < antes, `${antes} -> ${depoisPiorou}`);
  r = await emprestar(7, 'Bom');
  await devolver(r.data.id, -1, 'Bom'); // adiantado, mesmo estado => só bônus
  n = await nota();
  assert('Mesmo estado não penalizou', n.nota > depoisPiorou, `${depoisPiorou} -> ${n.nota}`);

  // ---- 7. Nova queda => novo bloqueio com nova data ----
  for (let i = 0; i < 4; i++) {
    const e = await emprestar(7);
    await devolver(e.data.id, 23, 'Bom');
  }
  const p2 = await emprestar(7);
  await devolver(p2.data.id, 9, 'Bom');
  n = await nota();
  assert('Nova queda abaixo de 3,0', n.nota < 3, `nota=${n.nota}`);
  assert('Novo bloqueio iniciado com nova data', n.bloqueado && n.bloqueioFim !== fim1, `fim antigo=${fim1} novo=${n.bloqueioFim}`);
  const diff = Math.round((new Date(n.bloqueioFim) - new Date(iso(new Date()))) / 86400000);
  assert('Bloqueio dura exatamente 21 dias', diff === 21, `diff=${diff}`);

  // ---- 8. Histórico ----
  const hist = (await req('GET', `/api/alunos/${alunoId}/historico-avaliacao`)).data;
  assert('Histórico: 2 bloqueios registrados', hist.filter(h => h.tipo === 'bloqueio_iniciado').length === 2, hist.filter(h => h.tipo === 'bloqueio_iniciado').length + ' bloqueios');
  assert('Histórico: eventos de estado e prazo', hist.some(h => h.tipo === 'estado_piorou') && hist.some(h => h.tipo === 'devolucao_atrasada') && hist.some(h => h.tipo === 'devolucao_prazo'));

  console.log('\n=== Resumo final ===');
  console.log(`Nota final: ${n.nota} ${n.estrelas} — ${n.situacao} até ${n.bloqueioFim}`);
})();

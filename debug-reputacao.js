const db = require('./db');
const conn = db();
const { calcularReputacao } = require('./services/reputacao');
const aluno = conn.prepare("SELECT * FROM alunos WHERE nome = 'QA DoisNove'").get();
console.log('aluno:', aluno.id, aluno.nome);
const emps = conn.prepare('SELECT id, livroId, dataRetirada, dataLimite, dataDevolucao, devolvido, estadoSaida, estadoDevolucao FROM emprestimos WHERE alunoId = ? ORDER BY id').all(aluno.id);
for (const e of emps) {
  const atraso = e.devolvido && e.dataLimite ? Math.ceil((new Date(e.dataDevolucao + 'T00:00:00') - new Date(e.dataLimite + 'T00:00:00')) / 86400000) : null;
  console.log(JSON.stringify({ id: e.id, ret: e.dataRetirada, lim: e.dataLimite, dev: e.dataDevolucao, devolvido: e.devolvido, estadoSaida: e.estadoSaida, estadoDevolucao: e.estadoDevolucao, diasAtraso: atraso }));
}
console.log('rep:', JSON.stringify(calcularReputacao(conn, aluno.id)));

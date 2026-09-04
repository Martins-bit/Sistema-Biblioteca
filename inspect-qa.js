const db = require('./db')();
const al = db.prepare("SELECT id,nome FROM alunos WHERE nome LIKE 'QA %'").all();
for (const a of al) {
  const es = db.prepare('SELECT id,devolvido,dataLimite,dataDevolucao,estadoSaida,estadoDevolucao FROM emprestimos WHERE alunoId=?').all(a.id);
  if (es.length) console.log(a.nome, JSON.stringify(es));
}

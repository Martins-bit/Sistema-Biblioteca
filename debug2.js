const Database = require('better-sqlite3');
const db = new Database('biblioteca.db', { readonly: true });
const a = db.prepare("SELECT id FROM alunos WHERE nome='QA DoisNove'").get();
const es = db.prepare('SELECT id,estadoSaida,estadoDevolucao,dataLimite,dataDevolucao,devolvido FROM emprestimos WHERE alunoId=? ORDER BY id').all(a.id);
for (const e of es) console.log(e.id, 'limite=' + e.dataLimite, 'dev=' + e.dataDevolucao, 'devolvido=' + e.devolvido, e.estadoSaida + '->' + e.estadoDevolucao);

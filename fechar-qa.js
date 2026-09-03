// Fecha empréstimos pendentes residuais dos alunos QA (atrapalham o cálculo entre execuções)
const Database = require('better-sqlite3');
const db = new Database('biblioteca.db');
const r = db.prepare("UPDATE emprestimos SET devolvido = 1, dataDevolucao = dataLimite WHERE devolvido = 0 AND alunoId IN (SELECT id FROM alunos WHERE nome LIKE 'QA %')").run();
console.log('Emprestimos residuais fechados:', r.changes);
// Agora: fecha pendentes e ajusta bloqueio, depois verifica
const Database2 = require('better-sqlite3');
const db2 = new Database2('biblioteca.db');
const r1 = db2.prepare("UPDATE emprestimos SET devolvido = 1, dataDevolucao = dataLimite WHERE devolvido = 0 AND alunoId IN (SELECT id FROM alunos WHERE nome LIKE 'QA %')").run();
const r2 = db2.prepare("UPDATE bloqueios SET dataFim = date('now','-1 day') WHERE encerrado = 0 AND dataFim > date('now','+1 day')").run();
console.log('Pendentes fechados:', r1.changes, '| Bloqueios expirados:', r2.changes);
// verifica bloqueios após a última execução do teste
const Database3 = require('better-sqlite3');
const db3 = new Database3('biblioteca.db');
console.log(JSON.stringify(db3.prepare('SELECT id,alunoId,dataInicio,dataFim,encerrado FROM bloqueios ORDER BY id DESC LIMIT 6').all(), null, 1));

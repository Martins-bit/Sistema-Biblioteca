const Database = require('better-sqlite3');
const db = new Database('biblioteca.db');
const tx = db.transaction(() => {
  db.prepare("DELETE FROM historico_avaliacao WHERE alunoId IN (SELECT id FROM alunos WHERE nome LIKE 'QA %')").run();
  db.prepare("DELETE FROM bloqueios WHERE alunoId IN (SELECT id FROM alunos WHERE nome LIKE 'QA %')").run();
  db.prepare("DELETE FROM emprestimos WHERE alunoId IN (SELECT id FROM alunos WHERE nome LIKE 'QA %')").run();
  db.prepare("DELETE FROM emprestimos WHERE livroId IN (SELECT id FROM livros WHERE titulo LIKE 'QA Livro%')").run();
  db.prepare("DELETE FROM alunos WHERE nome LIKE 'QA %'").run();
  db.prepare("DELETE FROM livros WHERE titulo LIKE 'QA Livro%'").run();
});
tx();
console.log('Dados de QA limpos.');

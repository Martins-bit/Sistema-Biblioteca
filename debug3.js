const D = require('better-sqlite3');
const db = new D('biblioteca.db');
console.log(JSON.stringify(db.prepare('SELECT * FROM bloqueios ORDER BY id DESC LIMIT 4').all(), null, 1));
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());

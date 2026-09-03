const db = require('./db');
const c = db();
console.log('users:', JSON.stringify(c.prepare('SELECT id, username, email FROM users').all()));
console.log('tabelas:', c.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).join(','));

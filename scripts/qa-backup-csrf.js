// scripts/qa-backup-csrf.js - verifica que o backup continua funcionando com o CSRF da Etapa 5
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIRROR = path.join(os.tmpdir(), `qa-bk-${Date.now()}`);
const PORT = '3985'; const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(MIRROR, { recursive: true });
  for (const it of ['server.js','db.js','middleware','routes','services','public','package.json','scripts'])
    if (fs.existsSync(path.join(ROOT, it))) fs.cpSync(path.join(ROOT, it), path.join(MIRROR, it), { recursive: true });
  try { fs.symlinkSync(path.join(ROOT,'node_modules'), path.join(MIRROR,'node_modules'), 'junction'); }
  catch (_) { fs.cpSync(path.join(ROOT,'node_modules'), path.join(MIRROR,'node_modules'), { recursive: true }); }
  require(path.join(MIRROR,'scripts','create-user.js')).criarUsuario({ nome:'QA', email:'qa@escola.exemplo', senha:'QaSenha123' });

  const srv = spawn(process.execPath, ['server.js'], { cwd: MIRROR, env: { ...process.env, PORT, SESSION_SECRET: 'qa' }, stdio:['ignore','pipe','pipe'] });
  srv.stdout.on('data',()=>{}); srv.stderr.on('data',()=>{});
  for (let i=0;i<40;i++){ await sleep(250); try{ const r=await fetch(`${BASE}/api/auth/session`); if(r.status===401||r.ok) break; }catch(_){} }
  let cookie='', csrf=null, passou=0, falhou=0;
  const ok=(n)=>{passou++;console.log('  OK  '+n);};
  const no=(n,e)=>{falhou++;console.log('  XX  '+n+' -> '+e);};
  const ver=(n,c,d)=>c?ok(n):no(n,d===undefined?'falso':d);
  async function req(url, opts={}) {
    const headers={...(opts.headers||{})};
    if(cookie) headers['Cookie']=cookie;
    if(opts.json) headers['Content-Type']='application/json';
    const method=(opts.method||'GET').toUpperCase();
    if(['POST','PUT','PATCH','DELETE'].includes(method) && csrf) headers['X-CSRF-Token']=csrf;
    const res=await fetch(`${BASE}${url}`,{method,headers,body:opts.json?JSON.stringify(opts.json):undefined});
    const all=res.headers.getSetCookie?res.headers.getSetCookie():[];
    for(const c of all){ if(/^connect\.sid=/.test(c)) cookie=c.split(';')[0]; }
    let data=null; try{data=await res.json();}catch(_){}
    return {status:res.status,data};
  }
  const c=await req('/api/auth/csrf'); csrf=c.data.csrfToken;
  const lg=await req('/api/auth/login',{method:'POST',json:{email:'qa@escola.exemplo',password:'QaSenha123'}});
  ver('login', lg.status===200);
  const c2=await req('/api/auth/csrf'); csrf=c2.data.csrfToken;
  const st=await req('/api/backup/status'); ver('GET /api/backup/status => 200', st.status===200, String(st.status));
  const li=await req('/api/backup/lista'); ver('GET /api/backup/lista => 200', li.status===200 && Array.isArray(li.data.backups), JSON.stringify(li.data).slice(0,80));
  const cr=await req('/api/backup/criar',{method:'POST'}); ver('POST /api/backup/criar (com CSRF) => 200', cr.status===200 && cr.data.ok, JSON.stringify(cr.data));
  ver('backup criado com .db', cr.data.backup && /\.db$/.test(cr.data.backup.arquivo));
  const cfg=await req('/api/backup/config'); ver('GET /api/backup/config => 200', cfg.status===200);
  console.log(`\n=== Backup+CSRF: Passou ${passou} | Falhou ${falhou} ===`);
  srv.kill(); await sleep(300);
  for (let t=0;t<5;t++){ try{ fs.rmSync(MIRROR,{recursive:true,force:true}); break; }catch(_){ await sleep(300);} }
  process.exit(falhou===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});

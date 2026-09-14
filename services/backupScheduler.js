// services/backupScheduler.js
// Agendador do backup automático.
//
// Por que não um setInterval simples:
// - Um setInterval disparado a cada X ms faria o backup no meio do uso, sem
//   verificar a última execução, e voltaria a rodar tudo de novo após um
//   reinício do servidor (podendo criar vários backups seguidos).
// - Aqui guardamos a "última execução" em disco (backups/config.json). Na
//   inicialização e em cada tique verificamos se já passou o intervalo devido
//   (diário/semanal). Assim, reiniciar o servidor não gera backup duplicado.
// - O próprio serviço de backup impede duas operações simultâneas.

const backup = require('./backup');

const INTERVALO_VERIFICACAO_MS = 30 * 60 * 1000; // verifica a cada 30 minutos
let timer = null;

async function verificarEExecutar(dbGetter) {
  const cfg = backup.lerConfig();
  if (!backup.precisaExecutarAutomatico(cfg)) return;

  // Não concorre com backup manual / restauração em andamento.
  if (backup.operacaoAtual()) return;

  backup.iniciarOperacao('backup-automatico');
  try {
    const conn = dbGetter();
    const meta = await backup.criarBackupArquivo(conn, 'automatico');
    backup.salvarConfig({ ultimaExecucao: new Date().toISOString() });
    backup.aplicarRetencao();
    console.log(`💾 Backup automático criado: ${meta.arquivo}`);
  } catch (e) {
    console.error('Falha no backup automático:', e.message);
  } finally {
    backup.finalizarOperacao();
  }
}

// dbGetter: função que devolve a conexão compartilhada (o `db()` do db.js).
function iniciar(dbGetter) {
  if (timer) return;
  // Checagem imediata no startup: cobre o caso de o servidor ter ficado
  // desligado e o intervalo já ter vencido.
  verificarEExecutar(dbGetter).catch(() => {});
  timer = setInterval(() => {
    verificarEExecutar(dbGetter).catch(() => {});
  }, INTERVALO_VERIFICACAO_MS);
  // Não segura o processo apenas por causa do timer.
  if (timer.unref) timer.unref();
}

function parar() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { iniciar, parar, verificarEExecutar };

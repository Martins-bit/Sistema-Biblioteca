// services/bloqueio.js
// Regra de bloqueio por avaliação:
//  - Nota < 3,0  => bloqueio temporário de 21 dias (3 semanas)
//  - Durante o bloqueio o aluno NÃO pode realizar novos empréstimos (validado no backend)
//  - Ao final das 3 semanas volta a emprestar, mantendo a nota atual
//  - A recuperação da nota é gradual (ver services/reputacao.js) — vem do histórico real
//  - Se cair abaixo de 3,0 novamente APÓS o bloqueio anterior ter sido encerrado,
//    um novo bloqueio de 21 dias é iniciado (nunca dois bloqueios ativos simultâneos)

const DIAS_BLOQUEIO = 21;
const NOTA_MINIMA = 3.0;

function hojeISO() {
  return new Date().toISOString().split('T')[0];
}

function adicionarDias(iso, dias) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

function paraData(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function difDias(deISO, ateISO) {
  const a = paraData(deISO);
  const b = paraData(ateISO);
  if (!a || !b) return 0;
  return Math.ceil((b - a) / 86400000);
}

/**
 * Retorna o bloqueio ativo do aluno, se houver (encerrado por data OU por flag).
 */
function bloqueioAtivo(conn, alunoId) {
  const hoje = hojeISO();
  // Encerra automaticamente bloqueios vencidos (idempotente)
  conn.prepare(
    "UPDATE bloqueios SET encerrado = 1 WHERE alunoId = ? AND encerrado = 0 AND dataFim < ?"
  ).run(alunoId, hoje);

  return conn.prepare(
    'SELECT * FROM bloqueios WHERE alunoId = ? AND encerrado = 0 AND dataFim >= ? ORDER BY id DESC LIMIT 1'
  ).get(alunoId, hoje) || null;
}

/**
 * Registra evento no histórico da avaliação do aluno.
 */
function registrarHistorico(conn, alunoId, tipo, descricao, notaAnterior = null, notaNova = null) {
  conn.prepare(
    'INSERT INTO historico_avaliacao (alunoId, tipo, descricao, notaAnterior, notaNova) VALUES (?, ?, ?, ?, ?)'
  ).run(alunoId, tipo, descricao, notaAnterior, notaNova);
}

/**
 * Verifica a situação do aluno e cria bloqueio se necessário.
 * Deve ser chamada no backend antes de permitir novos empréstimos.
 *
 * @returns {{bloqueado:boolean, nota:number, estrelas:string, situacao:string,
 *            dataFim?:string, diasRestantes?:number, dataInicio?:string}}
 */
function verificarSituacao(conn, alunoId, rep) {
  const hoje = hojeISO();
  const ativo = bloqueioAtivo(conn, alunoId);

  if (ativo) {
    const diasRestantes = Math.max(0, difDias(hoje, ativo.dataFim));
    return {
      bloqueado: true,
      nota: rep.nota,
      estrelas: rep.estrelas,
      situacao: 'Bloqueado temporariamente',
      dataInicio: ativo.dataInicio,
      dataFim: ativo.dataFim,
      diasRestantes,
      motivo: ativo.motivo
    };
  }

  // Sem bloqueio ativo: se nota < 3,0, inicia novo bloqueio de 21 dias
  if (rep.nota < NOTA_MINIMA) {
    const dataFim = adicionarDias(hoje, DIAS_BLOQUEIO);
    const motivo = `Avaliação abaixo de ${NOTA_MINIMA.toFixed(1).replace('.', ',')} estrelas no momento do bloqueio`;
    const anterior = conn.prepare(
      'SELECT id FROM bloqueios WHERE alunoId = ? AND encerrado = 1 ORDER BY id DESC LIMIT 1'
    ).get(alunoId);
    const ordem = anterior ? 'novo' : 'primeiro';

    conn.prepare(
      'INSERT INTO bloqueios (alunoId, dataInicio, dataFim, motivo, notaNoBloqueio, encerrado) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(alunoId, hoje, dataFim, motivo, rep.nota);

    registrarHistorico(
      conn, alunoId, 'bloqueio_iniciado',
      `${ordem === 'novo' ? 'Novo bloqueio' : 'Bloqueio'} iniciado: avaliação ${rep.nota.toFixed(1).replace('.', ',')} ★ (${motivo}). Liberado a partir de ${dataFim.split('-').reverse().join('/')}.`,
      rep.nota, rep.nota
    );

    return {
      bloqueado: true,
      nota: rep.nota,
      estrelas: rep.estrelas,
      situacao: 'Bloqueado temporariamente',
      dataInicio: hoje,
      dataFim,
      diasRestantes: DIAS_BLOQUEIO,
      motivo
    };
  }

  // Não bloqueado
  let situacao;
  if (rep.nota >= 4.5) situacao = 'Excelente';
  else if (rep.nota >= 3.5) situacao = 'Boa';
  else situacao = 'Regular';

  return { bloqueado: false, nota: rep.nota, estrelas: rep.estrelas, situacao };
}

/**
 * Registra no histórico o encerramento de um bloqueio (chamado quando expira).
 */
function registrarFimDeBloqueioSeEncerrado(conn, alunoId, notaAtual) {
  const hoje = hojeISO();
  const encerradoAgora = conn.prepare(
    "SELECT * FROM bloqueios WHERE alunoId = ? AND encerrado = 0 AND dataFim < ? ORDER BY id DESC LIMIT 1"
  ).get(alunoId, hoje);
  if (encerradoAgora) {
    registrarHistorico(
      conn, alunoId, 'bloqueio_encerrado',
      `Bloqueio encerrado em ${hoje.split('-').reverse().join('/')}. Avaliação atual: ${notaAtual.toFixed(1).replace('.', ',')} ★. Novos empréstimos liberados.`,
      notaAtual, notaAtual
    );
  }
}

module.exports = {
  DIAS_BLOQUEIO,
  NOTA_MINIMA,
  bloqueioAtivo,
  verificarSituacao,
  registrarHistorico,
  registrarFimDeBloqueioSeEncerrado
};

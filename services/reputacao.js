// services/reputacao.js
// Regra centralizada de cálculo da reputação (avaliação em estrelas) dos alunos.
// A nota vai de 1,0 a 5,0 e é calculada a partir do histórico REAL de empréstimos.
//
// Comportamentos positivos:
//   - devolver no prazo ............ +0,05
//   - devolver antes do prazo ...... +0,08 (no total, com o bônus de prazo)
// Comportamentos negativos (graduais):
//   - devolver atrasado ............ -0,25 fixo -0,02 por dia de atraso (teto -0,50)
//   - devolver em estado pior ...... -0,25 por nível de conservação piorado
//   - devolver "Danificado" ........ -0,25 adicionais
//   - empréstimo ativo vencido ..... -0,15 (enquanto não devolver)
//
// Ordem de conservação: Novo > Ótimo > Bom > Regular > Danificado
// Importante: um livro que já saiu em condição ruim NÃO penaliza o aluno;
// apenas a DETERIORAÇÃO em relação à saída é penalizada.

const NIVEL_CONSERVACAO = {
  'Novo': 5,
  'Ótimo': 4,
  'Bom': 3,
  'Regular': 2,
  'Danificado': 1
};

const ESTADOS_CONSERVACAO = Object.keys(NIVEL_CONSERVACAO);

const NOTA_MAX = 5.0;
const NOTA_MIN = 1.0;

function hojeISO() {
  return new Date().toISOString().split('T')[0];
}

function paraData(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function clampNota(n) {
  return Math.max(NOTA_MIN, Math.min(NOTA_MAX, n));
}

function arredondar(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Converte uma nota decimal (1.0–5.0) em estrelas visuais.
 * 4.2 -> "★★★★☆"
 */
function notaParaEstrelas(nota) {
  const n = Math.max(0, Math.min(5, Number(nota) || 0));
  const cheias = Math.round(n); // arredondamento para meia estrela visual
  return '★'.repeat(cheias) + '☆'.repeat(5 - cheias);
}

/**
 * Calcula a reputação de um aluno com base em todo o histórico de empréstimos.
 * @param {Database} db  instância better-sqlite3
 * @param {number} alunoId
 * @returns {{nota:number, estrelas:string, total:number, concluidos:number,
 *           ativos:number, atrasos:number, devolvidosNoPrazo:number,
 *           devolvidosAntes:number, devolvidosAtrasados:number,
 *           deterioracoes:number, ativosVencidos:number}}
 */
function calcularReputacao(db, alunoId) {
  const emprestimos = db.prepare(
    'SELECT * FROM emprestimos WHERE alunoId = ?'
  ).all(alunoId);

  const hoje = hojeISO();

  let bonus = 0;
  let penalidade = 0;

  let devolvidosNoPrazo = 0;
  let devolvidosAntes = 0;
  let devolvidosAtrasados = 0;
  let deterioracoes = 0;
  let ativosVencidos = 0;

  for (const e of emprestimos) {
    const devolvido = !!e.devolvido;

    if (!devolvido) {
      // Empréstimo ativo vencido penaliza gradualmente enquanto pendente
      if (e.dataLimite && String(e.dataLimite).slice(0, 10) < hoje) {
        ativosVencidos += 1;
        penalidade += 0.15;
      }
      continue;
    }

    // ---- Prazo ----
    const limite = paraData(e.dataLimite);
    const dev = paraData(e.dataDevolucao);
    if (limite && dev) {
      if (dev.getTime() < limite.getTime()) {
        devolvidosAntes += 1;
        devolvidosNoPrazo += 1;
        bonus += 0.08; // antecipada
      } else if (dev.getTime() === limite.getTime()) {
        devolvidosNoPrazo += 1;
        bonus += 0.05; // no prazo
      } else {
        const diasAtraso = Math.ceil((dev - limite) / 86400000);
        devolvidosAtrasados += 1;
        penalidade += Math.min(0.50, 0.25 + diasAtraso * 0.02);
      }
    }
    // Sem dataLimite registrada: não julga prazo (neutro)

    // ---- Conservação ----
    const nivelSaida = NIVEL_CONSERVACAO[e.estadoSaida] || null;
    const nivelDevolucao = NIVEL_CONSERVACAO[e.estadoDevolucao] || null;
    if (nivelSaida && nivelDevolucao && nivelDevolucao < nivelSaida) {
      const niveisPiorou = nivelSaida - nivelDevolucao;
      deterioracoes += 1;
      penalidade += niveisPiorou * 0.25;
      if (String(e.estadoDevolucao) === 'Danificado') {
        penalidade += 0.25; // dano severo
      }
    }
    // Mesmo estado (ou melhor): nenhuma penalização
  }

  const notaBruta = NOTA_MAX + bonus - penalidade;
  const nota = arredondar(clampNota(notaBruta));

  return {
    nota,
    estrelas: notaParaEstrelas(nota),
    total: emprestimos.length,
    concluidos: emprestimos.filter(e => e.devolvido).length,
    ativos: emprestimos.filter(e => !e.devolvido).length,
    atrasos: devolvidosAtrasados,
    devolvidosNoPrazo,
    devolvidosAntes,
    devolvidosAtrasados,
    deterioracoes,
    ativosVencidos
  };
}

/**
 * Calcula reputação para todos os alunos (usado em listagens e rankings).
 * Retorna array ordenado por nome, cada item com estatísticas do histórico.
 */
function calcularReputacaoTodos(db) {
  const alunos = db.prepare('SELECT * FROM alunos ORDER BY nome').all();
  return alunos.map(a => ({
    ...a,
    ...calcularReputacao(db, a.id)
  }));
}

module.exports = {
  NIVEL_CONSERVACAO,
  ESTADOS_CONSERVACAO,
  calcularReputacao,
  calcularReputacaoTodos,
  notaParaEstrelas
};
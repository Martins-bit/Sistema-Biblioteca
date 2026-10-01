# GUIA DA ESCOLA — Sistema da Biblioteca (Etapa 12)
Para a bibliotecária: instalar, usar e cuidar do sistema. Sem programação.

## 1. Requisitos mínimos (reais do projeto)
- **PC:** Windows 10/11 64 bits, 4 GB RAM, ~150 MB livres
  (fonte ~1 MB + banco ~1 MB + `node_modules` ~48 MB + backups ~1 MB cada).
- **Node.js 22+** (recomendado **v24 LTS**, https://nodejs.org).
  O `better-sqlite3@13` **exige** Node >= 22.
- **Navegador:** Chrome/Edge atual (Firefox ok).
- **Internet: OPCIONAL.** Uso diário é todo `http://localhost:3000`.
  Só precisa para: `npm install` (1ª vez), busca **ISBN**
  (BrasilAPI → Google Books → Open Library) e baixar o Node.
  Sem internet: cadastro manual, empréstimos, DED e backup funcionam.
- **Leitor USB:** qualquer HID "keyboard wedge" (sem driver): ele "digita" o
  código + Enter no modal (foco automático, anti-duplicada).
- **Porta 3000** (`PORT=3001` se ocupada). Sem variáveis obrigatórias.
  Sem permissão de admin para usar (só p/ instalar o Node, uma vez).

## 2. Instalação (uma vez por PC)
1. Instale o Node.js 22+ (LTS).
2. Copie a pasta do sistema (`package.json` + `package-lock.json` juntos).
3. Duplo clique em **`INICIAR-BIBLIOTECA.bat`** (confere tudo e abre o navegador).
   Manual: `npm install` → `npm start` → `http://localhost:3000`.
4. Checagem: `node scripts/verificar-instalacao.js` (31 itens, só-leitura).
5. Crie a 1ª conta (sem cadastro público/senha padrão):
   `node scripts/create-user.js` (Nome, E-mail, Senha 8+ com letra+número).
6. Entre com e-mail + senha. Sessão dura 8h.

## 3. Uso diário
- **Alunos:** Novo (matrícula só números, opcional) ou DED:
  CSV/TXT/TSV ≤ 2 MB → mapear turmas → prévia → Confirmar (transacional).
- **Livros:** Novo manual ou **ISBN** (modal do leitor → autopreenche;
  sem internet, manual). Etiqueta QR `LIVRO:<id>:<titulo>`.
- **Empréstimo:** aluno + livro (ou bip), prazo padrão 7 dias.
  Bloqueado (nota < 3,0 por 21 dias) é recusado.
- **Devolução:** data + estado; atraso/piora ajusta a nota 1,0–5,0.
- **Consultas:** Estante, Ranking (leitores/reputação/salas), Relatórios
  (imprimir/PDF/CSV, salvar/apagar).
- **Perfil:** nome, e-mail/senha (pedem a atual); Personalização por usuária.
- **Fechar:** `Ctrl+C` na janela do servidor (tudo já salvo no `.db`).

## 4. Backup (faça TODA SEMANA)
- **Automático:** Backup → Diário/Semanal (10 automáticos máx; manuais e
  pré-restores nunca apagados sozinhos).
- **Manual:** "Criar backup agora" (`.db` consistente, nome
  `biblioteca-backup-AAAA-MM-DD-HHMM.db`). Baixe o `.db` p/ pen-drive.
  `backups/` não vai p/ o Git. Nunca copie o `.db` com servidor ligado (WAL).
- **Restaurar:** Validar arquivo (rejeita inválido sem tocar no atual) →
  Confirmar → **pré-restore automático** antes da troca.

## 5. Se der errado (1 minuto cada)
- **Porta em uso** (`EADDRINUSE :3000`): feche o outro programa ou
  `set PORT=3001 && npm start` → `http://localhost:3001`.
- **Loop login↔index:** use UMA janela/porta (duas = sessões diferentes).
- **"E-mail ou senha inválidos"** (genérica de propósito): confira o e-mail;
  10 erros/15min bloqueiam o IP (429). Conta nova só via script.
- **ISBN não achou:** sem internet ou fora das 3 bases → manual.
- **DED rejeitado:** CSV/TXT/TSV, matrícula só números, mapeie turmas novas.
- **Banco ok?** `node -e "console.log(require('better-sqlite3')('biblioteca.db',{readonly:true}).prepare('PRAGMA integrity_check').get())"` → `ok`.

## 6. NÃO faça (protege seus dados)
1. Não mexa em `biblioteca.db`, `backups/`, `.session-secret`.
2. Não rode `test-*`, `qa-*`, `debug*.js`, `fechar-qa.js` no PC da escola.
3. Nunca commite `biblioteca.db`. Não abra `public/*.html` por duplo clique
   (`file://` não loga). Não exponha na internet sem HTTPS + `NODE_ENV=production`.
4. Legados na raiz (`*.php`, `check-db.js`, `debug*.js`, `server.err`,
   `page.png`, `qa*.mjs`) não são usados — remoção opcional e segura.

## 7. Nota técnica (p/ o responsável pelo commit)
- Novos: `INICIAR-BIBLIOTECA.bat`, `scripts/verificar-instalacao.js`, este guia.
- `biblioteca.db` NÃO está no `.gitignore` — nunca commite; cada escola gera o
  seu no 1º start (migrations idempotentes). Recomendado depois:
  `git rm --cached biblioteca.db` + ignorar `*.db` (sem executar agora).
- `GOOGLE_*`/`BASE_URL` no `.env.example` são legados (OAuth removido).
- Valide com `node scripts/qa-syntax.js` e suítes `qa-*`/`etapa*` em espelho `%TEMP%`.

# GUIA DA ESCOLA — Sistema da Biblioteca (Etapa 13.1)
Para a bibliotecária: instalar, usar e cuidar do sistema. Sem programação.

## 1. Requisitos mínimos (reais do projeto)
- **PC:** Windows 10/11 64 bits, 4 GB RAM, ~150 MB livres
  (fonte ~1 MB + banco ~1 MB + `node_modules` ~48 MB + backups ~1 MB cada).
- **Node.js 22+** (recomendado **v24 LTS**, https://nodejs.org).
  O `better-sqlite3@13` **exige** Node >= 22.
- **Navegador:** Chrome/Edge atual (Firefox ok).
- **Internet: OPCIONAL.** Uso diário é todo no endereço
  `http://biblioteca.localhost` (ou `http://localhost:3000`, que sempre vale).
  Só precisa para: `npm install` (1ª vez), busca **ISBN**
  (BrasilAPI → Google Books → Open Library) e baixar o Node.
  Sem internet: cadastro manual, empréstimos, DED e backup funcionam.
- **Leitor USB:** qualquer HID "keyboard wedge" (sem driver): ele "digita" o
  código + Enter no modal (foco automático, anti-duplicada).
- **Porta 3000** (`PORT=3001` se ocupada). A porta **80** é usada *se* puder
  (para abrir sem o `:3000`); se não, tudo continua funcionando.
  Não é preciso administrador para USAR (só para instalar o Node, uma vez).

## 2. Instalação (uma vez por PC)
1. Instale o Node.js 22+ (LTS).
2. Copie a pasta completa do sistema para o computador
   (mantendo `package.json` e `package-lock.json` juntos).
3. Duplo clique em **`CRIAR-ATALHO.bat`** — cria o atalho
   **`Sistema da Biblioteca`** na Área de Trabalho (opcional, sem admin).
4. Duplo clique em **`INICIAR-BIBLIOTECA.bat`** (ou no atalho) — confere
   tudo, inicia o servidor e abre o navegador no melhor endereço.
   Manual: `npm install` → `npm start` → `http://localhost:3000`.
5. Checagem: `node scripts/verificar-instalacao.js` (só-leitura, não toca
   no banco; avisos não são erro).
6. Crie a 1ª conta (sem cadastro público/senha padrão):
   `node scripts/create-user.js` (Nome, E-mail, Senha 8+ com letra+número).
7. Entre com e-mail + senha. Sessão dura 8h.

## 3. Uso diário
- **Ligar:** duplo clique no atalho **`Sistema da Biblioteca`** (ou em
  `INICIAR-BIBLIOTECA.bat`). Se o sistema já estiver ligado, o launcher
  **não cria segunda instância** — só abre o navegador.
- **Endereço principal:** `http://biblioteca.localhost` — fica salvo no
  navegador; é só abrir. **Fallback:** `http://localhost:3000`.
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
- **Fechar:** duplo clique em **`ENCERRAR-BIBLIOTECA.bat`** — encerra só o
  servidor do sistema (tudo já salvo no `.db`). Alternativa: `Ctrl+C` na
  janela do servidor.

## 4. Backup (faça TODA SEMANA)
- **Automático:** Backup → Diário/Semanal (10 automáticos máx; manuais e
  pré-restores nunca apagados sozinhos).
- **Manual:** "Criar backup agora" (`.db` consistente, nome
  `biblioteca-backup-AAAA-MM-DD-HHMM.db`). Baixe o `.db` p/ pen-drive.
  `backups/` não vai p/ o Git. Nunca copie o `.db` com servidor ligado (WAL).
- **Restaurar:** Validar arquivo (rejeita inválido sem tocar no atual) →
  Confirmar → **pré-restore automático** antes da troca.

## 5. Se der errado (1 minuto cada)
- **`http://biblioteca.localhost` não abre:** confira se o servidor está no ar
  (o launcher avisa) e use `http://localhost:3000` — sempre funciona.
- **Navegador avisou "conexão insegura" ou tentou HTTPS:** não deve acontecer
  em `*.localhost` (é tratado como loopback pelo navegador); se acontecer,
  atualize o navegador ou use `http://localhost:3000`.
- **Endereço com `:3000` no fim (`biblioteca.localhost:3000`):** a porta 80
  está ocupada por outro programa — é normal; o fallback
  `http://localhost:3000` também vale.
- **Porta em uso** (`EADDRINUSE :3000`): feche o outro programa ou
  `set PORT=3001 && npm start` → `http://localhost:3001`.
- **Abriu o lançador 2 vezes:** sem problema — ele detecta o sistema já
  ligado e só abre o navegador.
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
- Etapa 13: `INICIAR-BIBLIOTECA.bat` (evita dupla instância + espera da
  resposta do servidor), `ENCERRAR-BIBLIOTECA.bat` +
  `scripts/encerrar-servidor.ps1` (encerra pelo PID gravado em
  `.servidor.pid`, que está no `.gitignore`),
  `CRIAR-ATALHO.bat` + `scripts/criar-atalho.ps1`
  (atalho na Área de Trabalho do usuário, sem admin; usa
  `[System.Char]::ConvertFromUtf32` para o emoji 📚, com fallback sem emoji),
  `server.js` (segundo listener na porta 80 — mesma instância Express,
  desligável com `PORTA80=0` —, gravação de PID e handlers SIGINT/SIGTERM),
  `scripts/verificar-instalacao.js` (checa arquivos da Etapa 13/13.1).
- Etapa 13.1: endereço principal trocado para `http://biblioteca.localhost`
  (o navegador resolve `*.localhost` para 127.0.0.1 — RFC 6761 —, sem
  hosts/admin e sem tentar HTTPS). `CONFIGURAR-BIBLIOTECA-LOCAL.bat` foi
  removido: não há mais configuração administrativa.
- `biblioteca.db` NÃO está no `.gitignore` — nunca commite; cada escola gera o
  seu no 1º start (migrations idempotentes). Recomendado depois:
  `git rm --cached biblioteca.db` + ignorar `*.db` (sem executar agora).
- `GOOGLE_*`/`BASE_URL` no `.env.example` são legados (OAuth removido).
- Valide com `node scripts/qa-syntax.js` e suítes `qa-*`/`etapa*` em espelho `%TEMP%`.

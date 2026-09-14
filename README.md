# Sistema da Biblioteca 📚

Sistema completo e moderno para gestão de biblioteca escolar, controle de acervo, alunos, empréstimos e devoluções, com backend em Node.js + Express, banco de dados SQLite e interface web interativa.

---

## 🧭 Navegação (páginas independentes)

| Página | Função |
|---|---|
| 🏠 **Dashboard** | Painel resumo: livros, disponíveis/emprestados, alunos, empréstimos ativos/atrasados, devoluções do dia e recentes |
| 👨 **Alunos** | Cadastro/edição com dropdown de turmas e avaliação em estrelas |
| 📖 **Livros** | Cadastro/edição com URL de capa, busca e ordenações |
| 📚 **Estante** | Acervo em cards com capa, autor, categoria e status |
| 🔄 **Empréstimos** | Empréstimos/devoluções com estado de conservação do livro |
| 📊 **Relatórios** | Relatórios reais com período, impressão/PDF, CSV e backup |
| 🏆 **Ranking** | Alunos (mais leitores / melhor reputação) e salas/turmas |

## ⭐ Reputação dos alunos (1,0 a 5,0)

Calculada automaticamente no backend (`services/reputacao.js`) pelo histórico real:
- **Positivo:** devolver no prazo (+0,05) ou antes (+0,08).
- **Negativo gradual:** atraso (−0,25 −0,02/dia, teto −0,50), livro devolvido pior (−0,25/nível; "Danificado" −0,25 extras), empréstimo ativo vencido (−0,15).
- Conservação: **Novo > Ótimo > Bom > Regular > Danificado** — só a deterioração em relação à saída penaliza.
- Exibição: ★★★★☆ 4,2.

## 🏫 Conservação, turmas e capas

- **Conservação:** estado na saída e na devolução (Novo/Ótimo/Bom/Regular/Danificado) + observações, vinculados ao empréstimo e visíveis no Histórico; devolução pior é destacada visualmente.
- **Turmas:** dropdown centralizado no backend (`services/turmas.js`, `GET /api/turmas`): 6°A–3°B; valores antigos são normalizados.
- **Capas:** URL opcional no livro; Estante em cards com placeholder padrão.
- **Ranking de salas:** por período (geral/mês/ano/personalizado) com dados reais.
- **Relatórios:** gerar/imprimir/CSV/apagar — todos funcionais com dados reais.

---

## ✨ Novidades e Funcionalidades Implementadas

### 1. 🛡️ Confirmação com Recomendação de Backup ao Apagar Tudo
- **Modal de Confirmação Crítica**: Ao clicar no botão *"Apagar tudo"*, o sistema exibe uma janela de alerta destacando o impacto da ação e o número exato de registros (livros, alunos, empréstimos e relatórios) que seriam removidos.
- **Recomendação de Backup Automático**: Destaque para o botão *"💾 Fazer Backup e Apagar"*, que baixa automaticamente um arquivo `.json` com todos os dados antes de limpar o banco/armazenamento.
- **Prevenção contra Exclusões Acidentais**: O botão de exclusão direta exige confirmação extra.

### 2. 📷 Leitor de Código de Barras / QR Code para Cadastro e Empréstimo
- **Cadastro Ágil por Código / ISBN**: O formulário tradicional de cadastro de livros foi mantido integralmente e complementado pelo botão *"📷 Ler QR / Código de Barras (ISBN)"*.
- **Leitura via Câmera ou Leitor USB**: Permite ler com a webcam/câmera do celular ou digitar/bipar o código com leitor óptico USB.
- **Autopreenchimento Inteligente**: Ao escanear o ISBN de um livro novo, o sistema busca automaticamente em bases públicas (Google Books, Open Library, BrasilAPI) e preenche Título, Autor e Categoria.
- **Etiquetas com QR Code**: Cada livro cadastrado pode ter sua etiqueta gerada e impressa para identificação física no acervo.

### 3. 📥 Cadastro de Alunos com Dados do DED (Diário Escolar Digital)
- **Importação Direta por Copiar e Colar**: Permite colar tabelas ou listas copiadas diretamente do portal DED (Diário Escolar Digital).
- **Suporte a Arquivos CSV / TXT**: Permite carregar arquivos de turmas exportados do DED.
- **Reconhecimento Automático de Colunas**: Identifica automaticamente o nome do aluno e a respectiva turma, filtrando cabeçalhos e números de matrícula/diário.
- **Pré-visualização e Controle de Duplicados**: Exibe uma tabela prévia dos alunos encontrados antes de salvar, com opção de ignorar automaticamente alunos já cadastrados no sistema.

### 4. 🔍 Barra de Pesquisa e Ordenação Personalizada de Livros
- **Busca em Tempo Real**: Campo de pesquisa integrado para filtrar livros instantaneamente por título, autor ou categoria.
- **Modos de Ordenação e Agrupamento**:
  - 🔤 **Ordem Alfabética (A - Z)**: Ordena os livros em ordem alfabética de título.
  - 🔤 **Ordem Alfabética (Z - A)**: Ordena em ordem decrescente de título.
  - 📚 **Separar por Tema / Categoria**: Agrupa visualmente os livros por suas respectivas categorias (Romance, Aventura, Fantasia, História, etc.) com divisores temáticos e contadores.
  - 📈 **Mais Emprestados**: Destaca os livros mais procurados e lidos da biblioteca com base no histórico real de empréstimos.
  - 📉 **Menos Emprestados**: Ordena pelos livros com menor índice de empréstimos, facilitando ações pedagógicas de incentivo à leitura.
  - ✍️ **Autor (A - Z)**: Agrupa e ordena por nome do autor.
  - 🟢 **Mais Disponíveis**: Ordena pelos títulos com maior quantidade de exemplares disponíveis no momento.

---

## 💾 Backup, Restauração e Segurança dos Dados (Etapa 4)

O sistema gera backups **consistentes** do banco SQLite e permite restaurá-los
com segurança total, sem risco de perder ou corromper os dados.

### Formato e onde ficam
- **Formato:** arquivos `.db` (SQLite) — cópia **consistente** do banco, gerada pela
  API de *online backup* do próprio SQLite via `better-sqlite3` (`db.backup()`).
  Isso evita a cópia ingênua do arquivo, que poderia capturar um estado
  inconsistente por causa do modo **WAL** e de transações em andamento.
- **Pasta:** `backups/` (não versionada — está no `.gitignore`).
- **Nome:** `biblioteca-backup-AAAA-MM-DD-HHMM.db` (compatível com Windows — sem `:`).
  Se o nome já existir, recebe um sufixo `-2`, `-3`, … — **nenhum backup é sobrescrito**.
- **Metadados:** cada backup tem um `*.db.meta.json` ao lado com data/hora, tipo e as
  contagens (livros, alunos, empréstimos, relatórios).

### Backup manual
1. Em **Relatórios → 💾 Backup dos Dados**, clique em **“Fazer backup agora”**.
2. O sistema mostra *“Criando backup...”*, cria a cópia consistente, **ida o
   arquivo** e só então registra o sucesso.
3. Em caso de erro, mostra *“Não foi possível criar o backup.”* (sem stack trace).

O painel exibe **Último backup** (data/hora) e o **Histórico** (data/hora,
 tamanho e tipo — manual/automático). Também é possível **baixar** cada backup
 interno e ainda **baixar um JSON** completo do estado atual.

### Backup automático
- Configurável no painel: **Desativado / Diário / Semanal**.
- Não usa `setInterval` ingênuo: guarda a **última execução** em disco e verifica
   na inicialização e periodicamente se o intervalo venceu. Assim, **reiniciar o
   servidor não duplica backups**.
- **Nunca há dois backups ao mesmo tempo**: existe um controle de operação em
   andamento (backup × restauração).

### Retenção
- Backups **automáticos**: mantidos os **10 mais recentes**; os excedentes são removidos.
- Backups **manuais e pre-restore**: **nunca** são apagados automaticamente
   (incluindo arquivos que a bibliotecária baixou).

### Restauração (segura)

Fluxo na interface (**Relatórios → Restaurar backup**):

1. Selecionar um arquivo `.db` ou um backup interno da lista;
2. **Validar arquivo** — verifica se é realmente um backup do Sistema da Biblioteca;
3. Ver o resumo (tamanho e contagens) e **confirmar**:
   *“Restaurar este backup substituirá os dados atuais da biblioteca. Deseja continuar?”*
4. O sistema cria automaticamente um **PRE-RESTORE** do estado atual; se ele
   falhar, a restauração é **cancelada**;
5. Só então o banco é substituído e a conexão é reaberta.

### Validação dos arquivos
Não confia na extensão. Abre o arquivo, confere o cabeçalho SQLite, lê o schema
 e exige as tabelas essenciais: **users, alunos, livros, emprestimos**. Recusa
 arquivo **vazio**, **corrompido**, **banco de outro sistema**, **JSON inválido**
 ou **estrutura incompatível** — sempre com a mensagem:

> Este arquivo não é um backup válido do Sistema da Biblioteca.

Em qualquer erro, **o banco atual não é alterado**. Backup em JSON antigo continua
 aceito pelo modo **Importar** (que apenas adiciona registros, sem substituir).

### Segurança do banco (`biblioteca.db`)

- Backup e restauração **nunca** apagam/zeram o banco real fora do fluxo explícito de restauração.
- **“Fazer backup”** e **“Apagar tudo”** são ações **separadas** — fazer backup
  nunca apaga dados automaticamente. A exclusão total exige confirmação própria.
- Arquivos temporários de QA/validação são removidos ao final de cada operação.

### Rotas da API (todas autenticadas)

| Método | Rota | Função |
|---|---|---|
| GET | `/api/backup/status` | Último backup, config e operação atual |
| GET | `/api/backup/lista` | Histórico de backups internos |
| POST | `/api/backup/criar` | Cria um backup consistente (.db) agora |
| GET | `/api/backup/arquivo/:nome` | Baixa um arquivo de backup |
| GET/PUT | `/api/backup/config` | Lê/atualiza config do backup automático |
| POST | `/api/backup/validar` | Valida um arquivo enviado (sem restaurar) |
| POST | `/api/backup/restaurar` | Restaura (exige `confirmar=1`) |
| GET/POST | `/api/backup` | Exportar / Importar JSON |
| DELETE | `/api/backup?confirmar=1` | Apaga todos os dados (exige confirmação) |

---

## 🚀 Como Executar o Projeto

1. Certifique-se de ter o [Node.js](https://nodejs.org) (recomendado: v24) instalado.
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Inicie o servidor:
   ```bash
   npm start
   ```
4. Acesse no navegador:
   ```
   http://localhost:3000
   ```
5. Credenciais de acesso:
   - **Usuário:** `admin`
   - **Senha:** `1234`

---

## 📁 Estrutura do Projeto

```
sistema-biblioteca/
├── server.js              # Servidor Express (rotas, sessão, estáticos)
├── db.js                  # Inicialização do SQLite, tabelas e migrations
├── biblioteca.db          # Banco de dados SQLite local
├── services/
│   ├── turmas.js          # Lista canônica de turmas + normalização
│   ├── reputacao.js       # Cálculo das estrelas (reputação dos alunos)
│   ├── backup.js          # Backups consistentes, validação, retenção, pre-restore
│   └── backupScheduler.js # Agendador do backup automático (diário/semanal)
├── routes/
│   ├── auth.js            # Login, logout e sessão
│   ├── alunos.js          # Alunos + reputação
│   ├── livros.js          # Livros + capa
│   ├── emprestimos.js     # Empréstimos + conservação
│   ├── turmas.js          # GET /api/turmas (dropdown)
│   ├── dashboard.js       # GET /api/dashboard (resumo)
│   ├── ranking.js         # Rankings de alunos e salas por período
│   ├── relatorios.js      # Relatórios salvos
│   └── backup.js          # Backup/restauração, histórico, config e limpeza
├── backups/               # Backups internos (.db) — NÃO versionado
├── scripts/               # Harnesses de QA do backup (qa-backup*.js, qa-ui-backup*.mjs)
├── middleware/
│   └── requireAuth.js     # Proteção de rotas autenticadas
└── public/                # Front-end da aplicação
    ├── login.html         # Tela de login
    ├── index.html         # Aplicação principal (Dashboard, Prateleira, etc.)
    └── assets/
        └── js/
            ├── app.js     # Lógica do sistema e interação
            ├── ui.js      # Funções de interface, prazos e modais
            ├── storage.js # Persistência e backup
            └── vendor/
                ├── qrcode.min.js       # Gerador de QR Code local
                └── html5-qrcode.min.js # Leitor de QR/Barcode via câmera
```

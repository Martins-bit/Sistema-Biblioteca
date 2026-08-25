# Sistema da Biblioteca 📚

Sistema completo e moderno para gestão de biblioteca escolar, controle de acervo, alunos, empréstimos e devoluções, com backend em Node.js + Express, banco de dados SQLite e interface web interativa.

---

## ✨ Novidades e Funcionalidades Implementadas

### 1. 🛡️ Botão "Apagar Tudo" Seguro com Aviso de Backup
- **Confirmação Protegida**: Substituição de exclusão direta por um modal de confirmação com visual de alerta crítico.
- **Opção Recomendada com Backup Automático**: O botão *"💾 Fazer Backup e Apagar"* realiza o download imediato de um arquivo JSON completo com todos os dados do sistema antes de efetuar a limpeza.
- **Opção sem Backup com Confirmação Extra**: Previne exclusões acidentais por duplo consentimento.

### 2. 🔔 Central de Notificações e Gestão de Prazos de Devolução
- **Cálculo Automático de Prazos**: Monitoramento em tempo real de empréstimos com status inteligente:
  - 🔴 **Vencido (X dias em atraso)**
  - 🟡 **Vence Hoje / Vence Amanhã**
  - ⏳ **Vencendo em Breve**
  - 🟢 **No Prazo**
- **Sino de Notificações na Topbar**: Ícone com contador e efeito de pulso indicando a quantidade de empréstimos pendentes de atenção.
- **Banner de Alerta no Dashboard**: Destaque visual informando quantos alunos estão em atraso.
- **Aviso Rápido via WhatsApp**: Botão *"📲 Aviso"* que gera e copia automaticamente uma mensagem educada pronta para envio ao aluno ou responsável.
- **Filtros por Status na Tabela de Empréstimos**: Filtre instantaneamente por *Todos*, *⚠️ Vencidos*, *⏳ Vencendo em Breve*, *🟢 No Prazo* e *⚪ Devolvidos*.

### 3. 📷 Leitor de QR Code e Código de Barras (ISBN)
- **Scanner via Câmera Integrada**: Leitura em tempo real utilizando a câmera do computador ou smartphone (comutação entre câmera frontal e traseira).
- **Busca Automática de Livros por ISBN**: Ao escanear o código de barras de um livro físico (ou digitar/ler via leitor USB), o sistema consulta automaticamente APIs públicas (BrasilAPI, Google Books e Open Library) preenchendo título, autor e categoria automaticamente!
- **Leitura nos Empréstimos**: Escaneie o QR Code do livro ou do aluno para preencher o formulário de empréstimo instantaneamente.
- **🏷️ Gerador e Impressor de Etiquetas QR**: Cada livro do acervo pode ter sua etiqueta gerada e impressa diretamente para colagem na lombada física.

### 4. 📚 Prateleira Virtual (Virtual Bookshelf)
- **Visualização em Estantes de Madeira 3D**: Apresentação visual do acervo com lombadas de livros personalizadas por gênero/categoria, ícones temáticos, relevo e indicador de disponibilidade.
- **Visualização em Modo Catálogo (Grid)**: Grade moderna de capas de livros com metadados e estatísticas de cópias.
- **Organização Flexível pelo Administrador**:
  - **Agrupar por**: Gênero/Categoria, Autor, Disponibilidade ou Estante Única.
  - **Ordenar por**: Ordem Alfabética de Título (A-Z / Z-A), Autor (A-Z), Quantidade de Exemplares, Mais Recentes ou Mais Populares.
  - **Filtros Interativos**: Filtro de categoria, filtro de disponibilidade (Apenas disponíveis / Esgotados) e busca instantânea.
- **Modal de Detalhes do Livro**: Ao clicar em qualquer livro da prateleira, visualize a capa estilizada, histórico de empréstimos ativos, botão rápido para realizar empréstimo e geração de etiqueta.

---

## 🚀 Como Executar o Projeto

1. Certifique-se de ter o [Node.js](https://nodejs.org) (v18+) instalado.
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
├── db.js                  # Inicialização do SQLite e tabelas
├── biblioteca.db          # Banco de dados SQLite local
├── routes/
│   ├── auth.js            # Login, logout e sessão
│   ├── alunos.js          # Cadastro e gestão de alunos
│   ├── livros.js          # Cadastro e gestão de livros
│   └── emprestimos.js     # Empréstimos, prazos e devoluções
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

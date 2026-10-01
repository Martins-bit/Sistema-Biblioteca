# MANUAL DE USO — SISTEMA DA BIBLIOTECA

## 1. Sobre o sistema

O Sistema da Biblioteca foi desenvolvido para facilitar o gerenciamento da biblioteca escolar, permitindo controlar alunos, livros, empréstimos, devoluções, localização dos livros, relatórios, ranking e backups.

O sistema funciona localmente no computador da escola e pode ser utilizado mesmo sem conexão com a internet para as funções principais.

> ⚠️ **IMPORTANTE**
>
> Os dados da biblioteca são armazenados no sistema. Nunca apague, mova, renomeie ou altere manualmente arquivos do sistema, principalmente o arquivo `biblioteca.db`.
>
> Em caso de problema, não tente apagar o banco de dados. Anote o que aconteceu e informe o responsável pelo sistema.

## 2. Como iniciar o sistema

Normalmente, não é necessário abrir o terminal ou digitar comandos.

1. Localize o atalho do Sistema da Biblioteca na área de trabalho.
2. Abra o sistema.
3. O servidor será iniciado automaticamente.
4. O navegador será aberto.
5. A página de login será apresentada.

O endereço principal do sistema é:

```
http://biblioteca.localhost
```

Caso o navegador não abra automaticamente, o responsável pelo sistema poderá utilizar o endereço local configurado no computador.

## 3. Login

Ao abrir o sistema, será apresentada a tela de login.

Informe:

- E-mail
- Senha

Depois clique em **Entrar**.

### Caso a senha esteja incorreta

Será apresentada uma mensagem informando que não foi possível realizar o login.

- Confira os dados digitados.
- Se o problema continuar, entre em contato com o responsável pelo sistema.

**Importante:** não tente criar uma nova conta para substituir uma conta existente sem orientação.

## 4. Perfil

Cada bibliotecária possui seu próprio perfil.

No perfil é possível acessar as configurações pessoais disponíveis no sistema, incluindo opções de personalização da aparência.

As configurações de um usuário não devem alterar os dados da biblioteca utilizados pelos demais usuários.

## 5. Dashboard

O Dashboard é a página inicial do sistema.

Ele apresenta uma visão geral da biblioteca e facilita o acesso às principais áreas.

A navegação principal permite acessar:

- Dashboard
- Alunos
- Livros
- Estante
- Empréstimos
- Relatórios
- Ranking
- Backup
- Meu Perfil

A página ativa fica indicada no menu.

## 6. Alunos

A área Alunos é utilizada para cadastrar e consultar os estudantes da escola.

Cada aluno pode possuir informações como:

- nome;
- matrícula;
- turma;
- informações relacionadas aos empréstimos;
- reputação.

### 6.1 Cadastrar um aluno

Para cadastrar um novo aluno:

1. Acesse **Alunos**.
2. Clique na opção de adicionar/cadastrar aluno.
3. Preencha os dados solicitados.
4. Confira as informações.
5. Salve o cadastro.

Confira principalmente o nome, matrícula e turma antes de salvar.

### 6.2 Editar um aluno

Para alterar os dados:

1. Localize o aluno.
2. Abra a opção de edição.
3. Altere as informações necessárias.
4. Salve.

Evite criar um segundo cadastro para o mesmo aluno quando o correto for editar o cadastro existente.

## 7. Matrícula e turma

A matrícula ajuda a identificar corretamente cada estudante.

A turma também é utilizada em diferentes partes do sistema, incluindo consultas e informações relacionadas aos empréstimos e rankings.

Ao cadastrar ou editar um aluno, confira se a turma selecionada está correta.

## 8. Importação de alunos pelo DED

O sistema possui suporte para importação de alunos através de arquivo do DED.

Esse recurso deve ser utilizado com atenção.

O processo possui etapas de conferência antes da importação definitiva.

### Recomendações

Antes de confirmar uma importação:

1. Confira o arquivo utilizado.
2. Verifique os alunos apresentados.
3. Confira as turmas.
4. Verifique possíveis duplicidades.
5. Somente depois confirme a importação.

> ⚠️ **Não confirme uma importação se os dados apresentados estiverem incorretos.**

Em caso de dúvida sobre o arquivo do DED, consulte o responsável pelo sistema.

## 9. Livros

A área Livros permite cadastrar e gerenciar o acervo da biblioteca.

Um livro pode possuir informações como:

- título;
- autor;
- ISBN;
- categoria;
- gênero;
- classificação;
- localização;
- capa;
- disponibilidade.

## 10. Cadastro de um livro

Para cadastrar um livro:

1. Acesse **Livros**.
2. Clique para adicionar um livro.
3. Preencha as informações.
4. Confira os dados.
5. Salve o cadastro.

### Localização

A localização deve indicar onde o livro está fisicamente na biblioteca.

Exemplo:

```
ROMANCE-01
```

Isso significa:

- Estante: **ROMANCE**
- Posição: **01**

Essa informação é importante porque também pode ser utilizada para localizar rapidamente um livro na Estante Virtual.

## 11. ISBN e preenchimento automático

O sistema possui recurso de consulta de livros através do ISBN.

Quando disponível, o sistema pode buscar informações como:

- título;
- autor;
- categoria;
- gênero;
- capa.

### Como utilizar

1. Abra o cadastro de livro.
2. Utilize o campo de ISBN.
3. Digite ou faça a leitura do código.
4. Aguarde a consulta.
5. Confira as informações encontradas.
6. Complete ou corrija os campos locais, quando necessário.
7. Salve o livro.

> ⚠️ **Sempre confira as informações antes de salvar.**
>
> A consulta automática serve para facilitar o cadastro, mas as informações devem ser conferidas.

## 12. Leitor físico de código de barras

O sistema suporta leitores físicos USB que funcionam como teclado.

Não é necessário utilizar câmera ou webcam.

Para utilizar:

1. Conecte o leitor USB ao computador.
2. Abra o cadastro ou campo de leitura correspondente.
3. Faça a leitura do código do livro.
4. O leitor enviará o código automaticamente.
5. O sistema processará a informação.

Se o código corresponder a um ISBN válido, o sistema poderá realizar a consulta automática.

### Se o leitor não funcionar

Confira:

- se o USB está conectado;
- se o leitor está ligado;
- se o campo correto está aberto;
- se o código está legível.

Se continuar sem funcionar, não altere configurações do sistema. Informe o responsável.

## 13. Estante Virtual

A Estante Virtual permite visualizar o acervo de maneira organizada.

Os livros podem apresentar informações como:

- capa;
- título;
- autor;
- categoria;
- gênero;
- classificação;
- localização;
- disponibilidade.

### 13.1 Pesquisar um livro

Utilize o campo de pesquisa para procurar pelo livro.

A pesquisa pode ajudar a encontrar livros utilizando informações do cadastro, incluindo dados relacionados ao título, autor e localização.

### 13.2 Filtros

A Estante possui filtros para facilitar a consulta.

Entre eles estão opções relacionadas a:

- Categoria;
- Gênero;
- Classificação;
- Localização;
- Status/disponibilidade.

É possível combinar filtros para encontrar um conjunto específico de livros.

### 13.3 Localizar fisicamente um livro

Quando um livro possui localização cadastrada, essa informação pode ser utilizada para descobrir onde ele está na estante.

Exemplo:

```
ROMANCE-01
```

Procure:

**Estante ROMANCE → posição 01.**

Se um livro não possuir localização cadastrada, será necessário conferir o cadastro e a organização física da biblioteca.

## 14. Empréstimos

A área de Empréstimos é uma das principais funções do sistema.

O fluxo principal é:

1. Aluno → 2. Situação/Reputação → 3. Livro → 4. Retirada/Conservação

## 15. Realizando um empréstimo

### Passo 1 — Selecionar o aluno

Comece procurando o estudante.

O campo permite pesquisar e selecionar o aluno.

Confira:

- nome;
- turma;
- matrícula;
- situação;
- reputação.

### Passo 2 — Conferir situação e reputação

Depois de selecionar o aluno, o sistema apresenta informações relacionadas à situação dele.

Confira se existe algum bloqueio antes de continuar.

Se o aluno estiver impedido de realizar empréstimos, o sistema deverá informar a situação.

Não tente contornar um bloqueio criando outro cadastro para o mesmo aluno.

### Passo 3 — Selecionar o livro

Pesquise o livro pelo campo correspondente.

O sistema apresenta as opções disponíveis.

Livros indisponíveis não devem ser escolhidos para um novo empréstimo.

Confira o título antes de continuar.

### Passo 4 — Retirada e conservação

Informe as informações solicitadas sobre a retirada e o estado de conservação do livro.

Confira o estado físico do livro antes de entregá-lo ao aluno.

Depois confirme o empréstimo.

## 16. Cuidados durante o empréstimo

Antes de confirmar:

- confira o aluno;
- confira o livro;
- confira o estado de conservação;
- confira as informações apresentadas.

Isso evita registrar um empréstimo para o aluno ou livro errado.

## 17. Devolução

Quando um aluno devolver um livro:

1. Localize o empréstimo.
2. Confira o aluno.
3. Confira o livro.
4. Registre a devolução.
5. Informe o estado de conservação atual.
6. Confirme a devolução.

O estado de conservação informado na devolução é importante para o histórico e para o sistema de reputação.

## 18. Estado de conservação

Ao retirar e devolver um livro, observe sua condição.

Confira se o livro apresenta alterações em relação ao estado registrado anteriormente.

Se houver alguma alteração, registre corretamente a condição apresentada pelo sistema.

Não marque uma condição diferente apenas para concluir rapidamente o empréstimo.

## 19. Sistema de reputação e estrelas

O sistema possui uma funcionalidade de reputação dos alunos relacionada ao comportamento nos empréstimos.

A pontuação considera fatores como:

- devolução dentro do prazo;
- condição do livro na devolução;
- atrasos;
- conservação do material.

O sistema utiliza essas informações para atualizar a reputação do aluno.

Alunos com reputação abaixo do limite definido pelo sistema podem sofrer bloqueio temporário para novos empréstimos.

A reputação também pode ser recuperada conforme novos empréstimos sejam realizados corretamente.

## 20. Relatórios

A área Relatórios apresenta informações gerais da biblioteca.

Ela pode auxiliar a bibliotecária a acompanhar:

- livros;
- empréstimos;
- devoluções;
- atrasos;
- alunos;
- movimentação do acervo;
- outras informações disponíveis no sistema.

### 20.1 Filtros dos relatórios

Quando disponíveis, utilize os filtros para alterar o período ou conjunto de informações apresentado.

Confira os resultados após aplicar um filtro.

Se precisar voltar à visualização anterior, utilize a opção de limpar/redefinir os filtros disponível na página.

## 21. Ranking

A área Ranking apresenta informações relacionadas aos empréstimos.

Ela pode ser utilizada para consultar dados de alunos e turmas relacionados à utilização da biblioteca.

Os rankings devem ser interpretados como informações do sistema sobre os empréstimos registrados.

## 22. Backup

O sistema possui recursos de backup para proteger os dados da biblioteca.

O backup é uma cópia de segurança dos dados.

### Quando fazer backup?

É recomendado manter backups regularmente, especialmente antes de operações importantes.

O sistema também possui mecanismos de backup automático.

### 22.1 Backup manual

Quando necessário:

1. Acesse **Backup**.
2. Utilize a opção de backup disponível.
3. Aguarde a conclusão.
4. Confira se o backup foi criado corretamente.

Não feche o sistema durante uma operação de backup.

## 23. Restauração de backup

A restauração deve ser utilizada somente quando realmente necessário.

> ⚠️ **ATENÇÃO**
>
> Restaurar um backup altera os dados atuais do sistema.

Antes de restaurar:

1. Confira qual backup será utilizado.
2. Confirme a data do backup.
3. Verifique se ele é realmente o arquivo correto.
4. Faça a confirmação solicitada pelo sistema.

Se houver qualquer dúvida, não faça a restauração. Procure o responsável pelo sistema.

## 24. O que NÃO fazer

Para evitar perda de dados ou problemas no sistema:

### ❌ Não apagar `biblioteca.db`

Esse arquivo contém os dados da biblioteca.

### ❌ Não editar arquivos do sistema manualmente

Não altere arquivos `.js`, `.json`, `.html` ou outros arquivos do projeto sem orientação.

### ❌ Não apagar a pasta `backups`

Ela pode conter cópias importantes.

### ❌ Não instalar programas ou extensões desconhecidas para "consertar" o sistema

Em caso de problema, informe o responsável.

### ❌ Não criar cadastros duplicados para contornar problemas

Se um aluno ou livro já existe, procure o cadastro existente.

### ❌ Não desligar o computador durante uma operação de backup ou restauração

Aguarde a operação terminar.

## 25. Problemas comuns

### O sistema não abriu

Verifique se o sistema foi iniciado pelo atalho correto.

Se continuar sem abrir, entre em contato com o responsável.

### A página ficou carregando

Aguarde alguns segundos.

Se não resolver:

1. Não apague arquivos.
2. Não reinicie o banco.
3. Tire um print da tela.
4. Informe o responsável.

### O leitor USB não funcionou

Verifique a conexão USB e tente novamente.

Se continuar sem funcionar, informe o responsável.

### O ISBN não encontrou o livro

Isso pode acontecer quando o livro não possui informações disponíveis para consulta automática.

Nesse caso, o livro pode precisar ser cadastrado/completado manualmente.

Confira principalmente:

- título;
- autor;
- categoria;
- gênero;
- classificação;
- localização.

### Não consigo realizar um empréstimo

Confira:

- se o aluno está selecionado corretamente;
- se existe bloqueio;
- se o livro está disponível;
- se todos os campos necessários foram preenchidos.

Se o sistema apresentar uma mensagem de erro, tire um print e informe o responsável.

### Cadastrei algo errado

Não crie outro cadastro simplesmente para corrigir o problema.

Quando possível, utilize a opção de edição do cadastro existente.

## 26. Quando aparecer um erro

Essa é uma das orientações mais importantes para a utilização do sistema.

Se aparecer uma mensagem de erro:

1. Não apague o banco de dados.
2. Não reinstale o sistema por conta própria.
3. Tire um print da mensagem.
4. Anote o que você estava fazendo.
5. Se possível, anote qual aluno/livro/operação estava sendo realizada.
6. Informe o responsável pelo sistema.

Essas informações ajudam a identificar e corrigir o problema.

## 27. Rotina recomendada da bibliotecária

### Ao iniciar o trabalho

1. Inicie o Sistema da Biblioteca.
2. Faça login.
3. Confira se o Dashboard está carregando normalmente.

### Durante o atendimento

Use o sistema para:

**Aluno → consultar → empréstimo → registrar conservação**

ou

**Aluno → localizar empréstimo → devolução → registrar conservação**

### Ao cadastrar livros

Confira cuidadosamente:

**Título → autor → ISBN → categoria → gênero → classificação → localização**

### Ao finalizar

1. Confira se não existe nenhuma operação em andamento.
2. Faça o encerramento normal do sistema quando necessário.
3. Mantenha os backups preservados.

## 28. Fluxo rápido de empréstimo

Para consulta rápida:

```
1. Empréstimos
      ↓
2. Selecionar aluno
      ↓
3. Conferir reputação/situação
      ↓
4. Selecionar livro
      ↓
5. Conferir conservação
      ↓
6. Confirmar empréstimo
```

## 29. Fluxo rápido de devolução

```
1. Localizar empréstimo
      ↓
2. Conferir aluno e livro
      ↓
3. Registrar devolução
      ↓
4. Conferir conservação
      ↓
5. Confirmar
```

## 30. Regra principal

O sistema foi criado para facilitar o trabalho da biblioteca, mas os dados registrados precisam representar o que realmente aconteceu.

Por isso:

- confira o aluno;
- confira o livro;
- confira a conservação;
- confira a localização;
- confira os dados antes de salvar;
- não tente contornar bloqueios;
- não crie cadastros duplicados;
- não apague arquivos do sistema;
- mantenha os backups protegidos.

Em caso de dúvida, pare a operação e procure o responsável pelo sistema.

# Gráfica SaaS — V3 funcional

Sistema monolítico para gestão de gráfica: React/Vite + TypeScript no frontend, Node/Express + TypeScript no backend, Prisma + MySQL e PWA.

## Fluxos disponíveis

- Login da equipe
- Clientes: cadastro, listagem e ativação do portal
- Produtos: cadastro, preço, custo e estoque mínimo
- Orçamentos: criação, envio, aprovação e conversão em pedido + OP
- Pedidos: cadastro direto, listagem e avanço de status
- Produção: criação de OP, iniciar, concluir e retrabalho
- Estoque
- Fornecedores
- Compras
- Financeiro
- Artes
- Portal do cliente: login, pedidos e artes

## Como iniciar no Windows

1. Abra o Docker Desktop.
2. Abra esta pasta no VS Code.
3. Abra o terminal na pasta que contém `package.json`.
4. Execute:

```bat
iniciar-grafica.bat
```

Se preferir manualmente:

```bat
docker compose up -d
npm install
npm --prefix apps/server install
npm --prefix apps/web install
npm run db:push
npm run db:seed
npm run dev
```

Frontend: http://localhost:5173
API: http://localhost:3333

## Acesso da equipe

E-mail: `admin@grafica.local`
Senha: `123456`

## Acesso do cliente de demonstração

E-mail: `cliente@example.com`
Senha: `123456`

Na tela inicial existe o botão **Sou cliente e quero acessar o portal**.

## Fluxo recomendado para testar

1. Cadastre um cliente.
2. Cadastre um produto.
3. Crie um pedido diretamente em **Pedidos**; o sistema cria as OPs automaticamente.
4. Abra **Produção** e inicie/conclua a OP.
5. Como alternativa, crie um orçamento, envie, aprove e use **Gerar pedido + OP**.
6. Para um cliente acessar o portal, abra **Clientes**, selecione o cliente, informe uma senha e clique em **Ativar portal**.

## Segurança

Veja `SECURITY-AUDIT.md`. A versão inclui JWT, bcrypt, rate limit no login, Helmet, CORS configurável, validação Zod, isolamento por tenant e validação de uploads.

Esta é uma versão pronta para desenvolvimento/local. Para produção pública ainda devem ser configurados HTTPS, segredo JWT exclusivo, storage externo, backups, observabilidade, gestão de usuários e revisão de infraestrutura.

## Uso diário no Windows

Depois da primeira instalação, use apenas `ABRIR-GRAFICA.bat`. Ele:

- inicia o MySQL sem apagar os dados;
- verifica dependências apenas quando necessário;
- verifica/sincroniza o Prisma;
- evita iniciar uma segunda cópia se as portas 3333 e 5173 já estiverem ocupadas pelo sistema;
- inicia o servidor e o frontend quando necessário;
- espera os dois serviços ficarem online;
- abre o navegador automaticamente.

Para encerrar os processos da aplicação, use `PARAR-GRAFICA.bat`. O banco de dados permanece preservado.

## Funcionalidades revisadas

- Dashboard com atualização manual e valores a receber/a pagar
- Clientes e portal do cliente
- Produtos e estoque
- Orçamentos e conversão em pedido + OP
- Pedidos diretos
- Produção e status das OPs
- Fornecedores com cadastro completo
- Compras
- Financeiro: contas a receber e contas a pagar, incluindo baixa
- Artes: upload de PDF/PNG/JPG/WEBP/SVG até 10 MB, associação a cliente/pedido e aprovação
- Login com recuperação de sessão em falhas temporárias de rede
- Service worker atualizado para evitar cache antigo da interface

## Correção React
Esta versão corrige efeitos React que retornavam Promises (`useEffect must not return anything besides a function` / `destroy is not a function`). Os carregamentos assíncronos agora são disparados sem retornar a Promise ao React.

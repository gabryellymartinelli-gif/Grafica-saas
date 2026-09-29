# Auditoria de segurança e estabilidade — V3

## Corrigido nesta revisão

- JWT obrigatório nas rotas internas.
- Isolamento por `tenantId` nas consultas e alterações principais.
- Permissões por função nas rotas sensíveis.
- Rate limit nos logins interno e do portal.
- Helmet e CORS configurados.
- Limite de JSON de 15 MB.
- Upload limitado a 10 MB e tipos permitidos.
- Nome de arquivo sanitizado antes do armazenamento.
- Validação de entrada com Zod.
- Proteção contra saldo de estoque negativo.
- Proteção contra baixa financeira acima do saldo.
- Portal do cliente separado por token e `customerId`.
- Frontend não encerra a sessão em uma simples falha temporária de rede.
- Frontend faz uma tentativa automática adicional em falhas transitórias.
- Timeout de 15 segundos nas chamadas da API.
- Inicializador evita iniciar duas cópias do sistema nas portas 3333/5173.
- Service worker com versão de cache atualizada e limpeza de cache antigo.

## Limitações que continuam sendo importantes antes de produção pública

- O storage de artes ainda é local; para produção, usar S3/MinIO ou equivalente.
- O segredo JWT deve ser exclusivo por ambiente e mantido fora do repositório.
- MySQL deve ter backup automatizado e política de recuperação.
- HTTPS deve ser usado fora de ambiente local.
- Logs e monitoramento devem ser adicionados para operação real.
- Fiscal/NF-e/NFS-e não está implementado; isso exige integração e credenciais do provedor/fiscal.
- A versão local é adequada para desenvolvimento/operação interna, mas deve passar por revisão de infraestrutura antes de exposição pública.

## Revisão final para entrega
- Uploads deixaram de ser públicos por `/uploads`; agora são entregues por rotas autenticadas e limitadas ao tenant/cliente.
- Arquivos passam a persistir em `%USERPROFILE%\.grafica-saas\uploads`, fora da pasta versionada do projeto.
- O inicializador tenta recuperar uploads de versões anteriores encontradas ao redor da pasta do projeto.
- Sessões de equipe e portal usam `sessionStorage`, evitando reentrada automática após fechar a sessão do navegador.
- Financeiro valida cliente/fornecedor dentro do tenant e carrega listas de forma independente.
- JWT exige segredo com pelo menos 32 caracteres, senhas usam bcrypt, login tem rate limit, CORS é restrito ao frontend configurado e Helmet está habilitado.

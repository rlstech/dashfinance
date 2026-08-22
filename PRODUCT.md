# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Inferido do repositório; confirmar com o responsável pelo produto:** usuários internos da UAU que precisam acompanhar a operação financeira, incluindo a equipe financeira/tesouraria e pessoas responsáveis pelo acompanhamento de obras. Usuários administrativos gerenciam contas, empresas e permissões.

## Product Purpose

**Inferido do repositório:** o DashFinance centraliza o acompanhamento de contas a pagar, receitas, saldos bancários, fluxo de caixa e planejamento versus realizado por obra. O produto existe para dar visibilidade financeira consolidada às empresas da UAU e apoiar decisões operacionais sem depender de consultas manuais a múltiplas fontes.

## Positioning

**Inferido do repositório; prioridade ainda não confirmada:** o diferencial operacional é combinar dados financeiros de múltiplas empresas com planejamento por obra, realizado, agrupamentos compartilháveis e custo financeiro em uma única aplicação autenticada.

## Operating Context

- Aplicação web React/Vite acessada por usuários autenticados.
- O frontend abre num Dashboard de visão geral e oferece as áreas de Receitas, Despesas, Fluxo de Caixa, Fluxo-Obras, Configurações e Administração.
- Dados financeiros são sincronizados do Microsoft SQL Server e de arquivos Excel em compartilhamento SMB.
- Redis mantém o cache financeiro usado pelos endpoints de dados e pelos cálculos de realizado.
- PostgreSQL mantém autenticação, configuração, grupos de obras, planejamento e snapshots persistidos.
- O uso ocorre no contexto de empresas e obras da UAU, com filtros por período, empresa, banco, conta e demais dimensões financeiras.

## Capabilities and Constraints

- Login por e-mail e senha, com sessão baseada em token JWT.
- Usuários possuem empresas autorizadas; administradores têm acesso administrativo e podem gerenciar usuários.
- Grupos de obras possuem proprietário, compartilhamentos com permissões de visualização/edição e opção de incluir empresas inteiras.
- Planejamento mensal por obra deve reconciliar com o valor global da obra; o backend rejeita divergências.
- Fluxo-Obras compara valores previstos e realizados e permite persistir snapshots de realizado por grupo e período.
- Custo Financeiro agrega transferências e controle financeiro e classifica lançamentos conforme contas especiais/configuração do grupo.
- O Dashboard é a página inicial e consolida KPIs do período, fluxo de caixa mensal, alertas de vencimento e previsto versus realizado por grupo de obras, respeitando os mesmos filtros e permissões das demais áreas.
- Exportações de dados de Fluxo-Obras e tabelas pivot fazem parte do frontend.
- O cache Redis é a fonte dos endpoints de realizado financeiro; uma sincronização pode ser necessária quando os dados estiverem desatualizados.
- Falhas de uma fonte durante a sincronização são tratadas individualmente, mas a disponibilidade e atualidade dos dados dependem dos serviços externos configurados.
- A aplicação usa terminologia e formatos financeiros em português brasileiro e moeda BRL.
- Para o redesign, as prioridades confirmadas são leitura financeira, planejamento de obras, filtros/exploração e administração.
- O redesign deve preservar as regras e os cálculos existentes.
- O resultado não deve parecer um site de marketing; a interface deve continuar sendo uma ferramenta operacional.

## Brand Commitments

- Nome do produto: DashFinance.
- O código e a interface existentes usam português brasileiro para rótulos, mensagens e fluxos.
- O produto é associado à UAU e às empresas COMBRASEN, DRESDEN, TRUST, GAMA 01 e CONSÓRCIO HMSJ, conforme o mapeamento existente no backend.
- Nenhuma diretriz adicional de marca, logotipo, paleta ou tipografia foi confirmada durante este init.

## Evidence on Hand

- Rotas e limites do produto: `frontend/src/App.tsx`.
- Fluxo de autenticação: `frontend/src/pages/Login.tsx`, `frontend/src/hooks/useAuth.ts` e `backend/app/api/auth.py`.
- Modelo de usuários, empresas, grupos e permissões: `backend/app/models/auth.py` e `backend/app/deps/auth.py`.
- Áreas financeiras: `frontend/src/pages/Receitas.tsx`, `frontend/src/pages/Despesas.tsx`, `frontend/src/pages/FluxoCaixa.tsx` e `frontend/src/pages/FluxoObras.tsx`.
- Visão geral consolidada e suas regras de agregação: `frontend/src/pages/Dashboard.tsx` e `frontend/src/lib/finance.ts`.
- Fontes e persistência de dados: `backend/app/services/queries.py`, `backend/app/services/sync.py`, `backend/app/services/excel.py` e `backend/app/services/pg.py`.
- O repositório não fornece depoimentos, métricas de impacto ou outras provas externas; trabalhos futuros não devem fabricá-los.

## Product Principles

**Inferidos do comportamento e da arquitetura existentes:**

- Consolidar a visão financeira sem perder o recorte por empresa e obra.
- Tornar explícita a diferença entre planejamento, realizado e fonte dos dados.
- Restringir dados e ações de acordo com empresa, grupo e permissão do usuário.
- Preservar rastreabilidade para alterações de planejamento e snapshots financeiros.
- Tratar falhas de integração de forma isolada e comunicar quando a atualidade dos dados for relevante.

## Open Decisions

- Prioridade entre equipe financeira, gestores de obra e diretoria como público principal.
- Qual benefício deve liderar o posicionamento do produto: visão multiempresa, planejamento versus realizado ou substituição de planilhas.
- Diretrizes oficiais de marca e requisitos específicos de acessibilidade.

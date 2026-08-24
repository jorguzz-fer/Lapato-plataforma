# ADR 0007 — Guardian determinístico agora, Copiloto plugável

- Status: aceito
- Data: 2026-08-09

## Contexto

O Módulo 17 define três componentes de IA: **Copiloto** (produtividade e raciocínio),
**Memória Anatomopatológica** (recuperação contextual do conhecimento acumulado) e
**Guardian** (segurança, coerência e prevenção de erro).

Duas exigências da documentação moldam a decisão:

- **M17 §110–112, regra arquitetural:** o LAPATO deve continuar funcionando **sem IA** —
  cadastrar, descrever, processar, diagnosticar, assinar e liberar em modo manual, com
  indicador de indisponibilidade.
- **M17 §97:** dados clínicos não devem ser usados para treinamento sem regra institucional
  e autorização apropriada.

Analisando o que o Guardian precisa checar (identidade divergente, lateralidade cadastro ×
laudo, margem estruturada × texto, campo obrigatório vazio, bloco esgotado, coerência
numérica, checagem consolidada antes da assinatura), percebe-se que **quase nada disso
precisa de um modelo de linguagem**. São regras determinísticas sobre dados estruturados.

## Opções consideradas

1. **Guardian determinístico agora; Copiloto atrás de uma interface, com stub.**
2. **Integrar um LLM já nesta fase para tudo.** Contras: custo, governança de dados e
   superfície de segurança (injeção de prompt, vazamento entre tenants) antes de a base
   estar madura; e o Guardian ficaria não determinístico, o que é ruim para uma camada que
   **bloqueia** ações críticas.
3. **Adiar toda a camada de IA.** Contra: o painel 70/30 e o contrato de sugestões são
   estruturais na UX; retrofitá-los depois mexeria em todas as telas.

## Decisão

Opção 1.

- **Guardian** em `apps/api/src/core/guardian/`: motor de regras determinístico, sem LLM.
  Retorna achados nos quatro níveis padronizados do M17 §11: `informacao`, `sugestao`,
  `atencao`, `critico`. Achados críticos **bloqueiam** a ação (por exemplo, assinatura de
  laudo com lateralidade divergente do cadastro).
- **Copiloto** atrás da interface `CopilotProvider`, com implementação `stub` como padrão
  (`COPILOT_PROVIDER=stub`). A implementação real entra em fase posterior sem alterar as
  telas.
- **Contrato de sugestão** já persistido em `sugestao_ia` com os campos que o M17 §15 exige:
  contexto, nível, fontes consultadas, modelo e versão utilizados, e a ação posterior do
  usuário (aceita / editada / rejeitada / ignorada).
- **Painel lateral 70/30** implementado no shell do front desde já, retrátil, com conteúdo
  dinâmico por módulo — e não como chatbot genérico, conforme M17 §9.
- **Modo sem IA** é caminho testado, não teórico: há teste e2e que desliga o provedor e
  percorre o fluxo completo até a liberação do laudo.
- Nenhum dado clínico é enviado para treinamento. Quando o provedor real entrar, a
  minimização de dados do M17 §95 e a hierarquia de fontes do §99 são requisitos dele.

## Consequências

- O valor de segurança do Guardian chega já nesta fase, e é auditável e reproduzível —
  qualidade que um LLM não daria numa camada de bloqueio.
- A superfície de governança de IA (DPA com o provedor, política de retenção de prompts,
  anonimização, isolamento entre tenants no contexto enviado ao modelo) fica documentada
  como pré-requisito da fase que ligar o Copiloto real.
- O custo é uma indireção: as telas chamam `CopilotProvider`, não o modelo.

## Adendo — o provedor real ligado (2026-08)

`COPILOT_PROVIDER=claude` passou a existir de verdade: `CopilotoClaudeProvider`
fala com a API da Anthropic atrás da mesma interface `CopilotProvider`, e
nenhuma tela mudou para isso. Como os pré-requisitos listados acima foram
resolvidos:

- **Minimização de dados (M17 §95).** O contexto enviado ao modelo é montado
  campo a campo em `resumoDoCaso()` — espécie, raça, sexo, idade, serviço,
  amostras e histórico clínico. Nome de tutor, cliente, veterinário, contatos,
  microchip e até o nome do animal ficam fora: identificam sem acrescentar
  valor clínico. Adicionar um campo ao prompt é uma decisão de código revisável,
  nunca um spread de objeto do banco.
- **Isolamento entre instituições.** A consulta do resumo roda dentro de
  `comTenant`, sob a mesma RLS de qualquer outra consulta — o contexto de uma
  instituição não tem caminho até o prompt de outra.
- **Hierarquia de fontes (M17 §99).** O cartão declara `caso_atual` ou
  `conhecimento_externo`, num enum fechado validado na volta. Conhecimento
  geral não se disfarça de dado do caso.
- **Transparência e registro (M17 §§15 e 109).** Todo cartão apresentado é
  gravado em `sugestao_ia` com o modelo que respondeu (`resposta.model`), e o
  id do cartão é o id da linha — o feedback do usuário fecha o ciclo sobre o
  mesmo registro.
- **O LLM não bloqueia nada.** O schema de saída não aceita nível `critico`:
  travar ação segue sendo exclusivo do Guardian determinístico, que é auditável.
  A saída do modelo é validada com zod como entrada não confiável; cartão fora
  do contrato é descartado em silêncio.
- **Falha vira indisponibilidade, não erro.** Timeout, 429, 5xx e chave
  revogada retornam `disponivel: false`; o painel mostra o indicador do §110 e
  a bancada continua. O modo sem IA segue sendo o padrão dos testes.
- **Retenção e DPA (Blueprint §14).** A chamada usa a API padrão da Anthropic,
  que não treina em dados de API. A celebração de DPA e a política de retenção
  contratual são passo operacional de quem opera a instância, documentado no
  runbook — o código registra o modelo usado para tornar isso auditável.

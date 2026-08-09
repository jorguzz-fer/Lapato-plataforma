# Mapa de dados pessoais (LGPD)

> Nenhum dos arquivos `.docx` do LAPATO menciona LGPD. O `Engineering Blueprint.md` §14
> exige o tratamento. Este documento cobre a lacuna e é pré-requisito de go-live.

O LAPATO trata dados de **animais**, mas o sistema armazena dados pessoais de pessoas
físicas em várias camadas. Este é o mapa inicial, a ser revisado a cada módulo novo.

## Titulares e dados tratados

| Titular | Dados | Onde | Base legal sugerida |
|---|---|---|---|
| Tutor do paciente | Nome, contato, eventualmente CPF | `tutor` | Execução de contrato / legítimo interesse |
| Médico-veterinário solicitante | Nome, CRMV+UF, e-mail, telefone, especialidade | `veterinario` | Execução de contrato |
| Responsável do cliente | Nome, cargo, e-mail, telefone | `cliente_contato` | Execução de contrato |
| Usuário do sistema | Nome, CPF, e-mail, telefone, foto, dados profissionais, credenciais, sessões, IP | `usuario`, `sessao`, `audit_log` | Execução de contrato / obrigação legal |
| Pessoa física como cliente | Nome, CPF, endereço, contato | `cliente` (tipo tutor particular) | Execução de contrato |
| Terceiros captados em mídia | Voz em áudio de necropsia, pessoas em fotografias | `imagem`, áudio (fase futura) | Legítimo interesse, com minimização |

Diagnóstico e material biológico dizem respeito ao **animal** — não são dado pessoal do
tutor, mas a associação tutor↔paciente↔diagnóstico é dado pessoal por vínculo, e recebe o
mesmo cuidado.

## Princípios aplicados no código

- **Minimização.** Só se coleta o que a rotina exige. Campos como CPF do tutor e data de
  nascimento do usuário são opcionais no schema.
- **Finalidade.** Uso de casos para ensino, pesquisa, divulgação ou treinamento de modelo
  exige autorização explícita e anonimização (M16 e M17 §97). Armazenar imagem clínica
  **não** implica autorização de pesquisa.
- **Segurança.** TLS em trânsito; segredos em cofre; bucket privado com URL assinada curta
  emitida só após autorização; senha com Argon2id; MFA para papéis sensíveis.
- **Auditoria de acesso.** `audit_log` imutável registra quem acessou o quê e quando —
  atende tanto ao M22 quanto ao dever de prestação de contas.
- **Retenção.** `politica_retencao` (M01) parametriza prazos por tipo de material,
  documento, imagem e log. Descarte é registrado, não silencioso.
- **Sem dados sensíveis em log.** Logs são estruturados em JSON com `request_id`,
  `tenant_id` e `user_id`; conteúdo de campo pessoal não é logado em claro.

## Direitos do titular

Processo a implementar antes do go-live (não faz parte desta fase):

- **Acesso e portabilidade:** exportação dos dados de um titular em formato legível.
- **Correção:** já suportada pelo fluxo de correção cadastral, que preserva histórico.
- **Exclusão:** conflita com a obrigação de rastreabilidade e com a proibição de apagar
  registros do M01/M05/M22. O caminho é **anonimização do titular** preservando o registro
  técnico e a cadeia de custódia — e essa distinção precisa ser comunicada ao titular.

## Pendências

- [ ] **Residência de dados** — recomenda-se região Brasil. Vira ADR ao escolher hospedagem.
- [ ] **DPA** com cada terceiro que processar dados: provedor de nuvem, storage, provedor de
      modelo de IA, e-mail, WhatsApp, assinatura digital, emissão fiscal.
- [ ] Registro de consentimento para comunicações de marketing, se houver.
- [ ] Aviso de privacidade no Portal do Cliente.
- [ ] Definição do encarregado (DPO).

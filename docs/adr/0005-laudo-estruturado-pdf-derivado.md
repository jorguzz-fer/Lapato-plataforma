# ADR 0005 — O laudo é dado estruturado; o PDF é representação

- Status: aceito
- Data: 2026-08-09

## Contexto

O `MÓDULO 10 Laudos e microscopia.docx` §118–§119 é explícito:

> O PDF final será uma representação documental. O registro real do exame deverá continuar
> estruturado no banco de dados. Portanto: o PDF não será o laudo primário do sistema.

O mesmo documento (§120) exige versionamento dos **dados diagnósticos**, não apenas do
documento: se o diagnóstico mudar após um exame complementar, a evolução (v1 "Neoplasia de
células redondas" → v2 "Linfoma de grandes células B") precisa ser preservada.

O `MÓDULO 12 Histopatologia.docx` §120 reforça: sistemas de graduação devem preservar os
**critérios individuais**, não apenas o escore final, para permitir auditoria e
reprocessamento científico futuro.

## Opções consideradas

1. **PDF como artefato primário** — gerar e arquivar o documento assinado; o banco guarda
   metadados. Simples.
   Contras: impossibilita pesquisa estruturada ("quantos mastocitomas cutâneos caninos de
   baixo grau no último ano"), auditoria de critérios e alimentação da Memória
   Anatomopatológica. Contraria a documentação.
2. **Dados estruturados versionados como fonte de verdade; PDF derivado e imutável por
   versão.**
3. **Só dados estruturados, PDF gerado sob demanda toda vez** — perde a garantia de que o
   documento entregue ao cliente é byte a byte o que foi assinado.

## Decisão

Opção 2.

- `laudo` guarda o conteúdo estruturado; `laudo_versao` versiona esse conteúdo.
- A assinatura registra patologista, identificação profissional, data, hora, **versão do
  documento** e mecanismo de autenticação, conforme M11 §82.
- O PDF é **gerado a partir da versão** e congelado com hash. Uma versão assinada nunca é
  regerada com conteúdo diferente.
- **Adendo ≠ correção**: adendo acrescenta, correção retifica. Ambos criam nova versão e
  preservam a anterior; a versão anterior fica marcada como substituída.
- Diagnósticos ficam em campos estruturados (`diagnostico` com órgão, processo, entidade,
  comportamento, grau, distribuição, severidade, qualificadores) além do texto exibido.
- Classificações são versionadas: casos antigos preservam a versão vigente à época
  (M11 §42, M13).

## Consequências

- Geração de PDF é um passo derivado, não o coração do módulo — pode trocar de biblioteca
  sem afetar o dado.
- O front precisa editar campos estruturados **e** texto livre, que coexistem por exigência
  explícita da documentação (M13: "dados estruturados e descrição livre coexistem").
- Pesquisa estruturada, indicadores (M25) e Memória Anatomopatológica (M17) passam a ser
  possíveis sem reprocessar documentos.
- Custo: o modelo de laudo é mais complexo do que um blob de texto. É o custo de atender ao
  requisito.

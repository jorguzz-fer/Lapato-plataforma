import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  amostra,
  assinaturaProfissional,
  avaliacaoCitologica,
  caso,
  cassete,
  diagnostico,
  laudoVersao,
  margemMicroscopica,
  paciente,
  servico,
  type Transacao,
} from '@lapato/db';
import {
  BloqueioGuardianError,
  MODULOS,
  ordenarPorGravidade,
  type AchadoGuardian,
} from '@lapato/shared';
import { exigirContexto } from '../contexto/contexto-requisicao.js';

/**
 * LAPATO Guardian (M17).
 *
 * M17 secao 7: responde "existe algo potencialmente errado, incoerente,
 * incompleto ou perigoso neste momento?".
 *
 * **Deterministico, sem LLM** (ADR 0007). Tudo que a documentacao pede do
 * Guardian - identidade divergente, lateralidade cadastro x laudo, margem
 * estruturada x texto, campo obrigatorio vazio, coerencia numerica - e regra
 * sobre dado estruturado. Uma camada que BLOQUEIA acao critica precisa ser
 * reproduzivel e auditavel; um modelo probabilistico nao daria isso.
 *
 * M17 secao 11: quatro niveis. Apenas `critico` bloqueia; os demais informam e
 * deixam a decisao com o profissional - "a IA sugere; o profissional decide".
 */
@Injectable()
export class GuardianService {
  /**
   * Checagem consolidada antes da assinatura do laudo (M17 secao "checagem
   * consolidada antes da assinatura" + M11).
   *
   * Soma o conteudo do laudo a condicao de quem assina.
   */
  async verificarAssinaturaLaudo(
    tx: Transacao,
    laudoVersaoId: string,
    casoId: string,
    assinanteId: string,
  ): Promise<AchadoGuardian[]> {
    const achados = await this.verificarConteudoLaudo(tx, laudoVersaoId, casoId);
    achados.push(...(await this.verificarAssinatura(tx, assinanteId)));
    return ordenarPorGravidade(achados);
  }

  /**
   * Assinatura profissional ativa e valida de quem vai assinar (M02).
   *
   * Separada do conteudo porque as duas coisas sao verificadas em momentos
   * diferentes: o conteudo ja no envio para revisao, a assinatura so na hora de
   * assinar - quem elabora nem sempre e quem assina.
   */
  private async verificarAssinatura(
    tx: Transacao,
    assinanteId: string,
  ): Promise<AchadoGuardian[]> {
    const ctx = exigirContexto();
    const achados: AchadoGuardian[] = [];

    const assinaturas = await tx
      .select()
      .from(assinaturaProfissional)
      .where(
        and(
          eq(assinaturaProfissional.tenantId, ctx.tenantId),
          eq(assinaturaProfissional.usuarioId, assinanteId),
          eq(assinaturaProfissional.ativa, true),
        ),
      );

    const agora = new Date();
    if (!assinaturas.find((a) => !a.validoAte || a.validoAte > agora)) {
      achados.push({
        codigo: 'ASSINATURA_INEXISTENTE_OU_EXPIRADA',
        nivel: 'critico',
        mensagem:
          'O profissional não possui assinatura ativa e válida. Assinatura expirada ou inativa bloqueia a liberação.',
        modulo: MODULOS.M02_USUARIOS,
        comoResolver:
          'Um administrador cadastra a assinatura profissional em Usuários e Perfis, na ficha do profissional. Se ela existir mas estiver vencida, registre uma nova com a validade atualizada.',
      });
    }

    return achados;
  }

  /**
   * Completude e coerencia do laudo, sem olhar quem assina.
   *
   * Roda tambem no envio para revisao, e nao so na assinatura. Antes disso, um
   * laudo sem diagnostico atravessava a revisao inteira e so era barrado na
   * assinatura - onde o formulario ja e leitura. O usuario lia "adicione um
   * diagnostico nesta tela" numa tela que nao deixava mais adicionar nada.
   */
  async verificarConteudoLaudo(
    tx: Transacao,
    laudoVersaoId: string,
    casoId: string,
  ): Promise<AchadoGuardian[]> {
    const ctx = exigirContexto();
    const achados: AchadoGuardian[] = [];

    const [versao] = await tx
      .select()
      .from(laudoVersao)
      .where(and(eq(laudoVersao.tenantId, ctx.tenantId), eq(laudoVersao.id, laudoVersaoId)))
      .limit(1);

    if (!versao) {
      return [
        {
          codigo: 'LAUDO_VERSAO_INEXISTENTE',
          nivel: 'critico',
          mensagem: 'A versão do laudo não foi encontrada.',
          modulo: MODULOS.M11_LAUDOS,
          comoResolver:
            'Recarregue a tela do laudo. Se persistir, o laudo foi removido ou pertence a outro caso.',
        },
      ];
    }

    // --- Completude minima -------------------------------------------------
    const diagnosticos = await tx
      .select()
      .from(diagnostico)
      .where(
        and(
          eq(diagnostico.tenantId, ctx.tenantId),
          eq(diagnostico.laudoVersaoId, laudoVersaoId),
        ),
      );

    if (diagnosticos.length === 0) {
      achados.push({
        codigo: 'LAUDO_SEM_DIAGNOSTICO',
        nivel: 'critico',
        mensagem: 'O laudo não possui diagnóstico registrado.',
        modulo: MODULOS.M11_LAUDOS,
        comoResolver:
          'Adicione ao menos um diagnóstico no bloco “Diagnósticos”. Se o laudo já estiver aguardando assinatura, use “Retomar edição” para liberar o formulário.',
        campo: 'diagnostico',
      });
    }

    if (!versao.descricaoMicroscopica?.trim()) {
      achados.push({
        codigo: 'LAUDO_SEM_MICROSCOPIA',
        nivel: 'atencao',
        mensagem: 'A descrição microscópica está vazia.',
        modulo: MODULOS.M11_LAUDOS,
        comoResolver:
          'Preencha a descrição microscópica. Não é obrigatória para assinar, mas o laudo sai sem ela.',
        campo: 'descricaoMicroscopica',
      });
    }

    if (diagnosticos.some((d) => d.provisorio)) {
      achados.push({
        codigo: 'DIAGNOSTICO_PROVISORIO',
        nivel: 'critico',
        mensagem:
          'Existe diagnóstico marcado como provisório. Diagnóstico provisório não equivale a liberado.',
        modulo: MODULOS.M11_LAUDOS,
        comoResolver:
          'Desmarque “provisório” no diagnóstico, ou remova-o. Provisório é rascunho, não conclusão.',
      });
    }

    achados.push(...(await this.verificarLateralidade(tx, casoId, laudoVersaoId)));
    achados.push(...(await this.verificarMargens(tx, laudoVersaoId, versao.conteudo)));
    achados.push(...(await this.verificarCitologia(tx, casoId, laudoVersaoId, diagnosticos)));

    return ordenarPorGravidade(achados);
  }

  /**
   * M17: "lateralidade - cadastro 'direito' x laudo 'esquerdo' = alerta
   * critico". Trocar o lado num laudo tem consequencia cirurgica real, por isso
   * e o exemplo que a documentacao classifica no nivel mais alto.
   */
  private async verificarLateralidade(
    tx: Transacao,
    casoId: string,
    laudoVersaoId: string,
  ): Promise<AchadoGuardian[]> {
    const ctx = exigirContexto();
    const achados: AchadoGuardian[] = [];

    const amostras = await tx
      .select({ id: amostra.id, lateralidade: amostra.lateralidade, ident: amostra.identificador })
      .from(amostra)
      .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.casoId, casoId)));

    const diagnosticos = await tx
      .select({
        amostraId: diagnostico.amostraId,
        lateralidade: diagnostico.lateralidade,
        texto: diagnostico.textoExibido,
      })
      .from(diagnostico)
      .where(
        and(
          eq(diagnostico.tenantId, ctx.tenantId),
          eq(diagnostico.laudoVersaoId, laudoVersaoId),
        ),
      );

    for (const d of diagnosticos) {
      if (!d.amostraId || d.lateralidade === 'nao_aplicavel') continue;

      const origem = amostras.find((a) => a.id === d.amostraId);
      if (!origem || origem.lateralidade === 'nao_aplicavel') continue;

      if (origem.lateralidade !== d.lateralidade) {
        achados.push({
          codigo: 'LATERALIDADE_DIVERGENTE',
          nivel: 'critico',
          mensagem:
            `Lateralidade divergente na amostra ${origem.ident}: ` +
            `cadastro indica "${origem.lateralidade}", o laudo indica "${d.lateralidade}".`,
          modulo: MODULOS.M17_IA,
          comoResolver:
            'Confira o lado no cadastro da amostra e no texto do laudo. Corrija o que estiver errado — o Guardian não escolhe qual dos dois vale.',
          campo: 'lateralidade',
          evidencias: {
            amostra: origem.ident,
            cadastro: origem.lateralidade,
            laudo: d.lateralidade,
          },
        });
      }
    }

    return achados;
  }

  /**
   * M17: "margem - campo estruturado 'comprometida' x texto 'livre' -
   * prioridade alta".
   *
   * A checagem e textual e por isso propositalmente conservadora: procura a
   * afirmacao contraria explicita, e nao qualquer ocorrencia da palavra. Emite
   * `atencao`, nao `critico` - o texto pode estar descrevendo outra margem, e
   * bloquear a assinatura por heuristica de texto seria pior que avisar.
   */
  private async verificarMargens(
    tx: Transacao,
    laudoVersaoId: string,
    conteudo: Record<string, unknown>,
  ): Promise<AchadoGuardian[]> {
    const ctx = exigirContexto();
    const achados: AchadoGuardian[] = [];

    const margens = await tx
      .select()
      .from(margemMicroscopica)
      .where(
        and(
          eq(margemMicroscopica.tenantId, ctx.tenantId),
          eq(margemMicroscopica.laudoVersaoId, laudoVersaoId),
        ),
      );

    const textoLivre = [
      conteudo.conclusao,
      conteudo.comentarios,
      conteudo.descricaoMicroscopica,
    ]
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
      .toLowerCase();

    const comprometidas = margens.filter((m) => m.resultado === 'comprometida');

    if (comprometidas.length > 0 && /margens?\s+(cirúrgicas?\s+)?livres?/.test(textoLivre)) {
      achados.push({
        codigo: 'MARGEM_CONTRADICAO_TEXTO',
        nivel: 'atencao',
        mensagem:
          `Há ${comprometidas.length} margem(ns) marcada(s) como comprometida no campo estruturado, ` +
          'mas o texto do laudo afirma margens livres.',
        modulo: MODULOS.M17_IA,
        comoResolver:
          'Alinhe a margem estruturada com o que o texto afirma. Se o texto estiver certo, ajuste a margem; se a margem estiver certa, ajuste o texto.',
        campo: 'margens',
        evidencias: { margensComprometidas: comprometidas.map((m) => m.nome) },
      });
    }

    // M13: "nao avaliavel" e resposta legitima, mas precisa ser deliberada.
    const semResultado = margens.filter((m) => m.resultado === 'indeterminada');
    if (semResultado.length > 0) {
      achados.push({
        codigo: 'MARGEM_INDETERMINADA',
        nivel: 'sugestao',
        mensagem: `Margens ainda indeterminadas: ${semResultado.map((m) => m.nome).join(', ')}.`,
        modulo: MODULOS.M13_HISTOPATOLOGIA,
        comoResolver:
          'Registre o resultado da margem, ou explique no texto por que ela não pôde ser avaliada.',
        campo: 'margens',
      });
    }

    return achados;
  }

  /**
   * M12 secoes 89 e 92-94: coerencia da avaliacao citologica.
   *
   * A regra central do modulo esta na secao 93 e e a unica que BLOQUEIA:
   * "a amostra foi classificada como nao diagnostica, mas existe diagnostico
   * definitivo preenchido - o sistema devera solicitar revisao". Ela merece
   * nivel critico porque o laudo estaria afirmando com seguranca algo que o
   * proprio material declarou nao sustentar; a secao 142 e explicita ao separar
   * "nao diagnostico" de "negativo".
   *
   * As demais avisam e seguem, como manda o M17: a IA sugere, o profissional
   * decide.
   */
  private async verificarCitologia(
    tx: Transacao,
    casoId: string,
    laudoVersaoId: string,
    diagnosticos: Array<{ comportamento: string | null; textoExibido: string }>,
  ): Promise<AchadoGuardian[]> {
    const ctx = exigirContexto();
    const achados: AchadoGuardian[] = [];

    const [registro] = await tx
      .select({ modalidade: servico.modalidade })
      .from(caso)
      .innerJoin(servico, eq(servico.id, caso.servicoId))
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);

    if (registro?.modalidade !== 'citopatologia') return achados;

    const [avaliacoes, amostras] = await Promise.all([
      tx
        .select()
        .from(avaliacaoCitologica)
        .where(
          and(
            eq(avaliacaoCitologica.tenantId, ctx.tenantId),
            eq(avaliacaoCitologica.laudoVersaoId, laudoVersaoId),
          ),
        ),
      tx
        .select({ id: amostra.id, identificador: amostra.identificador })
        .from(amostra)
        .where(and(eq(amostra.tenantId, ctx.tenantId), eq(amostra.casoId, casoId))),
    ]);

    // M12 secao 142: toda interpretacao citologica se prende a uma amostra
    // identificada - amostra sem avaliacao e laudo pela metade.
    const avaliadas = new Set(avaliacoes.map((a) => a.amostraId));
    const semAvaliacao = amostras.filter((a) => !avaliadas.has(a.id));

    if (semAvaliacao.length > 0) {
      achados.push({
        codigo: 'CITOLOGIA_AMOSTRA_SEM_AVALIACAO',
        nivel: 'atencao',
        mensagem: `Sem avaliação citológica registrada: ${semAvaliacao
          .map((a) => a.identificador)
          .join(', ')}.`,
        modulo: MODULOS.M12_CITOPATOLOGIA,
        comoResolver:
          'Preencha a avaliação citológica da amostra no painel de citologia. Cada amostra tem a sua.',
        campo: 'avaliacaoCitologica',
      });
    }

    const inconclusivas = avaliacoes.filter(
      (a) => a.adequacao === 'nao_diagnostica' || a.adequacao === 'insatisfatoria',
    );

    /**
     * Diagnostico "definitivo" aqui e o que o laudo afirma sem ressalva: sem
     * marca de provisorio e sem hedge textual do vocabulario da secao 65
     * ("compativel com", "sugestivo de", "suspeito para"...). O laudo que ja diz
     * "inconclusivo" ou "nao diagnostico" esta coerente com a amostra e nao
     * deve ser barrado.
     */
    const hedge =
      /(compat[íi]vel com|sugestivo|indicativo|suspeito|inconclusiv|n[ãa]o diagn[óo]stic|prov[áa]vel|poss[íi]vel)/i;
    const afirmativos = diagnosticos.filter((d) => !hedge.test(d.textoExibido));

    if (inconclusivas.length > 0 && afirmativos.length > 0) {
      achados.push({
        codigo: 'CITOLOGIA_DIAGNOSTICO_EM_AMOSTRA_INADEQUADA',
        nivel: 'critico',
        mensagem:
          `A amostra foi classificada como ${inconclusivas[0]!.adequacao === 'nao_diagnostica' ? 'não diagnóstica' : 'insatisfatória'}, ` +
          'mas o laudo traz diagnóstico afirmativo. Revise a adequação, o grau de certeza ou a redação.',
        modulo: MODULOS.M12_CITOPATOLOGIA,
        comoResolver:
          'Ou registre a amostra como adequada, se ela for, ou troque o diagnóstico por uma conclusão que assuma a limitação do material.',
        campo: 'adequacao',
        evidencias: { diagnosticos: afirmativos.map((d) => d.textoExibido) },
      });
    }

    // M12 secao 89: alta confianca declarada sobre material que o proprio
    // patologista marcou como limitado.
    const confiantesEmMaterialLimitado = avaliacoes.filter(
      (a) =>
        a.grauCerteza === 'alta' &&
        (a.adequacao === 'pouco_representativa' || a.adequacao === 'adequada_com_limitacoes'),
    );

    if (confiantesEmMaterialLimitado.length > 0) {
      achados.push({
        codigo: 'CITOLOGIA_CERTEZA_ALTA_EM_MATERIAL_LIMITADO',
        nivel: 'atencao',
        mensagem:
          'Grau de certeza "alta" registrado sobre amostra com limitações. Confirmar se a limitação não afeta a conclusão.',
        modulo: MODULOS.M12_CITOPATOLOGIA,
        comoResolver:
          'Reveja o grau de certeza: material com limitação raramente sustenta conclusão definitiva.',
        campo: 'grauCerteza',
      });
    }

    /**
     * M12 secao 94: diagnostico de malignidade sem nenhum criterio estruturado.
     * "Isso nao significa necessariamente erro, mas podera gerar alerta
     * discreto" - a propria secao pede o tom, e por isso e sugestao, nao
     * atencao: existem malignidades reconhecidas por padrao, e nao por criterio
     * a criterio.
     */
    const criteriosRegistrados = avaliacoes.some(
      (a) =>
        Object.values(a.criteriosMalignidade).filter((v) => v && v !== 'ausente').length > 0,
    );

    if (diagnosticos.some((d) => d.comportamento === 'maligno') && !criteriosRegistrados) {
      achados.push({
        codigo: 'CITOLOGIA_MALIGNO_SEM_CRITERIOS',
        nivel: 'sugestao',
        mensagem:
          'Diagnóstico de neoplasia maligna sem nenhum critério de malignidade estruturado. Confirmar?',
        modulo: MODULOS.M12_CITOPATOLOGIA,
        comoResolver:
          'Marque no painel de citologia quais critérios de malignidade sustentam a conclusão.',
        campo: 'criteriosMalignidade',
      });
    }

    return achados;
  }

  /**
   * M05: bloqueio de identidade.
   *
   * "Sem correspondencia segura material-paciente, o Guardian impede a
   * progressao. O material permanece registrado fisicamente, mas nao avanca."
   */
  async verificarIdentidadeCaso(tx: Transacao, casoId: string): Promise<AchadoGuardian[]> {
    const ctx = exigirContexto();
    const achados: AchadoGuardian[] = [];

    const [registro] = await tx
      .select({
        casoIdent: caso.identificador,
        pacienteId: caso.pacienteId,
        microchip: paciente.microchip,
        nomePaciente: paciente.nome,
      })
      .from(caso)
      .innerJoin(paciente, eq(paciente.id, caso.pacienteId))
      .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.id, casoId)))
      .limit(1);

    if (!registro) {
      return [
        {
          codigo: 'CASO_INEXISTENTE',
          nivel: 'critico',
          mensagem: 'Caso não encontrado.',
          modulo: MODULOS.M05_RECEBIMENTO,
          comoResolver:
            'Recarregue a tela. Se persistir, o caso foi cancelado ou pertence a outra instituição.',
        },
      ];
    }

    /**
     * M05: o mesmo microchip em outro paciente ativo e problema de identidade.
     * Dois animais nao compartilham microchip; se isso aparece, ou houve erro de
     * digitacao ou o material foi vinculado ao paciente errado.
     */
    if (registro.microchip) {
      const duplicados = await tx
        .select({ id: paciente.id, nome: paciente.nome })
        .from(paciente)
        .where(
          and(
            eq(paciente.tenantId, ctx.tenantId),
            eq(paciente.microchip, registro.microchip),
          ),
        );

      const outros = duplicados.filter((p) => p.id !== registro.pacienteId);
      if (outros.length > 0) {
        achados.push({
          codigo: 'MICROCHIP_DUPLICADO',
          nivel: 'critico',
          mensagem:
            `O microchip ${registro.microchip} também está registrado em ` +
            `${outros.map((o) => o.nome).join(', ')}. Verifique a identidade antes de prosseguir.`,
          modulo: MODULOS.M05_RECEBIMENTO,
          comoResolver:
            'Confira o microchip digitado. Se o animal já tem cadastro, use o paciente existente em vez de criar outro.',
          campo: 'microchip',
          evidencias: { microchip: registro.microchip, pacientes: outros },
        });
      }
    }

    return ordenarPorGravidade(achados);
  }

  /**
   * M08: "cada cassete deve ter tecido de origem identificado e vinculo com
   * amostra e caso". Cassete sem origem quebra a rastreabilidade que o M09
   * exige ate a lamina, e por isso bloqueia a conclusao da macroscopia.
   */
  async verificarConclusaoMacroscopia(
    tx: Transacao,
    macroscopiaId: string,
  ): Promise<AchadoGuardian[]> {
    const ctx = exigirContexto();
    const achados: AchadoGuardian[] = [];

    const cassetes = await tx
      .select()
      .from(cassete)
      .where(
        and(eq(cassete.tenantId, ctx.tenantId), eq(cassete.macroscopiaId, macroscopiaId)),
      );

    if (cassetes.length === 0) {
      achados.push({
        codigo: 'MACROSCOPIA_SEM_CASSETE',
        nivel: 'atencao',
        mensagem: 'Nenhum cassete foi gerado nesta macroscopia.',
        modulo: MODULOS.M08_MACROSCOPIA,
        comoResolver:
          'Adicione ao menos um cassete no bloco “Cassetes”, ou marque o material como totalmente incluído.',
      });
    }

    for (const c of cassetes) {
      if (!c.tecidoOrigem?.trim()) {
        achados.push({
          codigo: 'CASSETE_SEM_TECIDO_ORIGEM',
          nivel: 'critico',
          mensagem: `O cassete ${c.identificador} não tem tecido de origem identificado.`,
          modulo: MODULOS.M08_MACROSCOPIA,
          comoResolver:
            'Informe o tecido de origem do cassete. É o primeiro elo da rastreabilidade até a lâmina.',
          campo: 'tecidoOrigem',
          evidencias: { cassete: c.identificador },
        });
      }
    }

    return ordenarPorGravidade(achados);
  }

  /**
   * Aplica os achados: se houver `critico`, a acao e barrada.
   *
   * O erro carrega os achados para o `ProblemaFilter` devolver 409 com o
   * detalhe estruturado, e o painel do M17 conseguir exibir cada um com seu
   * nivel e evidencia.
   */
  garantirSemBloqueio(achados: AchadoGuardian[], acao: string): void {
    if (achados.some((a) => a.nivel === 'critico')) {
      throw new BloqueioGuardianError(achados, acao);
    }
  }
}

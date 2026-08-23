import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  diaNaoUtil,
  localFisico,
  servico,
  setor,
  tabelaMestre,
  termo,
  unidade,
  type Transacao,
} from '@lapato/db';
import type { TipoUnidade } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosServico {
  nome: string;
  codigo: string;
  categoria: string;
  modalidade: string;
  descricao?: string;
  exigeTriagem?: boolean;
  exigeMacroscopia?: boolean;
  exigeProcessamento?: boolean;
  exigeMicroscopia?: boolean;
  geraLaudo?: boolean;
  permiteComplementares?: boolean;
  prazoDiasUteis?: number;
  prazoUrgenteDiasUteis?: number | null;
}

export interface DadosTermo {
  valor: string;
  codigo: string;
  abreviacao?: string;
  sinonimos?: string[];
  ordem?: number;
}

export interface DadosUnidade {
  nome: string;
  codigo: string;
  sigla?: string;
  tipo: TipoUnidade;
  responsavel?: string;
}

/**
 * M01 - Administracao e Configuracoes.
 *
 * O modulo que faz o resto do sistema ser configuravel em DADOS, nao em codigo
 * (secao 2): servicos com flags de comportamento decidem por quais etapas o
 * caso passa; tabelas mestres alimentam todos os formularios; unidades e
 * setores estruturam a instituicao; o calendario move os prazos.
 *
 * Duas regras estruturam todas as escritas:
 * - **Inativar, nunca excluir** (secao 21): o servico usado num caso de 2024
 *   precisa continuar legivel em 2030.
 * - **Alteracao nao retroage** (secao 22): mudar o prazo de um servico vale
 *   para casos NOVOS - o caso aberto com 5 dias segue com 5 dias, porque o
 *   prazo foi copiado para o estado do caso na abertura (M07).
 */
@Injectable()
export class AdministracaoService {
  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // --- servicos (secoes 10-13) ----------------------------------------------

  async listarServicos(): Promise<unknown[]> {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .select()
        .from(servico)
        .where(eq(servico.tenantId, ctx.tenantId))
        .orderBy(asc(servico.nome)),
    );
  }

  async criarServico(dados: DadosServico): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const codigo = dados.codigo.trim().toUpperCase();

      const [existente] = await tx
        .select({ id: servico.id })
        .from(servico)
        .where(and(eq(servico.tenantId, ctx.tenantId), eq(servico.codigo, codigo)))
        .limit(1);
      if (existente) {
        throw new BadRequestException(`O código "${codigo}" já pertence a outro serviço.`);
      }

      const [novo] = await tx
        .insert(servico)
        .values({
          tenantId: ctx.tenantId,
          nome: dados.nome.trim(),
          codigo,
          categoria: dados.categoria.trim(),
          modalidade: dados.modalidade,
          descricao: dados.descricao?.trim() || null,
          exigeTriagem: dados.exigeTriagem ?? true,
          exigeMacroscopia: dados.exigeMacroscopia ?? false,
          exigeProcessamento: dados.exigeProcessamento ?? false,
          exigeMicroscopia: dados.exigeMicroscopia ?? true,
          geraLaudo: dados.geraLaudo ?? true,
          permiteComplementares: dados.permiteComplementares ?? true,
          prazoDiasUteis: dados.prazoDiasUteis ?? 5,
          prazoUrgenteDiasUteis: dados.prazoUrgenteDiasUteis ?? null,
        })
        .returning({ id: servico.id });

      await this.auditoria.registrar(tx, {
        entidade: 'servico',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { nome: dados.nome, codigo, modalidade: dados.modalidade },
      });

      return { id: novo!.id };
    });
  }

  /**
   * O codigo fica imutavel: e a referencia estavel que aparece em telas,
   * integracoes e testes. As flags e prazos mudam a vontade - e valem para
   * casos novos (secao 22), porque a abertura copia o comportamento vigente.
   */
  async editarServico(id: string, dados: Partial<Omit<DadosServico, 'codigo'>>): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, servico, id, 'Serviço');

      const mudancas: Record<string, unknown> = {};
      if (dados.nome !== undefined) mudancas.nome = dados.nome.trim();
      if (dados.categoria !== undefined) mudancas.categoria = dados.categoria.trim();
      if (dados.modalidade !== undefined) mudancas.modalidade = dados.modalidade;
      if (dados.descricao !== undefined) mudancas.descricao = dados.descricao.trim() || null;
      for (const flag of [
        'exigeTriagem',
        'exigeMacroscopia',
        'exigeProcessamento',
        'exigeMicroscopia',
        'geraLaudo',
        'permiteComplementares',
      ] as const) {
        if (dados[flag] !== undefined) mudancas[flag] = dados[flag];
      }
      if (dados.prazoDiasUteis !== undefined) mudancas.prazoDiasUteis = dados.prazoDiasUteis;
      if (dados.prazoUrgenteDiasUteis !== undefined)
        mudancas.prazoUrgenteDiasUteis = dados.prazoUrgenteDiasUteis ?? null;

      if (Object.keys(mudancas).length === 0) return;

      await tx
        .update(servico)
        .set({ ...mudancas, atualizadoEm: new Date() })
        .where(eq(servico.id, id));

      await this.auditoria.registrarAlteracao(
        tx,
        'servico',
        id,
        Object.fromEntries(Object.keys(mudancas).map((k) => [k, (atual as never)[k]])),
        mudancas,
      );
    });
  }

  async alternarServico(id: string, ativar: boolean): Promise<void> {
    await this.alternarAtivacao(servico, 'servico', id, ativar, 'Serviço');
  }

  // --- tabelas mestres e termos (secoes 19-21) ------------------------------

  async listarTabelas(): Promise<unknown[]> {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .select({
          id: tabelaMestre.id,
          chave: tabelaMestre.chave,
          nome: tabelaMestre.nome,
          sistema: tabelaMestre.sistema,
          totalTermos: sql<number>`(
            select count(*)::int from ${termo} t
            where t.tabela_id = tabela_mestre.id and t.inativado_em is null
          )`,
        })
        .from(tabelaMestre)
        .where(eq(tabelaMestre.tenantId, ctx.tenantId))
        .orderBy(asc(tabelaMestre.nome)),
    );
  }

  /** Termos de uma tabela, INCLUINDO inativos - a tela administra o ciclo todo. */
  async listarTermos(tabelaId: string): Promise<unknown[]> {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .select({
          id: termo.id,
          valor: termo.valor,
          codigo: termo.codigo,
          abreviacao: termo.abreviacao,
          sinonimos: termo.sinonimos,
          ordem: termo.ordem,
          inativadoEm: termo.inativadoEm,
        })
        .from(termo)
        .where(and(eq(termo.tenantId, ctx.tenantId), eq(termo.tabelaId, tabelaId)))
        .orderBy(asc(termo.ordem), asc(termo.valor)),
    );
  }

  async criarTermo(tabelaId: string, dados: DadosTermo): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscar(tx, tabelaMestre, tabelaId, 'Tabela mestre');
      const codigo = dados.codigo.trim().toLowerCase().replace(/\s+/g, '_');

      const [existente] = await tx
        .select({ id: termo.id })
        .from(termo)
        .where(
          and(
            eq(termo.tenantId, ctx.tenantId),
            eq(termo.tabelaId, tabelaId),
            eq(termo.codigo, codigo),
          ),
        )
        .limit(1);
      if (existente) {
        throw new BadRequestException(`O código "${codigo}" já existe nesta tabela.`);
      }

      const [novo] = await tx
        .insert(termo)
        .values({
          tenantId: ctx.tenantId,
          tabelaId,
          valor: dados.valor.trim(),
          codigo,
          abreviacao: dados.abreviacao?.trim() || null,
          sinonimos: dados.sinonimos ?? [],
          ordem: dados.ordem ?? 0,
        })
        .returning({ id: termo.id });

      await this.auditoria.registrar(tx, {
        entidade: 'termo',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { tabelaId, valor: dados.valor, codigo },
      });

      return { id: novo!.id };
    });
  }

  async editarTermo(id: string, dados: Partial<Omit<DadosTermo, 'codigo'>>): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, termo, id, 'Termo');

      const mudancas: Record<string, unknown> = {};
      if (dados.valor !== undefined) mudancas.valor = dados.valor.trim();
      if (dados.abreviacao !== undefined) mudancas.abreviacao = dados.abreviacao.trim() || null;
      if (dados.sinonimos !== undefined) mudancas.sinonimos = dados.sinonimos;
      if (dados.ordem !== undefined) mudancas.ordem = dados.ordem;

      if (Object.keys(mudancas).length === 0) return;

      await tx.update(termo).set({ ...mudancas, atualizadoEm: new Date() }).where(eq(termo.id, id));

      await this.auditoria.registrarAlteracao(
        tx,
        'termo',
        id,
        Object.fromEntries(Object.keys(mudancas).map((k) => [k, (atual as never)[k]])),
        mudancas,
      );
    });
  }

  async alternarTermo(id: string, ativar: boolean): Promise<void> {
    await this.alternarAtivacao(termo, 'termo', id, ativar, 'Termo');
  }

  // --- unidades e setores (secoes 7-8) --------------------------------------

  async listarUnidades(): Promise<unknown[]> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const unidades = await tx
        .select({
          id: unidade.id,
          nome: unidade.nome,
          codigo: unidade.codigo,
          sigla: unidade.sigla,
          tipo: unidade.tipo,
          responsavel: unidade.responsavel,
          inativadoEm: unidade.inativadoEm,
        })
        .from(unidade)
        .where(eq(unidade.tenantId, ctx.tenantId))
        .orderBy(asc(unidade.nome));

      const setores = await tx
        .select({
          id: setor.id,
          unidadeId: setor.unidadeId,
          nome: setor.nome,
          codigo: setor.codigo,
          tipo: setor.tipo,
          inativadoEm: setor.inativadoEm,
        })
        .from(setor)
        .where(eq(setor.tenantId, ctx.tenantId))
        .orderBy(asc(setor.nome));

      return unidades.map((u) => ({
        ...u,
        setores: setores.filter((s) => s.unidadeId === u.id),
      }));
    });
  }

  async criarUnidade(dados: DadosUnidade): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const codigo = dados.codigo.trim().toUpperCase();

      const [existente] = await tx
        .select({ id: unidade.id })
        .from(unidade)
        .where(and(eq(unidade.tenantId, ctx.tenantId), eq(unidade.codigo, codigo)))
        .limit(1);
      if (existente) {
        throw new BadRequestException(`O código "${codigo}" já pertence a outra unidade.`);
      }

      const [nova] = await tx
        .insert(unidade)
        .values({
          tenantId: ctx.tenantId,
          nome: dados.nome.trim(),
          codigo,
          sigla: dados.sigla?.trim() || null,
          tipo: dados.tipo,
          responsavel: dados.responsavel?.trim() || null,
        })
        .returning({ id: unidade.id });

      await this.auditoria.registrar(tx, {
        entidade: 'unidade',
        entidadeId: nova!.id,
        acao: 'criar',
        valorNovo: { nome: dados.nome, codigo, tipo: dados.tipo },
      });

      return { id: nova!.id };
    });
  }

  async editarUnidade(
    id: string,
    dados: Partial<Omit<DadosUnidade, 'codigo' | 'tipo'>>,
  ): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, unidade, id, 'Unidade');

      const mudancas: Record<string, unknown> = {};
      if (dados.nome !== undefined) mudancas.nome = dados.nome.trim();
      if (dados.sigla !== undefined) mudancas.sigla = dados.sigla.trim() || null;
      if (dados.responsavel !== undefined)
        mudancas.responsavel = dados.responsavel.trim() || null;

      if (Object.keys(mudancas).length === 0) return;

      await tx
        .update(unidade)
        .set({ ...mudancas, atualizadoEm: new Date() })
        .where(eq(unidade.id, id));

      await this.auditoria.registrarAlteracao(
        tx,
        'unidade',
        id,
        Object.fromEntries(Object.keys(mudancas).map((k) => [k, (atual as never)[k]])),
        mudancas,
      );
    });
  }

  /**
   * O TIPO da unidade fica imutavel de proposito: e dele que o M09 deriva o
   * isolamento do laboratorio de apoio (quem e parceiro so ve os proprios
   * lotes). Transformar uma sede em laboratorio_apoio por edicao mudaria o
   * perimetro de acesso de usuarios ja vinculados - isso e reprovisionamento,
   * nao formulario.
   */

  async alternarUnidade(id: string, ativar: boolean): Promise<void> {
    await this.alternarAtivacao(unidade, 'unidade', id, ativar, 'Unidade');
  }

  async criarSetor(
    unidadeId: string,
    dados: { nome: string; codigo: string; tipo: string },
  ): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscar(tx, unidade, unidadeId, 'Unidade');
      const codigo = dados.codigo.trim().toUpperCase();

      const [existente] = await tx
        .select({ id: setor.id })
        .from(setor)
        .where(
          and(
            eq(setor.tenantId, ctx.tenantId),
            eq(setor.unidadeId, unidadeId),
            eq(setor.codigo, codigo),
          ),
        )
        .limit(1);
      if (existente) {
        throw new BadRequestException(`O código "${codigo}" já existe nesta unidade.`);
      }

      const [novo] = await tx
        .insert(setor)
        .values({
          tenantId: ctx.tenantId,
          unidadeId,
          nome: dados.nome.trim(),
          codigo,
          tipo: dados.tipo.trim(),
        })
        .returning({ id: setor.id });

      await this.auditoria.registrar(tx, {
        entidade: 'setor',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { unidadeId, nome: dados.nome, codigo },
      });

      return { id: novo!.id };
    });
  }

  async alternarSetor(id: string, ativar: boolean): Promise<void> {
    await this.alternarAtivacao(setor, 'setor', id, ativar, 'Setor');
  }

  // --- locais fisicos (secao 7.3; usado por M15 e M18) -----------------------

  /**
   * Locais fisicos, em arvore.
   *
   * A hierarquia e a mesma que o M15 secao 18 descreve - unidade, sala,
   * equipamento, compartimento, posicao - e vive aqui porque quem define o que
   * existe e o M01. O Controle de Cadaveres e a Bioteca so registram o que esta
   * em cada local.
   *
   * Ate esta versao a tabela existia sem nenhuma tela: ninguem conseguia
   * cadastrar uma camara, e um modulo que depende dela nasceria inutilizavel.
   */
  async listarLocais(): Promise<unknown[]> {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .select({
          id: localFisico.id,
          nome: localFisico.nome,
          codigo: localFisico.codigo,
          categoria: localFisico.categoria,
          paiId: localFisico.paiId,
          unidadeId: localFisico.unidadeId,
          unidadeNome: unidade.nome,
          capacidade: localFisico.capacidade,
          condicaoAmbiental: localFisico.condicaoAmbiental,
          status: localFisico.status,
          inativadoEm: localFisico.inativadoEm,
        })
        .from(localFisico)
        .leftJoin(unidade, eq(unidade.id, localFisico.unidadeId))
        .where(eq(localFisico.tenantId, ctx.tenantId))
        .orderBy(asc(localFisico.codigo)),
    );
  }

  async criarLocal(dados: {
    unidadeId: string;
    paiId?: string | null;
    nome: string;
    codigo: string;
    categoria: string;
    capacidade?: number | null;
    condicaoAmbiental?: string | null;
  }): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscar(tx, unidade, dados.unidadeId, 'Unidade');
      if (dados.paiId) await this.buscar(tx, localFisico, dados.paiId, 'Local');

      const codigo = dados.codigo.trim().toUpperCase();
      const [existente] = await tx
        .select({ id: localFisico.id })
        .from(localFisico)
        .where(and(eq(localFisico.tenantId, ctx.tenantId), eq(localFisico.codigo, codigo)))
        .limit(1);
      if (existente) {
        throw new BadRequestException(`O código "${codigo}" já existe.`);
      }

      const [novo] = await tx
        .insert(localFisico)
        .values({
          tenantId: ctx.tenantId,
          unidadeId: dados.unidadeId,
          paiId: dados.paiId ?? null,
          nome: dados.nome.trim(),
          codigo,
          categoria: dados.categoria.trim(),
          capacidade: dados.capacidade ?? null,
          condicaoAmbiental: dados.condicaoAmbiental ?? null,
        })
        .returning({ id: localFisico.id });

      await this.auditoria.registrar(tx, {
        entidade: 'local_fisico',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { nome: dados.nome, codigo, categoria: dados.categoria },
      });

      return { id: novo!.id };
    });
  }

  /** M01: inativacao, nunca exclusao - a posicao guarda historico de quem esteve nela. */
  async alternarLocal(id: string, ativar: boolean): Promise<void> {
    await this.alternarAtivacao(localFisico, 'local_fisico', id, ativar, 'Local');
  }

  // --- calendario (secao 14) -------------------------------------------------

  async listarDiasNaoUteis(): Promise<unknown[]> {
    const ctx = exigirContexto();
    return this.db.executar((tx) =>
      tx
        .select({
          id: diaNaoUtil.id,
          data: diaNaoUtil.data,
          descricao: diaNaoUtil.descricao,
          tipo: diaNaoUtil.tipo,
          unidadeId: diaNaoUtil.unidadeId,
        })
        .from(diaNaoUtil)
        .where(eq(diaNaoUtil.tenantId, ctx.tenantId))
        .orderBy(asc(diaNaoUtil.data)),
    );
  }

  async criarDiaNaoUtil(dados: {
    data: string;
    descricao: string;
    tipo?: string;
  }): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [existente] = await tx
        .select({ id: diaNaoUtil.id })
        .from(diaNaoUtil)
        .where(and(eq(diaNaoUtil.tenantId, ctx.tenantId), eq(diaNaoUtil.data, dados.data)))
        .limit(1);
      if (existente) {
        throw new BadRequestException('Esta data já está no calendário.');
      }

      const [novo] = await tx
        .insert(diaNaoUtil)
        .values({
          tenantId: ctx.tenantId,
          data: dados.data,
          descricao: dados.descricao.trim(),
          tipo: dados.tipo ?? 'institucional',
        })
        .returning({ id: diaNaoUtil.id });

      await this.auditoria.registrar(tx, {
        entidade: 'dia_nao_util',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: dados,
      });

      return { id: novo!.id };
    });
  }

  /**
   * Excecao a regra de inativacao: feriado digitado errado e removido de vez.
   * Nao ha caso apontando para um dia nao util - ele so participa do CALCULO
   * de previsao, que e refeito a cada consulta; a auditoria guarda a remocao.
   */
  async removerDiaNaoUtil(id: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [atual] = await tx
        .select()
        .from(diaNaoUtil)
        .where(and(eq(diaNaoUtil.tenantId, ctx.tenantId), eq(diaNaoUtil.id, id)))
        .limit(1);
      if (!atual) throw new NotFoundException('Data não encontrada.');

      await tx.delete(diaNaoUtil).where(eq(diaNaoUtil.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'dia_nao_util',
        entidadeId: id,
        acao: 'remover',
        valorAnterior: { data: atual.data, descricao: atual.descricao },
      });
    });
  }

  // --- internos --------------------------------------------------------------

  private async buscar(
    tx: Transacao,
    tabela:
      | typeof servico
      | typeof termo
      | typeof unidade
      | typeof setor
      | typeof tabelaMestre
      | typeof localFisico,
    id: string,
    rotulo: string,
  ) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select()
      .from(tabela)
      .where(and(eq(tabela.tenantId, ctx.tenantId), eq(tabela.id, id)))
      .limit(1);
    if (!linha) throw new NotFoundException(`${rotulo} não encontrado(a).`);
    return linha;
  }

  /** Inativacao/reativacao comum (secao 21) - com auditoria. */
  private async alternarAtivacao(
    tabela: typeof servico | typeof termo | typeof unidade | typeof setor | typeof localFisico,
    entidade: string,
    id: string,
    ativar: boolean,
    rotulo: string,
  ): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscar(tx, tabela, id, rotulo);

      if (ativar && !atual.inativadoEm) {
        throw new BadRequestException(`${rotulo} já está ativo(a).`);
      }
      if (!ativar && atual.inativadoEm) {
        throw new BadRequestException(`${rotulo} já está inativo(a).`);
      }

      await tx
        .update(tabela)
        .set(
          ativar
            ? { inativadoEm: null, inativadoPor: null, atualizadoEm: new Date() }
            : { inativadoEm: new Date(), inativadoPor: ctx.usuarioId, atualizadoEm: new Date() },
        )
        .where(eq(tabela.id, id));

      await this.auditoria.registrar(tx, {
        entidade,
        entidadeId: id,
        acao: ativar ? 'reativar' : 'inativar',
      });
    });
  }
}

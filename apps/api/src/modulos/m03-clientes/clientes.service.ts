import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  caso,
  cliente,
  conviteCadastroCliente,
  paciente,
  tenant,
  veterinario,
  vinculoVeterinarioCliente,
  type Transacao,
  tabelaPreco,
} from '@lapato/db';
import type { StatusCliente, TipoCliente } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { AuditoriaService } from '../../core/auditoria/auditoria.service.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

export interface DadosCliente {
  nomeFantasia: string;
  razaoSocial?: string;
  documento?: string;
  tipo: TipoCliente;
  codigo: string;
  nomeAbreviado?: string;
  /** Contato institucional - obrigatorio no cadastro (documento do Hugo). */
  email?: string;
  telefone?: string;
  observacoes?: string;
  /** M20: tabela de precos que o cliente segue; nulo = valor padrao. */
  tabelaPrecoId?: string | null;
}

export interface DadosVeterinario {
  nome: string;
  crmv?: string;
  crmvUf?: string;
  email?: string;
  telefone?: string;
  especialidade?: string;
}

/**
 * M03 - Cadastro de Clientes e Veterinarios.
 *
 * Fonte unica de verdade dos dados cadastrais (secao 1): o cliente e cadastrado
 * uma vez e a identidade acompanha todas as relacoes. Duas regras estruturam
 * tudo aqui:
 *
 * - **Inativar, nunca excluir** (M01/M03): cliente e veterinario com exames
 *   ficam no historico para sempre; a inativacao so os tira das opcoes novas.
 * - **O veterinario e pessoa unica com N vinculos** (secoes 12-13): mudar de
 *   clinica encerra um vinculo e abre outro - nunca recadastra o profissional.
 */
@Injectable()
export class ClientesService {
  constructor(
    private readonly db: DbService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // --- clientes -------------------------------------------------------------

  /**
   * Cria o cliente, barrando duplicidade evidente (secao 20): documento ou
   * nome ja cadastrados devolvem 409 com os candidatos, e o usuario decide -
   * abrir o existente ou continuar com `ignorarDuplicidade`, que fica na
   * auditoria como justificativa.
   */
  async criarCliente(
    dados: DadosCliente,
    ignorarDuplicidade = false,
  ): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const codigo = dados.codigo.trim().toUpperCase();

      if (!ignorarDuplicidade) {
        await this.barrarClienteDuplicado(tx, dados);
      }

      const [existenteCodigo] = await tx
        .select({ id: cliente.id })
        .from(cliente)
        .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.codigo, codigo)))
        .limit(1);
      if (existenteCodigo) {
        throw new BadRequestException(
          `O código "${codigo}" já pertence a outro cliente - ele compõe o registro dos exames (M01) e precisa ser único.`,
        );
      }

      const [novo] = await tx
        .insert(cliente)
        .values({
          tenantId: ctx.tenantId,
          nomeFantasia: dados.nomeFantasia.trim(),
          razaoSocial: dados.razaoSocial?.trim() || null,
          documento: dados.documento?.replace(/\D/g, '') || null,
          tipo: dados.tipo,
          codigo,
          nomeAbreviado: dados.nomeAbreviado?.trim() || null,
          email: dados.email?.trim().toLowerCase() || null,
          telefone: dados.telefone?.trim() || null,
          observacoes: dados.observacoes?.trim() || null,
        })
        .returning({ id: cliente.id });

      await this.auditoria.registrar(tx, {
        entidade: 'cliente',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { nomeFantasia: dados.nomeFantasia, codigo, tipo: dados.tipo },
        justificativa: ignorarDuplicidade
          ? 'Criado apesar do aviso de possível duplicidade (M03 seção 20).'
          : undefined,
      });

      return { id: novo!.id };
    });
  }

  async editarCliente(id: string, dados: Partial<DadosCliente>): Promise<void> {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const atual = await this.buscarCliente(tx, id);

      const mudancas: Record<string, unknown> = {};
      if (dados.nomeFantasia !== undefined) mudancas.nomeFantasia = dados.nomeFantasia.trim();
      if (dados.razaoSocial !== undefined) mudancas.razaoSocial = dados.razaoSocial.trim() || null;
      if (dados.documento !== undefined)
        mudancas.documento = dados.documento.replace(/\D/g, '') || null;
      if (dados.tipo !== undefined) mudancas.tipo = dados.tipo;
      if (dados.nomeAbreviado !== undefined)
        mudancas.nomeAbreviado = dados.nomeAbreviado.trim() || null;
      if (dados.email !== undefined) mudancas.email = dados.email.trim().toLowerCase() || null;
      if (dados.telefone !== undefined) mudancas.telefone = dados.telefone.trim() || null;
      if (dados.observacoes !== undefined) mudancas.observacoes = dados.observacoes.trim() || null;
      if (dados.tabelaPrecoId !== undefined) {
        if (dados.tabelaPrecoId) {
          const [tabela] = await tx
            .select({ id: tabelaPreco.id, inativadoEm: tabelaPreco.inativadoEm })
            .from(tabelaPreco)
            .where(
              and(eq(tabelaPreco.tenantId, ctx.tenantId), eq(tabelaPreco.id, dados.tabelaPrecoId)),
            )
            .limit(1);
          if (!tabela) throw new BadRequestException('Tabela de preços não encontrada.');
          if (tabela.inativadoEm) {
            throw new BadRequestException('Tabela de preços inativa não pode ser atribuída.');
          }
        }
        mudancas.tabelaPrecoId = dados.tabelaPrecoId;
      }

      /**
       * O codigo fica FORA da edicao comum de proposito: ele compoe o registro
       * oficial dos exames ja emitidos (`CV-000342/26`). Troca-lo reescreveria
       * a leitura de identificadores historicos - se um dia for necessario, e
       * decisao administrativa com migracao propria, nao um campo de formulario.
       */

      if (Object.keys(mudancas).length === 0) return;

      await tx
        .update(cliente)
        .set({ ...mudancas, atualizadoEm: new Date() })
        .where(eq(cliente.id, id));

      await this.auditoria.registrarAlteracao(
        tx,
        'cliente',
        id,
        {
          nomeFantasia: atual.nomeFantasia,
          razaoSocial: atual.razaoSocial,
          documento: atual.documento,
          tipo: atual.tipo,
          nomeAbreviado: atual.nomeAbreviado,
          observacoes: atual.observacoes,
        },
        mudancas,
      );
    });
  }

  /** Secao 7 + regra do M01: inativar tira das opcoes novas; o historico fica. */
  async inativarCliente(id: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscarCliente(tx, id);
      if (atual.inativadoEm) throw new BadRequestException('Este cliente já está inativo.');

      await tx
        .update(cliente)
        .set({
          inativadoEm: new Date(),
          inativadoPor: ctx.usuarioId,
          status: 'inativo',
          atualizadoEm: new Date(),
        })
        .where(eq(cliente.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'cliente',
        entidadeId: id,
        acao: 'inativar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'inativo' },
      });
    });
  }

  async reativarCliente(id: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscarCliente(tx, id);
      if (!atual.inativadoEm) throw new BadRequestException('Este cliente já está ativo.');

      await tx
        .update(cliente)
        .set({ inativadoEm: null, inativadoPor: null, status: 'ativo', atualizadoEm: new Date() })
        .where(eq(cliente.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'cliente',
        entidadeId: id,
        acao: 'reativar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'ativo' },
      });
    });
  }

  /**
   * Busca ampla (secao 45): um campo so cobre nome, razao social, documento e
   * codigo. Inclui inativos - a ficha historica continua acessivel; o que muda
   * e que inativo nao aparece nas OPCOES de cadastro de exame (catalogo).
   */
  async listarClientes(filtros: { q?: string; status?: StatusCliente }): Promise<unknown[]> {
    const ctx = exigirContexto();

    const condicoes = [eq(cliente.tenantId, ctx.tenantId)];
    if (filtros.status) condicoes.push(eq(cliente.status, filtros.status));
    if (filtros.q?.trim()) {
      const q = `%${filtros.q.trim()}%`;
      condicoes.push(
        or(
          ilike(cliente.nomeFantasia, q),
          ilike(cliente.razaoSocial, q),
          ilike(cliente.codigo, q),
          ilike(cliente.documento, `%${filtros.q.replace(/\D/g, '')}%`),
        )!,
      );
    }

    return this.db.executar((tx) =>
      tx
        .select({
          id: cliente.id,
          nomeFantasia: cliente.nomeFantasia,
          razaoSocial: cliente.razaoSocial,
          documento: cliente.documento,
          tipo: cliente.tipo,
          status: cliente.status,
          codigo: cliente.codigo,
          criadoEm: cliente.criadoEm,
          inativadoEm: cliente.inativadoEm,
          /**
           * Identificadores qualificados a mao: interpolar `cliente.id` do
           * drizzle aqui emite so `"id"`, que dentro do subquery resolve para a
           * coluna do escopo interno - e a contagem sai silenciosamente errada.
           */
          totalCasos: sql<number>`(
            select count(*)::int from ${caso} c
            where c.cliente_id = cliente.id and c.tenant_id = cliente.tenant_id
          )`,
        })
        .from(cliente)
        .where(and(...condicoes))
        .orderBy(asc(cliente.nomeFantasia))
        .limit(200),
    );
  }

  /** Ficha do cliente (secao 49): dados + vinculos + historico de casos consultado. */
  async detalheCliente(id: string) {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const dados = await this.buscarCliente(tx, id);

      const vinculos = await tx
        .select({
          id: vinculoVeterinarioCliente.id,
          veterinarioId: veterinario.id,
          nome: veterinario.nome,
          crmv: veterinario.crmv,
          crmvUf: veterinario.crmvUf,
          cargo: vinculoVeterinarioCliente.cargo,
          principal: vinculoVeterinarioCliente.principal,
          inicioEm: vinculoVeterinarioCliente.inicioEm,
          terminoEm: vinculoVeterinarioCliente.terminoEm,
        })
        .from(vinculoVeterinarioCliente)
        .innerJoin(veterinario, eq(veterinario.id, vinculoVeterinarioCliente.veterinarioId))
        .where(
          and(
            eq(vinculoVeterinarioCliente.tenantId, ctx.tenantId),
            eq(vinculoVeterinarioCliente.clienteId, id),
          ),
        )
        .orderBy(desc(vinculoVeterinarioCliente.principal), asc(veterinario.nome));

      /**
       * Secao 30: a aba de exames CONSULTA os casos - o M03 nao guarda copia.
       * Os ultimos bastam para a ficha; a analise completa e da Central (M07).
       */
      const casos = await tx
        .select({
          id: caso.id,
          identificador: caso.identificador,
          paciente: paciente.nome,
          criadoEm: caso.criadoEm,
        })
        .from(caso)
        .leftJoin(paciente, eq(paciente.id, caso.pacienteId))
        .where(and(eq(caso.tenantId, ctx.tenantId), eq(caso.clienteId, id)))
        .orderBy(desc(caso.criadoEm))
        .limit(20);

      const [tabela] = dados.tabelaPrecoId
        ? await tx
            .select({ nome: tabelaPreco.nome })
            .from(tabelaPreco)
            .where(and(eq(tabelaPreco.tenantId, ctx.tenantId), eq(tabelaPreco.id, dados.tabelaPrecoId)))
            .limit(1)
        : [];

      return { ...dados, tabelaPrecoNome: tabela?.nome ?? null, vinculos, casos };
    });
  }

  // --- autocadastro do cliente (documento do Hugo) --------------------------

  /**
   * Gera o link de autocadastro: token de 32 bytes, so o hash guardado, sete
   * dias de validade, uso unico. Devolve o CAMINHO (o front monta a URL com a
   * origem) e a validade, para quem envia saber o que esta mandando.
   */
  async gerarConviteCadastro(clienteId: string): Promise<{ caminho: string; expiraEm: Date }> {
    const ctx = exigirContexto();
    return this.db.executar(async (tx) => {
      const alvo = await this.buscarCliente(tx, clienteId);
      if (alvo.inativadoEm) throw new BadRequestException('Cliente inativo não recebe convite.');

      const [instituicao] = await this.db.raw
        .select({ slug: tenant.slug })
        .from(tenant)
        .where(eq(tenant.id, ctx.tenantId))
        .limit(1);
      if (!instituicao) throw new NotFoundException('Instituição não encontrada.');

      // Um convite vivo por cliente: gerar de novo encerra os anteriores.
      await tx
        .update(conviteCadastroCliente)
        .set({ expiraEm: new Date(), atualizadoEm: new Date() })
        .where(
          and(
            eq(conviteCadastroCliente.tenantId, ctx.tenantId),
            eq(conviteCadastroCliente.clienteId, clienteId),
            isNull(conviteCadastroCliente.usadoEm),
          ),
        );

      const tokenBruto = randomBytes(32).toString('base64url');
      const expiraEm = new Date(Date.now() + 7 * 24 * 3_600_000);
      await tx.insert(conviteCadastroCliente).values({
        tenantId: ctx.tenantId,
        clienteId,
        tokenHash: hashDoToken(tokenBruto),
        expiraEm,
        criadoPorId: ctx.usuarioId,
      });

      await this.auditoria.registrar(tx, {
        entidade: 'cliente',
        entidadeId: clienteId,
        acao: 'convite_cadastro',
        valorNovo: { expiraEm: expiraEm.toISOString() },
      });

      return { caminho: `/cadastro-cliente/${instituicao.slug}/${tokenBruto}`, expiraEm };
    });
  }

  /** O que o cliente ve ao abrir o link: so os dados dele, nunca preco ou veterinario. */
  async lerConvitePublico(tenantSlug: string, tokenBruto: string) {
    const { tenantId, convite } = await this.resolverConvite(tenantSlug, tokenBruto);
    return this.db.executarComTenant(tenantId, async (tx) => {
      const [instituicao] = await this.db.raw
        .select({ nome: tenant.nomeFantasia })
        .from(tenant)
        .where(eq(tenant.id, tenantId))
        .limit(1);
      const [dados] = await tx
        .select({
          nomeFantasia: cliente.nomeFantasia,
          razaoSocial: cliente.razaoSocial,
          documento: cliente.documento,
          email: cliente.email,
          telefone: cliente.telefone,
        })
        .from(cliente)
        .where(and(eq(cliente.tenantId, tenantId), eq(cliente.id, convite.clienteId)))
        .limit(1);
      if (!dados) throw new NotFoundException('Convite não encontrado.');
      return { instituicao: instituicao?.nome ?? '', expiraEm: convite.expiraEm, cliente: dados };
    });
  }

  /** O cliente preenche e o convite se consome; o que havia antes fica no convite. */
  async concluirConvitePublico(
    tenantSlug: string,
    tokenBruto: string,
    dados: {
      nomeFantasia: string;
      razaoSocial?: string;
      documento: string;
      email: string;
      telefone: string;
    },
  ): Promise<{ ok: true }> {
    const { tenantId, convite } = await this.resolverConvite(tenantSlug, tokenBruto);
    return this.db.executarComTenant(tenantId, async (tx) => {
      const [atual] = await tx
        .select({
          nomeFantasia: cliente.nomeFantasia,
          razaoSocial: cliente.razaoSocial,
          documento: cliente.documento,
          email: cliente.email,
          telefone: cliente.telefone,
        })
        .from(cliente)
        .where(and(eq(cliente.tenantId, tenantId), eq(cliente.id, convite.clienteId)))
        .limit(1);
      if (!atual) throw new NotFoundException('Convite não encontrado.');

      // Review: mesmas regras do cadastro interno - documento com digitos de
      // verdade e sem colidir com outro cliente da instituicao.
      const documento = dados.documento.replace(/\D/g, '');
      if (documento.length < 11) {
        throw new BadRequestException('Informe o CNPJ (ou CPF) completo, só com os dígitos.');
      }
      const [colisao] = await tx
        .select({ id: cliente.id })
        .from(cliente)
        .where(
          and(
            eq(cliente.tenantId, tenantId),
            eq(cliente.documento, documento),
            sql`${cliente.id} <> ${convite.clienteId}`,
          ),
        )
        .limit(1);
      if (colisao) {
        throw new ConflictException('Já existe outro cadastro com este documento. Fale com o laboratório.');
      }

      const agora = new Date();
      // Uso unico: marca antes de escrever, e so segue se ninguem marcou antes.
      const consumido = await tx
        .update(conviteCadastroCliente)
        .set({ usadoEm: agora, dadosAnteriores: atual, atualizadoEm: agora })
        .where(
          and(
            eq(conviteCadastroCliente.id, convite.id),
            eq(conviteCadastroCliente.tenantId, tenantId),
            isNull(conviteCadastroCliente.usadoEm),
          ),
        )
        .returning({ id: conviteCadastroCliente.id });
      if (consumido.length === 0) throw new GoneException('Este link já foi usado.');

      await tx
        .update(cliente)
        .set({
          nomeFantasia: dados.nomeFantasia.trim(),
          razaoSocial: dados.razaoSocial?.trim() || null,
          documento,
          email: dados.email.trim().toLowerCase(),
          telefone: dados.telefone.trim(),
          atualizadoEm: agora,
        })
        .where(and(eq(cliente.tenantId, tenantId), eq(cliente.id, convite.clienteId)));

      return { ok: true as const };
    });
  }

  /**
   * Resolve slug + token ao convite valido. Tudo que falha responde 404 igual:
   * slug errado, token errado, expirado - sem enumerar o que existe. Usado
   * responde 410, porque quem chegou ate ali tinha o link certo.
   */
  private async resolverConvite(tenantSlug: string, tokenBruto: string) {
    const [instituicao] = await this.db.raw
      .select({ id: tenant.id })
      .from(tenant)
      .where(and(eq(tenant.slug, tenantSlug), isNull(tenant.inativadoEm)))
      .limit(1);
    if (!instituicao || !tokenBruto || tokenBruto.length < 20) {
      throw new NotFoundException('Convite não encontrado.');
    }

    const convite = await this.db.executarComTenant(instituicao.id, async (tx) => {
      const [c] = await tx
        .select({
          id: conviteCadastroCliente.id,
          clienteId: conviteCadastroCliente.clienteId,
          expiraEm: conviteCadastroCliente.expiraEm,
          usadoEm: conviteCadastroCliente.usadoEm,
          clienteInativadoEm: cliente.inativadoEm,
        })
        .from(conviteCadastroCliente)
        .innerJoin(cliente, eq(cliente.id, conviteCadastroCliente.clienteId))
        .where(
          and(
            eq(conviteCadastroCliente.tenantId, instituicao.id),
            eq(conviteCadastroCliente.tokenHash, hashDoToken(tokenBruto)),
          ),
        )
        .limit(1);
      return c ?? null;
    });
    if (!convite) throw new NotFoundException('Convite não encontrado.');
    // Cliente inativado depois do convite: o link morre junto.
    if (convite.clienteInativadoEm) throw new NotFoundException('Convite não encontrado.');
    if (convite.usadoEm) throw new GoneException('Este link já foi usado.');
    if (convite.expiraEm.getTime() < Date.now()) throw new NotFoundException('Convite não encontrado.');
    return { tenantId: instituicao.id, convite };
  }

  // --- veterinarios ---------------------------------------------------------

  async criarVeterinario(
    dados: DadosVeterinario,
    ignorarDuplicidade = false,
  ): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      if (!ignorarDuplicidade) {
        await this.barrarVeterinarioDuplicado(tx, dados);
      }

      const [novo] = await tx
        .insert(veterinario)
        .values({
          tenantId: ctx.tenantId,
          nome: dados.nome.trim(),
          crmv: dados.crmv?.trim() || null,
          crmvUf: dados.crmvUf?.trim().toUpperCase() || null,
          email: dados.email?.trim() || null,
          telefone: dados.telefone?.trim() || null,
          especialidade: dados.especialidade?.trim() || null,
        })
        .returning({ id: veterinario.id });

      await this.auditoria.registrar(tx, {
        entidade: 'veterinario',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { nome: dados.nome, crmv: dados.crmv, crmvUf: dados.crmvUf },
        justificativa: ignorarDuplicidade
          ? 'Criado apesar do aviso de possível duplicidade (M03 seção 20).'
          : undefined,
      });

      return { id: novo!.id };
    });
  }

  async editarVeterinario(id: string, dados: Partial<DadosVeterinario>): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscarVeterinario(tx, id);

      const mudancas: Record<string, unknown> = {};
      if (dados.nome !== undefined) mudancas.nome = dados.nome.trim();
      if (dados.crmv !== undefined) mudancas.crmv = dados.crmv.trim() || null;
      if (dados.crmvUf !== undefined) mudancas.crmvUf = dados.crmvUf.trim().toUpperCase() || null;
      if (dados.email !== undefined) mudancas.email = dados.email.trim() || null;
      if (dados.telefone !== undefined) mudancas.telefone = dados.telefone.trim() || null;
      if (dados.especialidade !== undefined)
        mudancas.especialidade = dados.especialidade.trim() || null;

      if (Object.keys(mudancas).length === 0) return;

      await tx
        .update(veterinario)
        .set({ ...mudancas, atualizadoEm: new Date() })
        .where(eq(veterinario.id, id));

      await this.auditoria.registrarAlteracao(
        tx,
        'veterinario',
        id,
        {
          nome: atual.nome,
          crmv: atual.crmv,
          crmvUf: atual.crmvUf,
          email: atual.email,
          telefone: atual.telefone,
          especialidade: atual.especialidade,
        },
        mudancas,
      );
    });
  }

  async inativarVeterinario(id: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const atual = await this.buscarVeterinario(tx, id);
      if (atual.inativadoEm) throw new BadRequestException('Este veterinário já está inativo.');

      await tx
        .update(veterinario)
        .set({
          inativadoEm: new Date(),
          inativadoPor: ctx.usuarioId,
          status: 'inativo',
          atualizadoEm: new Date(),
        })
        .where(eq(veterinario.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'veterinario',
        entidadeId: id,
        acao: 'inativar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'inativo' },
      });
    });
  }

  async reativarVeterinario(id: string): Promise<void> {
    return this.db.executar(async (tx) => {
      const atual = await this.buscarVeterinario(tx, id);
      if (!atual.inativadoEm) throw new BadRequestException('Este veterinário já está ativo.');

      await tx
        .update(veterinario)
        .set({ inativadoEm: null, inativadoPor: null, status: 'ativo', atualizadoEm: new Date() })
        .where(eq(veterinario.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'veterinario',
        entidadeId: id,
        acao: 'reativar',
        valorAnterior: { status: atual.status },
        valorNovo: { status: 'ativo' },
      });
    });
  }

  async listarVeterinarios(filtros: { q?: string }): Promise<unknown[]> {
    const ctx = exigirContexto();

    const condicoes = [eq(veterinario.tenantId, ctx.tenantId)];
    if (filtros.q?.trim()) {
      const q = `%${filtros.q.trim()}%`;
      condicoes.push(
        or(ilike(veterinario.nome, q), ilike(veterinario.crmv, q), ilike(veterinario.email, q))!,
      );
    }

    return this.db.executar((tx) =>
      tx
        .select({
          id: veterinario.id,
          nome: veterinario.nome,
          crmv: veterinario.crmv,
          crmvUf: veterinario.crmvUf,
          email: veterinario.email,
          telefone: veterinario.telefone,
          especialidade: veterinario.especialidade,
          status: veterinario.status,
          inativadoEm: veterinario.inativadoEm,
          /**
           * Vinculos vigentes - termino nulo (secao 35). Identificadores da
           * tabela externa qualificados a mao - ver nota no totalCasos.
           */
          vinculos: sql<string>`coalesce((
            select string_agg(c.nome_fantasia, ' · ' order by c.nome_fantasia)
            from ${vinculoVeterinarioCliente} v
            join ${cliente} c on c.id = v.cliente_id
            where v.veterinario_id = veterinario.id
              and v.tenant_id = veterinario.tenant_id
              and v.termino_em is null
          ), '')`,
        })
        .from(veterinario)
        .where(and(...condicoes))
        .orderBy(asc(veterinario.nome))
        .limit(200),
    );
  }

  // --- vinculos (secoes 13-14, 35-36) ---------------------------------------

  async vincular(
    veterinarioId: string,
    clienteId: string,
    dados: { cargo?: string; principal?: boolean },
  ): Promise<{ id: string }> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      await this.buscarVeterinario(tx, veterinarioId);
      await this.buscarCliente(tx, clienteId);

      const [existente] = await tx
        .select({ id: vinculoVeterinarioCliente.id, terminoEm: vinculoVeterinarioCliente.terminoEm })
        .from(vinculoVeterinarioCliente)
        .where(
          and(
            eq(vinculoVeterinarioCliente.veterinarioId, veterinarioId),
            eq(vinculoVeterinarioCliente.clienteId, clienteId),
          ),
        )
        .limit(1);

      /**
       * Secao 36: o profissional que VOLTA a instituicao reativa o vinculo
       * encerrado - o schema garante um registro por par, e recriar apagaria
       * as datas do periodo anterior.
       */
      if (existente) {
        if (!existente.terminoEm) {
          throw new BadRequestException('Este veterinário já está vinculado a este cliente.');
        }

        await tx
          .update(vinculoVeterinarioCliente)
          .set({
            terminoEm: null,
            inicioEm: sql`current_date`,
            cargo: dados.cargo?.trim() || null,
            principal: dados.principal ?? false,
            atualizadoEm: new Date(),
          })
          .where(eq(vinculoVeterinarioCliente.id, existente.id));

        await this.auditoria.registrar(tx, {
          entidade: 'vinculo_veterinario_cliente',
          entidadeId: existente.id,
          acao: 'reativar',
          valorNovo: { veterinarioId, clienteId },
        });

        return { id: existente.id };
      }

      const [novo] = await tx
        .insert(vinculoVeterinarioCliente)
        .values({
          tenantId: ctx.tenantId,
          veterinarioId,
          clienteId,
          cargo: dados.cargo?.trim() || null,
          principal: dados.principal ?? false,
          inicioEm: sql`current_date`,
        })
        .returning({ id: vinculoVeterinarioCliente.id });

      await this.auditoria.registrar(tx, {
        entidade: 'vinculo_veterinario_cliente',
        entidadeId: novo!.id,
        acao: 'criar',
        valorNovo: { veterinarioId, clienteId, cargo: dados.cargo },
      });

      return { id: novo!.id };
    });
  }

  /**
   * Secao 35: encerrar tira o profissional das opcoes padrao daquele cliente;
   * os exames anteriores permanecem vinculados e o cadastro segue ativo se
   * houver outros vinculos.
   */
  async encerrarVinculo(id: string): Promise<void> {
    const ctx = exigirContexto();

    return this.db.executar(async (tx) => {
      const [vinculo] = await tx
        .select({
          id: vinculoVeterinarioCliente.id,
          terminoEm: vinculoVeterinarioCliente.terminoEm,
        })
        .from(vinculoVeterinarioCliente)
        .where(
          and(
            eq(vinculoVeterinarioCliente.tenantId, ctx.tenantId),
            eq(vinculoVeterinarioCliente.id, id),
          ),
        )
        .limit(1);

      if (!vinculo) throw new NotFoundException('Vínculo não encontrado.');
      if (vinculo.terminoEm) throw new BadRequestException('Este vínculo já está encerrado.');

      await tx
        .update(vinculoVeterinarioCliente)
        .set({ terminoEm: sql`current_date`, principal: false, atualizadoEm: new Date() })
        .where(eq(vinculoVeterinarioCliente.id, id));

      await this.auditoria.registrar(tx, {
        entidade: 'vinculo_veterinario_cliente',
        entidadeId: id,
        acao: 'encerrar',
      });
    });
  }

  // --- internos -------------------------------------------------------------

  private async barrarClienteDuplicado(tx: Transacao, dados: DadosCliente): Promise<void> {
    const ctx = exigirContexto();
    const documento = dados.documento?.replace(/\D/g, '');

    const suspeitas = [ilike(cliente.nomeFantasia, dados.nomeFantasia.trim())];
    if (documento) suspeitas.push(eq(cliente.documento, documento));

    const candidatos = await tx
      .select({
        id: cliente.id,
        nomeFantasia: cliente.nomeFantasia,
        documento: cliente.documento,
        codigo: cliente.codigo,
        status: cliente.status,
      })
      .from(cliente)
      .where(and(eq(cliente.tenantId, ctx.tenantId), or(...suspeitas)))
      .limit(5);

    if (candidatos.length > 0) {
      throw new ConflictException({
        detail:
          'Já existe cadastro com o mesmo documento ou nome. Abra o existente ou confirme que é outro cliente.',
        duplicidades: candidatos,
      });
    }
  }

  private async barrarVeterinarioDuplicado(
    tx: Transacao,
    dados: DadosVeterinario,
  ): Promise<void> {
    const ctx = exigirContexto();

    const suspeitas = [ilike(veterinario.nome, dados.nome.trim())];
    if (dados.crmv?.trim() && dados.crmvUf?.trim()) {
      suspeitas.push(
        and(
          eq(veterinario.crmv, dados.crmv.trim()),
          eq(veterinario.crmvUf, dados.crmvUf.trim().toUpperCase()),
        )!,
      );
    }

    const candidatos = await tx
      .select({
        id: veterinario.id,
        nome: veterinario.nome,
        crmv: veterinario.crmv,
        crmvUf: veterinario.crmvUf,
        status: veterinario.status,
      })
      .from(veterinario)
      .where(and(eq(veterinario.tenantId, ctx.tenantId), or(...suspeitas)))
      .limit(5);

    if (candidatos.length > 0) {
      throw new ConflictException({
        detail:
          'Já existe profissional com o mesmo CRMV ou nome. O veterinário é pessoa única com N vínculos (M03) - vincule o existente ao cliente em vez de recadastrar.',
        duplicidades: candidatos,
      });
    }
  }

  private async buscarCliente(tx: Transacao, id: string) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select()
      .from(cliente)
      .where(and(eq(cliente.tenantId, ctx.tenantId), eq(cliente.id, id)))
      .limit(1);
    if (!linha) throw new NotFoundException('Cliente não encontrado.');
    return linha;
  }

  private async buscarVeterinario(tx: Transacao, id: string) {
    const ctx = exigirContexto();
    const [linha] = await tx
      .select()
      .from(veterinario)
      .where(and(eq(veterinario.tenantId, ctx.tenantId), eq(veterinario.id, id)))
      .limit(1);
    if (!linha) throw new NotFoundException('Veterinário não encontrado.');
    return linha;
  }
}

/** Mesmo principio da sessao: guarda-se o hash, nunca o token. */
function hashDoToken(tokenBruto: string): string {
  return createHash('sha256').update(tokenBruto).digest('hex');
}

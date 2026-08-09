import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, eq, isNull } from 'drizzle-orm';
import {
  cliente,
  servico,
  tabelaMestre,
  termo,
  unidade,
  veterinario,
  vinculoVeterinarioCliente,
} from '@lapato/db';
import { PERMISSOES } from '@lapato/shared';
import { DbService } from '../../core/db/db.service.js';
import { ExigePermissao } from '../../core/auth/guards.js';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/**
 * M01 - dados mestres consumidos pelas telas.
 *
 * DIRETRIZES secao 4: estes registros existem uma unica vez; os demais modulos
 * usam por REFERENCIA. Este controller e a porta de leitura.
 *
 * M01: inativados nao aparecem em novos registros, mas permanecem nos casos
 * historicos - por isso as listagens filtram `inativadoEm IS NULL`, e nao
 * apagam nada.
 */
@ApiTags('M01 - Administração e Configurações')
@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly db: DbService) {}

  @Get('servicos')
  @ExigePermissao(PERMISSOES.CASO_VISUALIZAR)
  @ApiOperation({ summary: 'Serviços ativos, com as flags que definem o fluxo' })
  async servicos() {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      return tx
        .select({
          id: servico.id,
          nome: servico.nome,
          codigo: servico.codigo,
          modalidade: servico.modalidade,
          exigeTriagem: servico.exigeTriagem,
          exigeMacroscopia: servico.exigeMacroscopia,
          exigeProcessamento: servico.exigeProcessamento,
          exigeMicroscopia: servico.exigeMicroscopia,
          prazoDiasUteis: servico.prazoDiasUteis,
        })
        .from(servico)
        .where(and(eq(servico.tenantId, ctx.tenantId), isNull(servico.inativadoEm)));
    });
  }

  @Get('unidades')
  @ExigePermissao(PERMISSOES.CASO_VISUALIZAR)
  @ApiOperation({ summary: 'Unidades da instituição' })
  async unidades() {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      return tx
        .select({ id: unidade.id, nome: unidade.nome, codigo: unidade.codigo, tipo: unidade.tipo })
        .from(unidade)
        .where(and(eq(unidade.tenantId, ctx.tenantId), isNull(unidade.inativadoEm)));
    });
  }

  @Get('clientes')
  @ExigePermissao(PERMISSOES.CLIENTE_VISUALIZAR)
  @ApiOperation({ summary: 'Clientes ativos' })
  async clientes() {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      return tx
        .select({
          id: cliente.id,
          nomeFantasia: cliente.nomeFantasia,
          codigo: cliente.codigo,
          tipo: cliente.tipo,
          status: cliente.status,
        })
        .from(cliente)
        .where(and(eq(cliente.tenantId, ctx.tenantId), isNull(cliente.inativadoEm)));
    });
  }

  @Get('veterinarios')
  @ExigePermissao(PERMISSOES.VETERINARIO_VISUALIZAR)
  @ApiOperation({
    summary: 'Veterinários, opcionalmente filtrados por cliente',
    description:
      'O veterinário é pessoa única com N vínculos; filtrar por cliente usa o vínculo, ' +
      'não uma cópia do cadastro (M03).',
  })
  async veterinarios(@Query('clienteId') clienteId?: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();

      if (!clienteId) {
        return tx
          .select({
            id: veterinario.id,
            nome: veterinario.nome,
            crmv: veterinario.crmv,
            crmvUf: veterinario.crmvUf,
          })
          .from(veterinario)
          .where(
            and(eq(veterinario.tenantId, ctx.tenantId), isNull(veterinario.inativadoEm)),
          );
      }

      return tx
        .select({
          id: veterinario.id,
          nome: veterinario.nome,
          crmv: veterinario.crmv,
          crmvUf: veterinario.crmvUf,
        })
        .from(vinculoVeterinarioCliente)
        .innerJoin(veterinario, eq(veterinario.id, vinculoVeterinarioCliente.veterinarioId))
        .where(
          and(
            eq(vinculoVeterinarioCliente.tenantId, ctx.tenantId),
            eq(vinculoVeterinarioCliente.clienteId, clienteId),
            isNull(vinculoVeterinarioCliente.terminoEm),
          ),
        );
    });
  }

  @Get('tabelas/:chave')
  @ExigePermissao(PERMISSOES.CASO_VISUALIZAR)
  @ApiOperation({
    summary: 'Termos de uma tabela mestre (espécie, órgão, fixador, coloração...)',
  })
  async tabela(@Query('chave') chave: string) {
    return this.db.executar(async (tx) => {
      const ctx = exigirContexto();
      return tx
        .select({ id: termo.id, valor: termo.valor, codigo: termo.codigo, ordem: termo.ordem })
        .from(termo)
        .innerJoin(tabelaMestre, eq(tabelaMestre.id, termo.tabelaId))
        .where(
          and(
            eq(termo.tenantId, ctx.tenantId),
            eq(tabelaMestre.chave, chave),
            isNull(termo.inativadoEm),
          ),
        );
    });
  }
}

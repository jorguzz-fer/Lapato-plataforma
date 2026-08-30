import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { sequenciaNumeracao, type Transacao } from '@lapato/db';
import {
  MASCARA_CASO_PADRAO,
  formatarIdentificadorCaso,
  identificadorCadaver,
  identificadorColeta,
  identificadorEmprestimo,
  identificadorInventario,
  identificadorLoteDescarte,
  identificadorObjetoBiologico,
  identificadorImagem,
  identificadorOrdemServico,
  identificadorRemessa,
  identificadorSolicitacao,
  type MascaraCaso,
} from '@lapato/shared';
import { exigirContexto } from '../../core/contexto/contexto-requisicao.js';

/**
 * M01 secao 12 - alocacao de numeracao.
 *
 * Regra dura do modulo: o sequencial e unico, automatico e **nunca
 * reutilizavel**, preservado mesmo quando o caso e cancelado.
 *
 * Por isso o contador vive numa linha propria e e incrementado com
 * `UPDATE ... RETURNING` dentro da transacao do request: dois cadastros
 * simultaneos serializam no lock da linha em vez de gerarem o mesmo numero.
 * Um `SELECT` seguido de `UPDATE` teria condicao de corrida; uma sequence do
 * Postgres nao permitiria a serie por cliente e por ano que o M01 pede.
 */
@Injectable()
export class NumeracaoService {
  /**
   * Reserva o proximo numero de uma serie.
   *
   * O numero fica gasto mesmo se a transacao seguir e falhar depois - o que e
   * exatamente o comportamento desejado: buraco na sequencia e aceitavel,
   * numero repetido nao e.
   */
  private async proximo(
    tx: Transacao,
    escopo: string,
    ano: number,
    discriminador = '',
  ): Promise<number> {
    const ctx = exigirContexto();

    // Cria a serie se ainda nao existe, sem falhar em concorrencia.
    await tx
      .insert(sequenciaNumeracao)
      .values({
        tenantId: ctx.tenantId,
        escopo,
        ano,
        discriminador,
        proximoValor: 1,
      })
      .onConflictDoNothing();

    const [linha] = await tx
      .update(sequenciaNumeracao)
      .set({ proximoValor: sql`${sequenciaNumeracao.proximoValor} + 1` })
      .where(
        and(
          eq(sequenciaNumeracao.tenantId, ctx.tenantId),
          eq(sequenciaNumeracao.escopo, escopo),
          eq(sequenciaNumeracao.ano, ano),
          eq(sequenciaNumeracao.discriminador, discriminador),
        ),
      )
      .returning({ valor: sequenciaNumeracao.proximoValor });

    if (!linha) throw new Error(`Falha ao alocar numeracao para "${escopo}".`);

    // `proximoValor` ja foi incrementado; o numero alocado e o anterior.
    return linha.valor - 1;
  }

  /**
   * Identificador oficial do caso.
   *
   * A serie e por cliente e por ano, conforme o exemplo do M01
   * (`HV342/26` = sigla do cliente + sequencial + ano).
   */
  async proximoCaso(
    tx: Transacao,
    siglaCliente: string,
    ano: number,
    mascara: MascaraCaso = MASCARA_CASO_PADRAO,
  ): Promise<{ identificador: string; sequencial: number }> {
    const sequencial = await this.proximo(tx, 'caso', ano, siglaCliente.toUpperCase());
    return {
      identificador: formatarIdentificadorCaso({ siglaCliente, sequencial, ano }, mascara),
      sequencial,
    };
  }

  async proximaSolicitacao(tx: Transacao, ano: number): Promise<string> {
    return identificadorSolicitacao(ano, await this.proximo(tx, 'solicitacao', ano));
  }

  async proximaOrdemServico(tx: Transacao, ano: number): Promise<string> {
    return identificadorOrdemServico(ano, await this.proximo(tx, 'ordem_servico', ano));
  }

  async proximaImagem(tx: Transacao, ano: number): Promise<string> {
    return identificadorImagem(ano, await this.proximo(tx, 'imagem', ano));
  }

  async proximaRemessa(tx: Transacao, ano: number): Promise<string> {
    return identificadorRemessa(ano, await this.proximo(tx, 'remessa', ano));
  }

  async proximoCadaver(tx: Transacao, ano: number): Promise<string> {
    return identificadorCadaver(ano, await this.proximo(tx, 'cadaver', ano));
  }

  async proximoObjetoBiologico(tx: Transacao, ano: number): Promise<string> {
    return identificadorObjetoBiologico(ano, await this.proximo(tx, 'objeto_biologico', ano));
  }

  async proximoEmprestimo(tx: Transacao, ano: number): Promise<string> {
    return identificadorEmprestimo(ano, await this.proximo(tx, 'emprestimo', ano));
  }

  async proximoInventario(tx: Transacao, ano: number): Promise<string> {
    return identificadorInventario(ano, await this.proximo(tx, 'inventario', ano));
  }

  async proximoLoteDescarte(tx: Transacao, ano: number): Promise<string> {
    return identificadorLoteDescarte(ano, await this.proximo(tx, 'lote_descarte', ano));
  }

  async proximaColeta(tx: Transacao, ano: number): Promise<string> {
    return identificadorColeta(ano, await this.proximo(tx, 'coleta', ano));
  }

  /** Lote de envio ao laboratorio de apoio (M09), identificado pela data. */
  async proximoLote(tx: Transacao, ano: number): Promise<string> {
    const seq = await this.proximo(tx, 'lote', ano);
    return `LOTE-${ano}-${String(seq).padStart(5, '0')}`;
  }
}

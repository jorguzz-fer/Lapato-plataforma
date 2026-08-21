import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as TOTP from 'otpauth';
import { AppModule } from './app.module.js';
import { ProblemaFilter } from './core/http/problema.filter.js';

/**
 * Teste ponta a ponta da fatia vertical.
 *
 * Percorre o fluxo completo da histopatologia:
 *   Cadastro -> Recebimento -> Triagem -> Macroscopia -> Cassetes ->
 *   Envio ao laboratorio de apoio -> Laminas -> Microscopia -> Laudo ->
 *   Revisao -> Assinatura -> Liberacao
 *
 * O que este teste prova, alem do caminho feliz:
 *
 * - **Modo sem IA funciona** (M17 secoes 110-112): roda com
 *   `COPILOT_PROVIDER=stub`, e o Copiloto reporta indisponivel do inicio ao fim.
 *   Ainda assim o laudo e assinado e liberado.
 * - **O Guardian bloqueia de verdade**: lateralidade divergente entre cadastro e
 *   laudo impede a assinatura, com 409 e o achado estruturado.
 * - **O fluxo nao avanca com triagem bloqueada.**
 * - **A linha do tempo e unica** e contem os eventos de todos os modulos.
 *
 * Depende de um Postgres com migrations e seed aplicados.
 */

const BASE = '/api/v1';

let app: INestApplication;
let servidor: string;
let cookie = '';

async function req(
  metodo: string,
  caminho: string,
  corpo?: unknown,
): Promise<{ status: number; body: any }> {
  const resposta = await fetch(`${servidor}${BASE}${caminho}`, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  const setCookie = resposta.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0]!;

  const texto = await resposta.text();
  return { status: resposta.status, body: texto ? JSON.parse(texto) : null };
}

/** O mesmo segredo que o seed grava nos usuarios que exigem MFA. */
const SEGREDO_MFA_DEMO = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export function codigoTotp(segredo = SEGREDO_MFA_DEMO): string {
  return new TOTP.TOTP({
    issuer: process.env.MFA_ISSUER ?? 'LAPATO',
    secret: TOTP.Secret.fromBase32(segredo),
  }).generate();
}

/**
 * Login completo: senha e, quando o perfil exige, o segundo fator.
 *
 * Atravessar o funil inteiro aqui e proposital - se algum estagio deixar de
 * destravar, todos os testes de fluxo quebram junto, e nao so um teste de auth.
 */
async function entrar(email: string): Promise<void> {
  cookie = '';
  const r = await req('POST', '/auth/login', {
    instituicao: 'demo',
    email,
    senha: 'lapato123',
  });
  expect(r.status, `login de ${email}: ${JSON.stringify(r.body)}`).toBe(200);

  if (r.body.estagio === 'mfa_pendente') {
    const mfa = await req('POST', '/auth/mfa', { codigo: codigoTotp() });
    expect(mfa.status, `mfa de ${email}: ${JSON.stringify(mfa.body)}`).toBe(200);
    expect(mfa.body.estagio).toBe('ativa');
    return;
  }

  expect(r.body.estagio, `estagio inesperado para ${email}`).toBe('ativa');
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://lapato_app:lapato@127.0.0.1:5432/lapato';
  process.env.SESSION_SECRET ??= 'x'.repeat(48);
  process.env.COPILOT_PROVIDER = 'stub';
  process.env.NODE_ENV = 'test';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemaFilter());

  await app.listen(0);
  servidor = await app.getUrl();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('autenticação e autorização', () => {
  test('rota protegida recusa acesso sem sessão', async () => {
    cookie = '';
    const r = await req('GET', '/catalogo/servicos');
    expect(r.status).toBe(401);
  });

  test('login inexistente não revela se a conta existe', async () => {
    cookie = '';
    const inexistente = await req('POST', '/auth/login', {
      instituicao: 'demo',
      email: 'ninguem@lapato.local',
      senha: 'errada',
    });
    const senhaErrada = await req('POST', '/auth/login', {
      instituicao: 'demo',
      email: 'admin@lapato.local',
      senha: 'errada',
    });

    expect(inexistente.status).toBe(401);
    expect(senhaErrada.status).toBe(401);
    // Mesma mensagem nos dois casos: sem enumeração (Blueprint seção 6).
    expect(inexistente.body.detail).toBe(senhaErrada.body.detail);
  });

  /**
   * M02: o residente elabora e propõe, mas não assina nem libera. A permissão
   * simplesmente não existe no perfil - não é uma checagem no front.
   */
  test('residente não tem permissão de assinar nem liberar', async () => {
    await entrar('residente@lapato.local');
    const r = await req('GET', '/auth/eu');

    expect(r.status).toBe(200);
    expect(r.body.permissoes).not.toContain('laudo:assinar');
    expect(r.body.permissoes).not.toContain('laudo:liberar');
    expect(r.body.exigeSupervisao).toBe(true);
  });

  /**
   * M09: o laboratório de apoio é externo e só enxerga o processamento.
   * Ele não deve conseguir abrir a lista de casos nem o catálogo clínico.
   */
  test('laboratório de apoio não acessa dados clínicos', async () => {
    await entrar('apoio@lapato.local');
    const r = await req('GET', '/fluxo/casos');
    expect(r.status).toBe(403);
  });
});

describe('modo sem IA (M17 seções 110-112)', () => {
  test('a assistência reporta indisponível e o trabalho segue', async () => {
    await entrar('patologista@lapato.local');
    const r = await req('GET', '/ia/status');

    expect(r.status).toBe(200);
    expect(r.body.disponivel).toBe(false);
    expect(r.body.provedor).toBe('stub');
  });
});

describe('fatia vertical: histopatologia de ponta a ponta', () => {
  /**
   * Microchip unico por execucao.
   *
   * O banco de teste nao e recriado entre rodadas, e o Guardian trata
   * "mesmo microchip em outro paciente" como problema critico de identidade
   * (M05). Reusar um valor fixo faria a segunda rodada ser bloqueada - pelo
   * motivo certo, mas atrapalhando o teste do caminho feliz.
   */
  const microchip = `9001${Date.now().toString().slice(-11)}`;

  let servicoId: string;
  let clienteId: string;
  let casoId: string;
  let amostraId: string;
  let recipienteId: string;
  let macroscopiaId: string;
  let casseteId: string;
  let loteId: string;
  let laudoId: string;
  let versaoId: string;

  /**
   * A rota declara `:chave` no caminho e por um tempo leu o valor da query, o
   * que fazia `/catalogo/tabelas/especie` responder 500 - a URL que qualquer
   * tela usaria. Passou despercebido porque nenhum teste a exercitava e nenhuma
   * tela a consumia ainda.
   */
  test('0. tabela mestre responde pelo caminho, não pela query', async () => {
    await entrar('admin@lapato.local');

    const r = await req('GET', '/catalogo/tabelas/especie');

    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.map((t: any) => t.valor)).toContain('Canina');
  });

  test('1. recepção cadastra o caso', async () => {
    await entrar('admin@lapato.local');

    const servicos = await req('GET', '/catalogo/servicos');
    servicoId = servicos.body.find((s: any) => s.codigo === 'HISTO').id;

    const clientes = await req('GET', '/catalogo/clientes');
    clienteId = clientes.body[0].id;

    const r = await req('POST', '/casos', {
      servicoId,
      clienteId,
      paciente: {
        nome: 'Thor',
        sexo: 'macho',
        microchip,
        tutorNome: 'Helena Braga',
      },
      historicoClinico: 'Nódulo cutâneo em região escapular direita, evolução de 3 meses.',
      amostras: [
        {
          descricao: 'Nódulo cutâneo',
          regiaoAnatomica: 'Região escapular',
          // Lateralidade DIREITA no cadastro. O Guardian vai comparar com o laudo.
          lateralidade: 'direito',
          tipoRelacao: 'lesao_principal',
        },
      ],
      recipientes: [{ quantidadeDeclarada: 1, identificacaoExterna: 'FRASCO-1' }],
    });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    casoId = r.body.id;

    // M01: o identificador segue a máscara do serviço, com a sigla do cliente.
    expect(r.body.identificador).toMatch(/^CV-\d{6}\/\d{2}$/);
  });

  test('2. o dossiê já existe com a linha do tempo iniciada', async () => {
    const r = await req('GET', `/casos/${casoId}`);

    expect(r.status).toBe(200);
    expect(r.body.amostras).toHaveLength(1);
    expect(r.body.recipientes).toHaveLength(1);
    expect(r.body.estado.etapa).toBe('aguardando_recebimento');
    expect(r.body.linhaDoTempo.map((e: any) => e.tipo)).toContain('caso.criado');

    amostraId = r.body.amostras[0].id;
    recipienteId = r.body.recipientes[0].id;
  });

  test('3. recebimento registra divergência sem apagar o declarado', async () => {
    const r = await req('POST', `/casos/${casoId}/recebimento`, {
      // Declarado 1, recebido 2: a divergência é dado, não erro a corrigir (M05).
      conferencia: [{ recipienteId, quantidadeRecebida: 2 }],
    });

    expect(r.status).toBe(201);
    expect(r.body.divergencias).toBe(1);

    const dossie = await req('GET', `/casos/${casoId}`);
    const rec = dossie.body.recipientes[0];
    expect(rec.quantidadeDeclarada).toBe(1);
    expect(rec.quantidadeRecebida).toBe(2);
    expect(dossie.body.estado.etapa).toBe('aguardando_triagem');
  });

  test('4. triagem apta libera para macroscopia', async () => {
    const r = await req('POST', `/casos/${casoId}/triagem`, {
      amostras: [
        {
          amostraId,
          resultado: 'apto_com_ressalva',
          observacoes: 'Quantidade de frascos diverge do declarado.',
        },
      ],
      naoConformidades: [
        {
          amostraId,
          tipo: 'divergencia_quantidade',
          gravidade: 'moderada',
          descricao: 'Recebidos 2 frascos, requisição declara 1.',
        },
      ],
    });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.resultado).toBe('apto_com_ressalva');

    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.body.estado.etapa).toBe('aguardando_macroscopia');

    // A não conformidade fica registrada mesmo com o caso avançando (M05).
    const tipos = dossie.body.linhaDoTempo.map((e: any) => e.tipo);
    expect(tipos).toContain('nao_conformidade.registrada');
    expect(tipos).toContain('triagem.concluida.ressalva');
  });

  test('5. macroscopia gera cassetes com tecido de origem', async () => {
    await entrar('patologista@lapato.local');

    const inicio = await req('POST', `/macroscopia/amostras/${amostraId}`);
    expect(inicio.status).toBe(201);
    macroscopiaId = inicio.body.id;

    const salvar = await req('POST', `/macroscopia/${macroscopiaId}`, {
      descricaoTexto: 'Fragmento de pele com formação nodular, 2,5 x 2,0 x 1,5 cm.',
      comprimentoCm: 2.5,
      larguraCm: 2.0,
      alturaCm: 1.5,
      lesoes: [{ rotulo: 'L01', tipo: 'nódulo', lateralidade: 'direito', maiorEixoCm: 2.5 }],
      margens: [{ nome: 'Profunda', metodoAmostragem: 'perpendicular', distanciaCm: 0.4 }],
      cassetes: [
        { tecidoOrigem: 'Nódulo — centro', descricao: 'Corte representativo' },
        { tecidoOrigem: 'Margem profunda' },
      ],
    });
    expect(salvar.status, JSON.stringify(salvar.body)).toBe(201);

    const concluir = await req('POST', `/macroscopia/${macroscopiaId}/conclusao`);
    expect(concluir.status, JSON.stringify(concluir.body)).toBe(201);

    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.body.estado.etapa).toBe('aguardando_processamento');

    const evento = dossie.body.linhaDoTempo.find((e: any) => e.tipo === 'cassetes.gerados');
    expect(evento.payload.cassetes).toHaveLength(2);
    // M08/M09: o identificador do cassete carrega o do caso.
    expect(evento.payload.cassetes[0]).toMatch(/^CV-\d{6}\/\d{2}-A1$/);
  });

  test('6. técnico envia o lote ao laboratório de apoio', async () => {
    await entrar('tecnico@lapato.local');

    const fila = await req('GET', '/fluxo/casos?etapa=aguardando_processamento');
    expect(fila.body.some((c: any) => c.casoId === casoId)).toBe(true);

    const cassetes = await req('GET', `/macroscopia/casos/${casoId}/cassetes`);
    expect(cassetes.status).toBe(200);
    expect(cassetes.body).toHaveLength(2);
    casseteId = cassetes.body[0].id;

    const lote = await req('POST', '/processamento/lotes', {
      casseteIds: cassetes.body.map((c: any) => c.id),
    });

    expect(lote.status, JSON.stringify(lote.body)).toBe(201);
    expect(lote.body.total).toBe(2);
    loteId = lote.body.id;
  });

  test('7. laboratório de apoio confere o lote e aponta divergência', async () => {
    // M09: o parceiro é usuário externo do sistema e opera só o processamento.
    await entrar('apoio@lapato.local');

    const cassetes = await req('GET', `/macroscopia/casos/${casoId}/cassetes`);
    expect(cassetes.status).toBe(200);

    const conferencia = await req('POST', `/processamento/lotes/${loteId}/conferencia`, {
      confirmados: [casseteId],
      divergencias: [
        {
          tipo: 'numeracao_errada',
          descricao: 'Segundo cassete chegou com numeração ilegível.',
          codigoInformado: 'ILEGIVEL',
        },
      ],
    });

    expect(conferencia.status, JSON.stringify(conferencia.body)).toBe(201);
    expect(conferencia.body.divergencias).toBe(1);
  });

  test('8. laboratório de apoio registra as lâminas produzidas', async () => {
    const cassetes = await req('GET', `/macroscopia/casos/${casoId}/cassetes`);

    const r = await req('POST', `/processamento/lotes/${loteId}/laminas`, {
      laminas: cassetes.body.map((c: any) => ({ casseteId: c.id, coloracao: 'HE' })),
    });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.total).toBe(2);

    await entrar('patologista@lapato.local');
    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.body.estado.etapa).toBe('aguardando_microscopia');
  });

  test('9. patologista redige o laudo estruturado', async () => {
    const abrir = await req('POST', `/laudos/casos/${casoId}`);
    expect(abrir.status, JSON.stringify(abrir.body)).toBe(201);
    laudoId = abrir.body.laudoId;
    versaoId = abrir.body.versaoId;
    expect(abrir.body.versao).toBe(1);

    const salvar = await req('POST', `/laudos/versoes/${versaoId}`, {
      descricaoMicroscopica:
        'Proliferação de células redondas na derme, com moderada anisocariose.',
      conclusao: 'Mastocitoma cutâneo de baixo grau.',
      notaInterna: 'Confirmar com Giemsa se necessário.',
      diagnosticos: [
        {
          amostraId,
          textoExibido: 'Mastocitoma cutâneo, baixo grau',
          entidade: 'Mastocitoma',
          comportamento: 'maligno',
          // Lateralidade DIREITA, batendo com o cadastro.
          lateralidade: 'direito',
          classificacaoNome: 'Kiupel',
          classificacaoVersao: '2011',
          grau: 'baixo',
          // M13 seção 120: os critérios individuais ficam, não só o escore.
          criteriosGraduacao: { mitoses: 2, cariomegalia: false, multinucleadas: 0 },
        },
      ],
      margens: [{ nome: 'Profunda', resultado: 'livre', distanciaMm: 4 }],
    });

    expect(salvar.status, JSON.stringify(salvar.body)).toBe(201);
  });

  test('10. o Guardian bloqueia assinatura com lateralidade divergente', async () => {
    // Grava um diagnóstico com o lado ERRADO, contradizendo o cadastro.
    await req('POST', `/laudos/versoes/${versaoId}`, {
      diagnosticos: [
        {
          amostraId,
          textoExibido: 'Mastocitoma cutâneo, baixo grau',
          entidade: 'Mastocitoma',
          lateralidade: 'esquerdo',
        },
      ],
    });

    const r = await req('POST', `/laudos/versoes/${versaoId}/assinatura`);

    // M17: achado crítico bloqueia. O erro sai em RFC 7807 com os achados.
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/Guardian/);
    const codigos = r.body.achados.map((a: any) => a.codigo);
    expect(codigos).toContain('LATERALIDADE_DIVERGENTE');

    const critico = r.body.achados.find((a: any) => a.codigo === 'LATERALIDADE_DIVERGENTE');
    expect(critico.nivel).toBe('critico');
    expect(critico.evidencias.cadastro).toBe('direito');
    expect(critico.evidencias.laudo).toBe('esquerdo');
  });

  test('11. corrigida a lateralidade, a assinatura passa', async () => {
    await req('POST', `/laudos/versoes/${versaoId}`, {
      diagnosticos: [
        {
          amostraId,
          textoExibido: 'Mastocitoma cutâneo, baixo grau',
          entidade: 'Mastocitoma',
          lateralidade: 'direito',
          classificacaoNome: 'Kiupel',
          classificacaoVersao: '2011',
          grau: 'baixo',
          criteriosGraduacao: { mitoses: 2 },
        },
      ],
    });

    const r = await req('POST', `/laudos/versoes/${versaoId}/assinatura`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // M11: código do QR Code de validação de autenticidade.
    expect(r.body.codigoValidacao).toBeTruthy();
  });

  test('12. liberação dispara as consequências automatizadas', async () => {
    const r = await req('POST', `/laudos/versoes/${versaoId}/liberacao`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.body.estado.etapa).toBe('liberado');

    /**
     * DIRETRIZES seção 17: o patologista executou UMA ação. A linha do tempo
     * precisa mostrar o caminho inteiro, de todos os módulos, num só lugar.
     */
    const tipos = dossie.body.linhaDoTempo.map((e: any) => e.tipo);
    for (const esperado of [
      'caso.criado',
      'material.recebido',
      'triagem.concluida.ressalva',
      'macroscopia.iniciada',
      'macroscopia.concluida',
      'cassetes.gerados',
      'lote.enviado',
      'divergencia.cassetes',
      'laminas.disponiveis',
      'microscopia.iniciada',
      'laudo.assinado',
      'laudo.liberado',
      'fluxo.etapa_alterada',
    ]) {
      expect(tipos, `evento ausente na linha do tempo: ${esperado}`).toContain(esperado);
    }
  });

  test('13. adendo cria nova versão e preserva a anterior', async () => {
    const r = await req('POST', `/laudos/${laudoId}/versoes`, {
      tipo: 'adendo',
      motivo: 'Resultado de imuno-histoquímica complementar.',
    });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.versao).toBe(2);

    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.body.linhaDoTempo.map((e: any) => e.tipo)).toContain('laudo.adendo_criado');
  });

  test('14. adendo exige motivo', async () => {
    const r = await req('POST', `/laudos/${laudoId}/versoes`, { tipo: 'adendo', motivo: '' });
    expect(r.status).toBe(400);
  });
});

describe('triagem bloqueada impede o avanço do fluxo', () => {
  test('caso com triagem bloqueada não chega à macroscopia', async () => {
    await entrar('admin@lapato.local');

    const servicos = await req('GET', '/catalogo/servicos');
    const servicoId = servicos.body.find((s: any) => s.codigo === 'HISTO').id;
    const clientes = await req('GET', '/catalogo/clientes');

    const criado = await req('POST', '/casos', {
      servicoId,
      clienteId: clientes.body[0].id,
      paciente: { nome: 'Nina' },
      amostras: [{ descricao: 'Fragmento sem identificação' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    expect(criado.status).toBe(201);

    const dossie = await req('GET', `/casos/${criado.body.id}`);
    const recipienteId = dossie.body.recipientes[0].id;
    const amostraId = dossie.body.amostras[0].id;

    await req('POST', `/casos/${criado.body.id}/recebimento`, {
      conferencia: [{ recipienteId, quantidadeRecebida: 1 }],
    });

    const triagem = await req('POST', `/casos/${criado.body.id}/triagem`, {
      amostras: [
        {
          amostraId,
          resultado: 'bloqueado',
          observacoes: 'Material sem identificação vinculável ao paciente.',
        },
      ],
    });

    expect(triagem.status).toBe(201);
    expect(triagem.body.resultado).toBe('bloqueado');

    const depois = await req('GET', `/casos/${criado.body.id}`);
    // O fluxo NÃO avança: continua aguardando triagem, e agora bloqueado.
    expect(depois.body.estado.etapa).toBe('aguardando_triagem');
    expect(depois.body.estado.bloqueado).toBe(true);

    const tipos = depois.body.linhaDoTempo.map((e: any) => e.tipo);
    expect(tipos).toContain('triagem.bloqueada');
    expect(tipos).toContain('pendencia.criada');
    expect(tipos).toContain('fluxo.bloqueado');

    // M08: com o material bloqueado, a bancada recusa iniciar a macroscopia.
    await entrar('patologista@lapato.local');
    const macro = await req('POST', `/macroscopia/amostras/${amostraId}`);
    expect(macro.status).toBe(400);
  });
});

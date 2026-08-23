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

/**
 * Envio multipart - `req` assume corpo JSON e nao serve para arquivo.
 *
 * O PNG do teste e minimo de proposito: o que se prova aqui e o caminho
 * (autorizacao, storage, registro, vinculo), nao a decodificacao de imagem.
 */
async function enviarArquivo(
  caminho: string,
  campos: Record<string, string>,
  arquivo: { nome: string; tipo: string; bytes: Buffer },
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  for (const [chave, valor] of Object.entries(campos)) form.append(chave, valor);
  form.append(
    'arquivo',
    new Blob([new Uint8Array(arquivo.bytes)], { type: arquivo.tipo }),
    arquivo.nome,
  );

  const resposta = await fetch(`${servidor}${BASE}${caminho}`, {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: form,
  });

  const texto = await resposta.text();
  return { status: resposta.status, body: texto ? JSON.parse(texto) : null };
}

/** PNG 1x1 valido - o menor arquivo que o pdfkit ainda consegue renderizar. */
const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

/**
 * Leva um caso recem-cadastrado ate a bancada por dentro do fluxo.
 *
 * Existe porque as precondicoes pre-analiticas passaram a ser exigidas: macro e
 * laudo recusam material sem recebimento e sem triagem (M05 secao 12). Blocos
 * que so querem chegar a bancada usam isto em vez de pular as etapas - pular
 * era possivel, e era o defeito.
 */
async function levarAteBancada(casoId: string): Promise<void> {
  const anterior = cookie;
  // O tecnico de laboratorio tem `material:receber` e `triagem:executar`; a
  // recepcao so o primeiro. Quem confere o material e quem o tria e o mesmo
  // papel na bancada de entrada.
  await entrar('tecnico@lapato.local');

  const dossie = await req('GET', `/casos/${casoId}`);
  const recebimento = await req('POST', `/casos/${casoId}/recebimento`, {
    conferencia: dossie.body.recipientes.map((r: { id: string; quantidadeDeclarada: number }) => ({
      recipienteId: r.id,
      quantidadeRecebida: r.quantidadeDeclarada,
    })),
  });
  expect(recebimento.status, JSON.stringify(recebimento.body)).toBe(201);

  const comAmostras = await req('GET', `/casos/${casoId}`);
  const triagem = await req('POST', `/casos/${casoId}/triagem`, {
    amostras: comAmostras.body.amostras.map((a: { id: string }) => ({
      amostraId: a.id,
      resultado: 'apto',
    })),
  });
  expect(triagem.status, JSON.stringify(triagem.body)).toBe(201);

  cookie = anterior;
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
  let codigoValidacao: string;

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

    /**
     * A leitura vem antes, e não inicia nada: a tela precisa saber se há ficha
     * sem publicar `macroscopia.iniciada` só por ter sido aberta.
     */
    const antes = await req('GET', `/macroscopia/amostras/${amostraId}`);
    expect(antes.status).toBe(200);
    expect(antes.body).toBeNull();

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

    /**
     * Enquanto não concluída, a ficha é rascunho: corrigir uma medida precisa
     * gravar. Ignorar o conflito de rótulo faria a correção sumir em silêncio,
     * com o salvamento respondendo sucesso sem ter salvo nada.
     */
    const corrigir = await req('POST', `/macroscopia/${macroscopiaId}`, {
      lesoes: [{ rotulo: 'L01', tipo: 'nódulo', lateralidade: 'direito', maiorEixoCm: 2.8 }],
      margens: [{ nome: 'Profunda', metodoAmostragem: 'perpendicular', distanciaCm: 0.6 }],
    });
    expect(corrigir.status).toBe(201);

    const ficha = await req('GET', `/macroscopia/amostras/${amostraId}`);
    expect(ficha.body.lesoes).toHaveLength(1);
    expect(Number(ficha.body.lesoes[0].maiorEixoCm)).toBe(2.8);
    expect(Number(ficha.body.margens[0].distanciaCm)).toBe(0.6);
    // Os cassetes não foram reenviados, então continuam dois — e não quatro.
    expect(ficha.body.cassetes).toHaveLength(2);

    const concluir = await req('POST', `/macroscopia/${macroscopiaId}/conclusao`);
    expect(concluir.status, JSON.stringify(concluir.body)).toBe(201);

    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.body.estado.etapa).toBe('aguardando_processamento');

    const evento = dossie.body.linhaDoTempo.find((e: any) => e.tipo === 'cassetes.gerados');
    expect(evento.payload.cassetes).toHaveLength(2);
    // M08/M09: o identificador do cassete carrega o do caso.
    expect(evento.payload.cassetes[0]).toMatch(/^CV-\d{6}\/\d{2}-A1$/);
  });

  test('5b. cassetes concluídos aparecem na fila de envio, com o caso junto', async () => {
    /**
     * A bancada monta o lote do dia atravessando casos, então a listagem não é
     * por caso — e precisa trazer o caso e o paciente para quem confere ler.
     */
    const r = await req('GET', '/processamento/cassetes-pendentes');
    expect(r.status).toBe(200);

    const meus = r.body.filter((c: any) => c.casoId === casoId);
    expect(meus).toHaveLength(2);
    expect(meus[0].caso).toMatch(/^CV-\d{6}\/\d{2}$/);
    expect(meus[0].paciente).toBeTruthy();
    expect(meus[0].tecidoOrigem).toBeTruthy();
  });

  test('6. técnico envia o lote ao laboratório de apoio', async () => {
    await entrar('tecnico@lapato.local');

    const fila = await req('GET', '/fluxo/casos?etapa=aguardando_processamento');
    expect(fila.body.some((c: any) => c.casoId === casoId)).toBe(true);

    const cassetes = await req('GET', `/macroscopia/casos/${casoId}/cassetes`);
    expect(cassetes.status).toBe(200);
    expect(cassetes.body).toHaveLength(2);
    casseteId = cassetes.body[0].id;

    const laboratorios = await req('GET', '/catalogo/laboratorios-apoio');
    expect(laboratorios.status).toBe(200);
    expect(laboratorios.body.length).toBeGreaterThan(0);

    /**
     * Sem destino o lote e invisivel para todo parceiro - carta sem endereco.
     * Por isso o campo deixou de ser opcional quando o portal externo passou a
     * filtrar os lotes por laboratorio.
     */
    const semDestino = await req('POST', '/processamento/lotes', {
      casseteIds: cassetes.body.map((c: any) => c.id),
    });
    expect(semDestino.status).toBe(400);

    const lote = await req('POST', '/processamento/lotes', {
      casseteIds: cassetes.body.map((c: any) => c.id),
      laboratorioApoioId: laboratorios.body[0].id,
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

    /**
     * O detalhe do lote e o que a tela le: precisa trazer a conferencia por
     * cassete e a divergencia apontada, e nao so o status agregado.
     */
    const detalhe = await req('GET', `/processamento/lotes/${loteId}`);
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.status).toBe('com_divergencia');
    expect(detalhe.body.cassetes).toHaveLength(2);
    expect(detalhe.body.cassetes.find((c: any) => c.id === casseteId).confirmadoRecebimento).toBe(
      true,
    );
    expect(detalhe.body.divergencias[0].tipo).toBe('numeracao_errada');
    expect(detalhe.body.divergencias[0].codigoInformado).toBe('ILEGIVEL');
    // Ainda sem laminas: elas so existem depois do registro de producao.
    expect(detalhe.body.laminas).toHaveLength(0);

    const lista = await req('GET', '/processamento/lotes');
    expect(lista.status).toBe(200);
    const resumo = lista.body.find((l: any) => l.id === loteId);
    expect(resumo.totalCassetes).toBe(2);
    expect(resumo.divergencias).toBe(1);
  });

  test('7b. o parceiro só enxerga o próprio lote, e nada antes do envio', async () => {
    /**
     * M02, verificacao do bootstrap: "usuario externo do laboratorio de apoio so
     * ve seus lotes de cassetes". O parceiro esta autenticado desde o teste
     * anterior.
     */
    /**
     * A chave do isolamento e derivada do TIPO da unidade no banco, nunca de
     * algo que o cliente envie. Este e o mecanismo novo, entao e ele que precisa
     * ser medido diretamente.
     */
    const euParceiro = await req('GET', '/auth/eu');
    expect(euParceiro.body.laboratorioApoioId).toBeTruthy();

    const lotes = await req('GET', '/processamento/lotes');
    expect(lotes.status).toBe(200);
    expect(lotes.body.some((l: any) => l.id === loteId)).toBe(true);

    /**
     * A fila de pendentes traz caso e nome de paciente de toda a instituicao.
     * Material ainda nao enviado nao e assunto do fornecedor.
     */
    const pendentes = await req('GET', '/processamento/cassetes-pendentes');
    expect(pendentes.status).toBe(200);
    expect(pendentes.body).toHaveLength(0);

    // O parceiro tambem nao monta lote: a permissao nao esta no perfil dele.
    const tentativaEnvio = await req('POST', '/processamento/lotes', {
      casseteIds: [casseteId],
      laboratorioApoioId: '00000000-0000-0000-0000-000000000000',
    });
    expect(tentativaEnvio.status).toBe(403);

    // E nao alcanca o dossie do caso: o material e dele, o paciente nao.
    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.status).toBe(403);

    /**
     * O contraste que fecha a prova: quem e interno **nao** recebe a chave de
     * isolamento, e por isso continua vendo a fila inteira. Sem esta metade, um
     * `laboratorioApoioId` preenchido para todo mundo passaria despercebido -
     * e travaria a operacao interna em vez de proteger o parceiro.
     */
    await entrar('tecnico@lapato.local');
    const euInterno = await req('GET', '/auth/eu');
    expect(euInterno.body.laboratorioApoioId).toBeNull();

    // Devolve a sessao do parceiro: o proximo teste continua de onde o 7 parou.
    await entrar('apoio@lapato.local');
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

  test('8b. patologista solicita PAS; a execução do técnico resolve a pendência sozinha', async () => {
    /**
     * M10 seção 3: o módulo é dono da DEMANDA, não da execução. O patologista
     * pede; o técnico executa e devolve "execução concluída"; a pendência
     * vinculada morre junto (seção 93), sem ninguém lembrar de fechá-la.
     */
    const sol = await req('POST', '/solicitacoes', {
      casoId,
      tipo: 'coloracao_especial',
      descricao: 'PAS — pesquisa de estruturas fúngicas',
      justificativa: 'Descartar etiologia infecciosa antes de fechar o diagnóstico.',
      objetoTipo: 'cassete',
      objetoId: casseteId,
    });
    expect(sol.status, JSON.stringify(sol.body)).toBe(201);
    // M10 seção 10: numeração própria, distinta do registro do caso.
    expect(sol.body.identificador).toMatch(/^SOL-\d{4}-\d{6}$/);
    const solicitacaoId = sol.body.id;

    const pend = await req('POST', '/solicitacoes/pendencias', {
      casoId,
      solicitacaoId,
      tipo: 'execucao_tecnica',
      descricao: 'Aguardando coloração PAS.',
      status: 'aguardando_execucao_tecnica',
      // M10 seção 21: esta pendência suspende a contagem do prazo.
      suspendePrazo: true,
    });
    expect(pend.status, JSON.stringify(pend.body)).toBe(201);

    // Quem pede não executa: o patologista não tem `solicitacao:executar`.
    const naoExecuta = await req('POST', `/solicitacoes/${solicitacaoId}/conclusao`, {});
    expect(naoExecuta.status).toBe(403);

    await entrar('tecnico@lapato.local');
    const conclusao = await req('POST', `/solicitacoes/${solicitacaoId}/conclusao`, {
      // Seção 82: resultado técnico, nunca interpretação.
      resultadoTecnico: 'PAS realizado; lâminas disponíveis.',
    });
    expect(conclusao.status, JSON.stringify(conclusao.body)).toBe(201);

    const doCaso = await req('GET', `/solicitacoes/casos/${casoId}`);
    expect(doCaso.body.solicitacoes[0].status).toBe('concluida');
    // Seção 93: resolvida automaticamente pela conclusão da execução.
    expect(doCaso.body.pendencias[0].status).toBe('resolvida');

    await entrar('patologista@lapato.local');
    const dossie = await req('GET', `/casos/${casoId}`);
    const tipos = dossie.body.linhaDoTempo.map((e: any) => e.tipo);
    for (const t of [
      'solicitacao.criada',
      'pendencia.criada',
      'solicitacao.concluida',
      'pendencia.resolvida',
    ]) {
      expect(tipos, `evento ausente: ${t}`).toContain(t);
    }
  });

  test('8c. solicitação com aprovação prévia não executa antes da análise', async () => {
    // M10 seção 29: IHQ de alto custo exige autorização antes da bancada.
    const sol = await req('POST', '/solicitacoes', {
      casoId,
      tipo: 'ihq',
      descricao: 'Painel IHQ — pancitoqueratina, vimentina, CD18.',
      exigeAprovacao: true,
    });
    expect(sol.status).toBe(201);
    const solicitacaoId = sol.body.id;

    // Sem análise concluída, a execução é recusada.
    await entrar('tecnico@lapato.local');
    const cedoDemais = await req('POST', `/solicitacoes/${solicitacaoId}/conclusao`, {});
    expect(cedoDemais.status).toBe(400);

    await entrar('patologista@lapato.local');
    // Recusar sem motivo é recusado - o motivo é o que orienta quem pediu.
    const semMotivo = await req('POST', `/solicitacoes/${solicitacaoId}/analise`, {
      resultado: 'recusada',
    });
    expect(semMotivo.status).toBe(400);

    const aprovacao = await req('POST', `/solicitacoes/${solicitacaoId}/analise`, {
      resultado: 'aprovada',
    });
    expect(aprovacao.status, JSON.stringify(aprovacao.body)).toBe(201);

    // Aprovada, o cancelamento com motivo mantém o histórico limpo para o resto do fluxo.
    const cancelamento = await req('POST', `/solicitacoes/${solicitacaoId}/cancelamento`, {
      motivo: 'Painel adiado até o resultado do PAS.',
    });
    expect(cancelamento.status, JSON.stringify(cancelamento.body)).toBe(201);
  });

  test('9. patologista redige o laudo estruturado', async () => {
    /**
     * A leitura vem antes e nao inicia nada: abrir a tela nao pode publicar
     * `microscopia.iniciada` nem mover o fluxo - mesmo contrato da macroscopia.
     */
    const antes = await req('GET', `/laudos/casos/${casoId}`);
    expect(antes.status).toBe(200);
    expect(antes.body).toBeNull();

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

    /**
     * A releitura devolve o que foi gravado - e a nota interna vem, porque o
     * patologista tem `laudo:ver_nota_interna`. O corte da nota para quem nao
     * tem a permissao acontece no servidor, nao na tela.
     */
    const relido = await req('GET', `/laudos/casos/${casoId}`);
    expect(relido.status).toBe(200);
    expect(relido.body.status).toBe('rascunho');
    expect(relido.body.versaoCorrente.versao).toBe(1);
    expect(relido.body.versaoCorrente.notaInterna).toBe('Confirmar com Giemsa se necessário.');
    expect(relido.body.diagnosticos).toHaveLength(1);
    expect(relido.body.diagnosticos[0].criteriosGraduacao).toEqual({
      mitoses: 2,
      cariomegalia: false,
      multinucleadas: 0,
    });
    expect(relido.body.margens[0].resultado).toBe('livre');
  });

  test('9b. revisão: retorno exige comentário, e o ciclo completo fica registrado', async () => {
    const envio = await req('POST', `/laudos/versoes/${versaoId}/revisao`);
    expect(envio.status, JSON.stringify(envio.body)).toBe(201);

    let laudoAtual = await req('GET', `/laudos/casos/${casoId}`);
    expect(laudoAtual.body.status).toBe('aguardando_revisao');

    /**
     * Devolver sem dizer o que corrigir e recusado - mesma logica do motivo
     * obrigatorio no bloqueio da triagem: sem o comentario, quem elabora recebe
     * "o revisor solicitou ajustes" e fica adivinhando quais.
     */
    const semComentario = await req('POST', `/laudos/versoes/${versaoId}/revisao/conclusao`, {
      resultado: 'ajustes_solicitados',
    });
    expect(semComentario.status).toBe(400);

    const retorno = await req('POST', `/laudos/versoes/${versaoId}/revisao/conclusao`, {
      resultado: 'ajustes_solicitados',
      comentarios: 'Detalhar a contagem mitótica na descrição.',
    });
    expect(retorno.status, JSON.stringify(retorno.body)).toBe(201);

    laudoAtual = await req('GET', `/laudos/casos/${casoId}`);
    expect(laudoAtual.body.status).toBe('retornado_para_correcao');
    // O parecer fica no laudo - e o que orienta a correcao.
    expect(laudoAtual.body.revisoes[0].comentarios).toBe(
      'Detalhar a contagem mitótica na descrição.',
    );

    // Segunda rodada: reenvio e aprovacao liberam para assinatura.
    await req('POST', `/laudos/versoes/${versaoId}/revisao`);
    const aprovacao = await req('POST', `/laudos/versoes/${versaoId}/revisao/conclusao`, {
      resultado: 'aprovada',
    });
    expect(aprovacao.status, JSON.stringify(aprovacao.body)).toBe(201);

    laudoAtual = await req('GET', `/laudos/casos/${casoId}`);
    expect(laudoAtual.body.status).toBe('aguardando_assinatura');
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
    codigoValidacao = r.body.codigoValidacao;
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

  test('12b. PDF assinado e validação pública pelo QR Code', async () => {
    const preview = await fetch(
      `${servidor}${BASE}/laudos/versoes/${versaoId}/pdf/pre-visualizacao`,
      { headers: { cookie } },
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await preview.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');

    const download = await fetch(`${servidor}${BASE}/laudos/versoes/${versaoId}/pdf`, {
      headers: { cookie },
    });
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');

    /**
     * Sem cookie de sessão nenhum - a validação por QR Code acontece antes de
     * qualquer login existir (ADR 0002), então o teste não pode depender dele.
     */
    const validacao = await fetch(`${servidor}${BASE}/validar/demo/${codigoValidacao}`);
    expect(validacao.status).toBe(200);
    const corpo = await validacao.json();
    expect(corpo.vigente).toBe(true);
    expect(corpo.versao).toBe(1);
    expect(corpo.tipo).toBe('original');
    expect(corpo.instituicao).toBeTruthy();
    expect(corpo.caso).toBeTruthy();
    // M11 seção 88: resposta deliberadamente pobre - nada de dado clínico.
    const textoDaResposta = JSON.stringify(corpo);
    expect(textoDaResposta).not.toContain('Mastocitoma');
    expect(textoDaResposta).not.toContain('diagnostic');

    /**
     * Código ou instituição errados devolvem a mesma "não encontrado" - o
     * mesmo cuidado do login, para não deixar ninguém adivinhar qual dos dois
     * está errado.
     */
    const codigoErrado = await fetch(`${servidor}${BASE}/validar/demo/CODIGO-QUE-NAO-EXISTE`);
    expect(codigoErrado.status).toBe(404);

    const instituicaoErrada = await fetch(
      `${servidor}${BASE}/validar/instituicao-que-nao-existe/${codigoValidacao}`,
    );
    expect(instituicaoErrada.status).toBe(404);
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

    /**
     * M11 seção 89: o PDF já entregue continua autêntico, mas o QR Code agora
     * avisa que existe versão mais nova - o aviso é da resposta, não do PDF
     * congelado (ADR 0005), então quem já baixou o documento antigo não vê os
     * bytes mudarem.
     */
    const revalidacao = await fetch(`${servidor}${BASE}/validar/demo/${codigoValidacao}`);
    expect(revalidacao.status).toBe(200);
    expect((await revalidacao.json()).vigente).toBe(false);
  });

  test('14. adendo exige motivo', async () => {
    const r = await req('POST', `/laudos/${laudoId}/versoes`, { tipo: 'adendo', motivo: '' });
    expect(r.status).toBe(400);
  });
});

describe('gestão de usuários (M02)', () => {
  const marca = Date.now().toString().slice(-6);
  const emailNovo = `novo.${marca}@lapato.local`;
  let usuarioId: string;
  let senhaProvisoria: string;

  test('admin cria conta com senha provisória; o primeiro login prende na troca', async () => {
    await entrar('admin@lapato.local');

    const perfis = await req('GET', '/usuarios/perfis');
    const recepcao = perfis.body.find((p: any) => p.chave === 'recepcao');
    expect(recepcao).toBeTruthy();

    const criado = await req('POST', '/usuarios', {
      nomeCompleto: `Usuária Nova ${marca}`,
      email: emailNovo,
      perfilIds: [recepcao.id],
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    expect(criado.body.senhaProvisoria).toBeTruthy();
    usuarioId = criado.body.id;
    senhaProvisoria = criado.body.senhaProvisoria;

    // Identidade individual (M02 seção 3): o mesmo e-mail não cria outra conta.
    const duplicado = await req('POST', '/usuarios', {
      nomeCompleto: 'Outra Pessoa',
      email: emailNovo,
      perfilIds: [recepcao.id],
    });
    expect(duplicado.status).toBe(400);

    /**
     * Senha definida por terceiro vale para um acesso (seção 31): o login
     * funciona, mas a sessão fica presa em `troca_senha_obrigatoria` até a
     * pessoa definir a própria senha.
     */
    cookie = '';
    const login = await req('POST', '/auth/login', {
      instituicao: 'demo',
      email: emailNovo,
      senha: senhaProvisoria,
    });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.estagio).toBe('troca_senha_obrigatoria');

    // Presa na troca, nenhuma rota de negócio responde.
    const bloqueada = await req('GET', '/fluxo/casos');
    expect(bloqueada.status).toBe(403);

    const troca = await req('POST', '/auth/senha', {
      senhaAtual: senhaProvisoria,
      senhaNova: `NovaSenha!${marca}`,
    });
    expect(troca.status, JSON.stringify(troca.body)).toBe(200);
    expect(troca.body.estagio).toBe('ativa');

    // Destravada: o perfil de recepção enxerga a central de casos.
    const fila = await req('GET', '/fluxo/casos');
    expect(fila.status).toBe(200);
  });

  test('bloquear derruba a sessão aberta na hora; reativar devolve o acesso', async () => {
    // A usuária nova está logada (cookie corrente). O admin a bloqueia...
    const cookieDaUsuaria = cookie;
    await entrar('admin@lapato.local');
    const bloqueio = await req('POST', `/usuarios/${usuarioId}/bloqueio`);
    expect(bloqueio.status, JSON.stringify(bloqueio.body)).toBe(201);

    // ...e a sessão dela morre imediatamente (M02 seção 33).
    const cookieDoAdmin = cookie;
    cookie = cookieDaUsuaria;
    const sessaoMorta = await req('GET', '/fluxo/casos');
    expect(sessaoMorta.status).toBe(401);

    // Login recusado enquanto bloqueada.
    cookie = '';
    const login = await req('POST', '/auth/login', {
      instituicao: 'demo',
      email: emailNovo,
      senha: `NovaSenha!${marca}`,
    });
    expect(login.status).toBe(401);

    // O admin não consegue se bloquear - a instituição não pode se trancar fora.
    cookie = cookieDoAdmin;
    const eu = await req('GET', '/auth/eu');
    const autoBloqueio = await req('POST', `/usuarios/${eu.body.usuarioId}/bloqueio`);
    expect(autoBloqueio.status).toBe(400);

    const reativacao = await req('POST', `/usuarios/${usuarioId}/reativacao`);
    expect(reativacao.status, JSON.stringify(reativacao.body)).toBe(201);

    cookie = '';
    const loginDeVolta = await req('POST', '/auth/login', {
      instituicao: 'demo',
      email: emailNovo,
      senha: `NovaSenha!${marca}`,
    });
    expect(loginDeVolta.status).toBe(200);
    expect(loginDeVolta.body.estagio).toBe('ativa');
  });

  test('reset administrativo gera nova provisória e revoga as sessões', async () => {
    // A usuária está logada de novo; o admin reseta a senha dela.
    await entrar('admin@lapato.local');
    const reset = await req('POST', `/usuarios/${usuarioId}/redefinicao-senha`);
    expect(reset.status, JSON.stringify(reset.body)).toBe(201);
    expect(reset.body.senhaProvisoria).toBeTruthy();

    // A senha antiga já não vale; a nova provisória prende na troca de novo.
    cookie = '';
    const senhaAntiga = await req('POST', '/auth/login', {
      instituicao: 'demo',
      email: emailNovo,
      senha: `NovaSenha!${marca}`,
    });
    expect(senhaAntiga.status).toBe(401);

    const login = await req('POST', '/auth/login', {
      instituicao: 'demo',
      email: emailNovo,
      senha: reset.body.senhaProvisoria,
    });
    expect(login.status).toBe(200);
    expect(login.body.estagio).toBe('troca_senha_obrigatoria');

    // Quem não é admin não gerencia contas.
    await entrar('patologista@lapato.local');
    const tentativa = await req('POST', `/usuarios/${usuarioId}/redefinicao-senha`);
    expect(tentativa.status).toBe(403);
  });
});

describe('administração e configurações (M01)', () => {
  const marca = Date.now().toString().slice(-6);

  test('admin cria serviço com flags de comportamento e um caso nasce com o prazo dele', async () => {
    await entrar('admin@lapato.local');

    /**
     * M01 seção 11: as flags decidem o fluxo em DADOS. Uma biópsia expressa
     * com prazo de 2 dias nasce por formulário - não por deploy.
     */
    const servico = await req('POST', '/administracao/servicos', {
      nome: `Biópsia Expressa ${marca}`,
      codigo: `EXPR${marca.slice(-4)}`,
      categoria: 'anatomia_patologica',
      modalidade: 'histopatologia',
      prazoDiasUteis: 2,
    });
    expect(servico.status, JSON.stringify(servico.body)).toBe(201);

    // Código repetido é barrado.
    const repetido = await req('POST', '/administracao/servicos', {
      nome: 'Outro',
      codigo: `EXPR${marca.slice(-4)}`,
      categoria: 'anatomia_patologica',
      modalidade: 'histopatologia',
    });
    expect(repetido.status).toBe(400);

    // O serviço novo já aparece nas opções de cadastro (catálogo)...
    const catalogo = await req('GET', '/catalogo/servicos');
    const novo = catalogo.body.find((s: any) => s.codigo === `EXPR${marca.slice(-4)}`);
    expect(novo).toBeTruthy();
    expect(novo.prazoDiasUteis).toBe(2);

    // ...e um caso aberto com ele herda o prazo vigente (M01 seção 22).
    const clientes = await req('GET', '/catalogo/clientes');
    const criado = await req('POST', '/casos', {
      servicoId: novo.id,
      clienteId: clientes.body[0].id,
      paciente: { nome: `Mimi ${marca}` },
      amostras: [{ descricao: 'Punção aspirativa' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
  });

  test('serviço de modalidade sem workflow orienta em vez de estourar', async () => {
    /**
     * Estado alcançável pela tela: o admin cria um serviço de necropsia antes
     * de a modalidade ter workflow - o M14 ainda não foi construído. O caso é
     * recusado com 400 e a mensagem diz o que falta; era um 500 opaco.
     *
     * O teste usava citopatologia até ela ganhar workflow padrão no M12. A
     * regra é a mesma: o que se prova aqui é o erro de configuração ser
     * legível, não qual modalidade está faltando hoje.
     */
    const servico = await req('POST', '/administracao/servicos', {
      nome: `Necropsia ${marca}`,
      codigo: `NEC${marca.slice(-4)}`,
      categoria: 'anatomia_patologica',
      modalidade: 'necropsia',
    });
    expect(servico.status).toBe(201);

    const clientes = await req('GET', '/catalogo/clientes');
    const criado = await req('POST', '/casos', {
      servicoId: servico.body.id,
      clienteId: clientes.body[0].id,
      paciente: { nome: `Fifi ${marca}` },
      amostras: [{ descricao: 'Punção' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    expect(criado.status).toBe(400);
    expect(criado.body.detail).toContain('workflow');
  });

  test('termo novo entra no catálogo; inativado, sai das opções', async () => {
    const tabelas = await req('GET', '/administracao/tabelas');
    const especies = tabelas.body.find((t: any) => t.chave === 'especie');
    expect(especies).toBeTruthy();

    const termoNovo = await req('POST', `/administracao/tabelas/${especies.id}/termos`, {
      valor: `Chinchila ${marca}`,
      codigo: `chinchila_${marca}`,
    });
    expect(termoNovo.status, JSON.stringify(termoNovo.body)).toBe(201);

    // Aparece nas opções dos formulários (M01 seção 19)...
    let opcoes = await req('GET', '/catalogo/tabelas/especie');
    expect(opcoes.body.some((t: any) => t.valor === `Chinchila ${marca}`)).toBe(true);

    // ...e some delas ao inativar - sem apagar (seção 21).
    await req('POST', `/administracao/termos/${termoNovo.body.id}/inativacao`);
    opcoes = await req('GET', '/catalogo/tabelas/especie');
    expect(opcoes.body.some((t: any) => t.valor === `Chinchila ${marca}`)).toBe(false);

    const administrados = await req('GET', `/administracao/tabelas/${especies.id}/termos`);
    const inativo = administrados.body.find((t: any) => t.valor === `Chinchila ${marca}`);
    expect(inativo, 'o termo inativo continua na gestão').toBeTruthy();
    expect(inativo.inativadoEm).not.toBeNull();
  });

  test('unidade de laboratório de apoio criada aqui aparece nas opções do M09', async () => {
    const unidade = await req('POST', '/administracao/unidades', {
      nome: `HistoParceiro ${marca}`,
      codigo: `HP${marca.slice(-3)}`,
      tipo: 'laboratorio_apoio',
    });
    expect(unidade.status, JSON.stringify(unidade.body)).toBe(201);

    const parceiros = await req('GET', '/catalogo/laboratorios-apoio');
    expect(parceiros.body.some((l: any) => l.id === unidade.body.id)).toBe(true);

    const setor = await req('POST', `/administracao/unidades/${unidade.body.id}/setores`, {
      nome: 'Histotécnica',
      codigo: 'HISTOTEC',
      tipo: 'histotecnica',
    });
    expect(setor.status, JSON.stringify(setor.body)).toBe(201);
  });

  test('dia não útil entra no calendário e a duplicata é recusada', async () => {
    const dia = await req('POST', '/administracao/calendario', {
      data: '2027-03-15',
      descricao: `Recesso institucional ${marca}`,
      tipo: 'recesso',
    });
    expect(dia.status, JSON.stringify(dia.body)).toBe(201);

    const duplicado = await req('POST', '/administracao/calendario', {
      data: '2027-03-15',
      descricao: 'Outra coisa',
    });
    expect(duplicado.status).toBe(400);

    // Feriado errado sai de vez - exceção deliberada à regra de inativação.
    const remocao = await req('POST', `/administracao/calendario/${dia.body.id}/remocao`);
    expect(remocao.status, JSON.stringify(remocao.body)).toBe(201);
  });

  test('quem não é admin não configura', async () => {
    await entrar('patologista@lapato.local');
    const tentativa = await req('POST', '/administracao/servicos', {
      nome: 'X',
      codigo: 'XX',
      categoria: 'x',
      modalidade: 'histopatologia',
    });
    expect(tentativa.status).toBe(403);
  });
});

describe('cadastro de clientes e veterinários (M03)', () => {
  /**
   * O degrau zero de qualquer caso: sem cliente e veterinário cadastrados,
   * nenhum exame nasce. A recepção faz o ciclo inteiro pela API - cadastrar,
   * tropeçar na duplicidade, vincular e usar num caso novo.
   */
  const marca = Date.now().toString().slice(-6);
  let clienteId: string;
  let veterinarioId: string;

  test('recepção cadastra cliente e veterinário e abre um caso com eles', async () => {
    await entrar('recepcao@lapato.local');

    const cli = await req('POST', '/clientes', {
      nomeFantasia: `Clínica Aurora ${marca}`,
      documento: `12.345.${marca}/0001-90`,
      tipo: 'clinica',
      codigo: `A${marca.slice(-3)}`,
    });
    expect(cli.status, JSON.stringify(cli.body)).toBe(201);
    clienteId = cli.body.id;

    const vet = await req('POST', '/veterinarios', {
      nome: `Dra. Aurora Teste ${marca}`,
      crmv: marca,
      crmvUf: 'CE',
    });
    expect(vet.status, JSON.stringify(vet.body)).toBe(201);
    veterinarioId = vet.body.id;

    const vinculo = await req('POST', `/veterinarios/${veterinarioId}/vinculos`, {
      clienteId,
      principal: true,
    });
    expect(vinculo.status, JSON.stringify(vinculo.body)).toBe(201);

    // O cadastro novo serve imediatamente a um caso novo - fonte única (M03 seção 1).
    const servicos = await req('GET', '/catalogo/servicos');
    const criado = await req('POST', '/casos', {
      servicoId: servicos.body.find((s: any) => s.codigo === 'HISTO').id,
      clienteId,
      veterinarioId,
      paciente: { nome: 'Belinha' },
      amostras: [{ descricao: 'Nódulo cutâneo' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    // O identificador nasce com o código do cliente novo (M03 seção 6.2).
    expect(criado.body.identificador).toContain(`A${marca.slice(-3)}-`);
  });

  test('duplicidade é conversa com candidatos, não erro seco (M03 seção 20)', async () => {
    // Mesmo documento: 409 com o cadastro existente entre os candidatos.
    const repetido = await req('POST', '/clientes', {
      nomeFantasia: `Outro Nome ${marca}`,
      documento: `12345${marca}000190`,
      tipo: 'clinica',
      codigo: `B${marca.slice(-3)}`,
    });
    expect(repetido.status).toBe(409);
    expect(repetido.body.duplicidades.some((d: any) => d.id === clienteId)).toBe(true);

    // Confirmar que é outro cliente passa - e fica na auditoria.
    const confirmado = await req('POST', '/clientes', {
      nomeFantasia: `Outro Nome ${marca}`,
      documento: `12345${marca}000190`,
      tipo: 'clinica',
      codigo: `B${marca.slice(-3)}`,
      ignorarDuplicidade: true,
    });
    expect(confirmado.status, JSON.stringify(confirmado.body)).toBe(201);

    // Código repetido é barrado mesmo com a confirmação: compõe o registro.
    const codigoRepetido = await req('POST', '/clientes', {
      nomeFantasia: 'Terceiro Nome',
      tipo: 'clinica',
      codigo: `A${marca.slice(-3)}`,
      ignorarDuplicidade: true,
    });
    expect(codigoRepetido.status).toBe(400);

    // Mesmo CRMV: o caminho oferecido é vincular, não recadastrar.
    const vetRepetido = await req('POST', '/veterinarios', {
      nome: `Nome Diferente ${marca}`,
      crmv: marca,
      crmvUf: 'CE',
    });
    expect(vetRepetido.status).toBe(409);
    expect(vetRepetido.body.duplicidades.some((d: any) => d.id === veterinarioId)).toBe(true);
  });

  test('encerrar vínculo preserva a história; inativar tira das opções novas', async () => {
    const ficha = await req('GET', `/clientes/${clienteId}`);
    expect(ficha.status).toBe(200);
    const vinculo = ficha.body.vinculos[0];
    expect(vinculo.terminoEm).toBeNull();

    const encerramento = await req(
      'POST',
      `/veterinarios/vinculos/${vinculo.id}/encerramento`,
    );
    expect(encerramento.status, JSON.stringify(encerramento.body)).toBe(201);

    // O vínculo encerrado continua na ficha, com término - nada é apagado.
    const depois = await req('GET', `/clientes/${clienteId}`);
    expect(depois.body.vinculos[0].terminoEm).not.toBeNull();
    // E o caso aberto com o cliente segue lá.
    expect(depois.body.casos.length).toBeGreaterThan(0);

    // Revincular reativa o MESMO registro em vez de duplicar (M03 seção 36).
    const volta = await req('POST', `/veterinarios/${veterinarioId}/vinculos`, { clienteId });
    expect(volta.status).toBe(201);
    expect(volta.body.id).toBe(vinculo.id);

    // Inativado, o cliente some do catálogo de opções para exame novo...
    await req('POST', `/clientes/${clienteId}/inativacao`);
    const catalogo = await req('GET', '/catalogo/clientes');
    expect(catalogo.body.some((c: any) => c.id === clienteId)).toBe(false);

    // ...mas a busca ampla do M03 ainda o encontra (a história fica) - e com a
    // contagem de casos certa, que já saiu errada por identificador sem
    // qualificação no subquery.
    const busca = await req('GET', `/clientes?q=Aurora ${marca}`);
    const encontrado = busca.body.find((c: any) => c.id === clienteId);
    expect(encontrado).toBeTruthy();
    expect(encontrado.totalCasos).toBe(1);

    // A lista de veterinários traz os vínculos vigentes por extenso.
    const vets = await req('GET', `/veterinarios?q=Aurora Teste ${marca}`);
    expect(vets.status, JSON.stringify(vets.body)).toBe(200);
    expect(vets.body[0].vinculos).toContain(`Clínica Aurora ${marca}`);
  });
});

describe('citopatologia de ponta a ponta (M12)', () => {
  /**
   * A citologia nao e histopatologia com menos etapas: ela tem workflow
   * proprio (M07), avaliacao por amostra (M12 secoes 115 e 142) e uma regra de
   * Guardian que so existe aqui - diagnostico afirmativo sobre material que o
   * proprio patologista declarou nao diagnostico (secao 93).
   *
   * Este bloco percorre o caminho inteiro: cadastro, triagem, bancada
   * citologica, bloqueio, correcao, assinatura e adendo.
   */
  const marca = Date.now().toString().slice(-6);

  let casoId: string;
  let amostraId: string;
  let laudoId: string;
  let versaoId: string;

  test('caso citológico chega à microscopia sem passar por macroscopia nem processamento', async () => {
    await entrar('admin@lapato.local');

    const servicos = await req('GET', '/catalogo/servicos');
    const cito = servicos.body.find((s: any) => s.codigo === 'CITO');
    expect(cito, 'serviço de citopatologia ausente no catálogo').toBeTruthy();

    const clientes = await req('GET', '/catalogo/clientes');

    const criado = await req('POST', '/casos', {
      servicoId: cito.id,
      clienteId: clientes.body[0].id,
      paciente: { nome: `Mel ${marca}`, sexo: 'femea' },
      historicoClinico: 'Massa cutânea em região cervical, crescimento rápido.',
      amostras: [
        {
          descricao: 'PAAF de massa cervical',
          regiaoAnatomica: 'Região cervical',
          lateralidade: 'esquerdo',
          metodoColeta: 'PAAF',
        },
      ],
      recipientes: [{ quantidadeDeclarada: 3 }],
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    casoId = criado.body.id;

    const dossie = await req('GET', `/casos/${casoId}`);
    amostraId = dossie.body.amostras[0].id;
    const recipienteId = dossie.body.recipientes[0].id;
    expect(dossie.body.estado.etapa).toBe('aguardando_recebimento');

    await req('POST', `/casos/${casoId}/recebimento`, {
      conferencia: [{ recipienteId, quantidadeRecebida: 3 }],
    });

    const triagem = await req('POST', `/casos/${casoId}/triagem`, {
      amostras: [{ amostraId, resultado: 'apto' }],
    });
    expect(triagem.status, JSON.stringify(triagem.body)).toBe(201);

    /**
     * O ponto do teste: as lâminas chegaram prontas da coleta, então a triagem
     * apta já habilita a leitura (M12 seção 4). No workflow da histopatologia
     * a microscopia só entra por `laminas.disponiveis`, e o caso citológico
     * ficaria parado na triagem esperando um evento que ninguém emitiria.
     */
    const depois = await req('GET', `/casos/${casoId}`);
    expect(depois.body.estado.etapa).toBe('aguardando_microscopia');
  });

  test('a bancada citológica grava a avaliação por amostra', async () => {
    await entrar('patologista@lapato.local');

    const abrir = await req('POST', `/laudos/casos/${casoId}`);
    expect(abrir.status, JSON.stringify(abrir.body)).toBe(201);
    laudoId = abrir.body.laudoId;
    versaoId = abrir.body.versaoId;

    // O vocabulário vem do servidor, não de constantes da tela (M12 seção 3).
    const vocab = await req('GET', '/citologia/vocabulario');
    expect(vocab.status).toBe(200);
    expect(vocab.body.adequacao).toContain('nao_diagnostica');
    expect(vocab.body.criteriosMalignidade).toContain('anisocariose');

    const antes = await req('GET', `/citologia/versoes/${versaoId}`);
    expect(antes.status).toBe(200);
    // As amostras vêm mesmo sem avaliação: é a lista do que falta avaliar.
    expect(antes.body.amostras).toHaveLength(1);
    expect(antes.body.avaliacoes).toHaveLength(0);

    const salvo = await req('POST', `/citologia/versoes/${versaoId}/amostras/${amostraId}`, {
      tipoColeta: 'paaf',
      sitio: 'massa cervical',
      numeroLaminas: 3,
      adequacao: 'nao_diagnostica',
      motivosLimitacao: ['baixa celularidade', 'excesso de sangue'],
      celularidade: 'muito_baixa',
      preservacao: 'ruim',
      fundo: ['hemorrágico', 'proteináceo'],
      hemorragia: 'acentuada',
      populacoes: [{ tipo: 'indeterminada' }],
      grauCerteza: 'limitada',
      descricaoCitologica: 'Esfregaços acentuadamente hemodiluídos, com raras células preservadas.',
      limitacoes: ['baixa celularidade'],
    });
    expect(salvo.status, JSON.stringify(salvo.body)).toBe(201);

    const relido = await req('GET', `/citologia/versoes/${versaoId}`);
    const avaliacao = relido.body.avaliacoes[0];
    expect(avaliacao.amostraId).toBe(amostraId);
    expect(avaliacao.adequacao).toBe('nao_diagnostica');
    // Fundo é multivalorado por exigência do módulo (seção 16).
    expect(avaliacao.fundo).toEqual(['hemorrágico', 'proteináceo']);
    expect(avaliacao.motivosLimitacao).toHaveLength(2);

    // Regravar a mesma amostra atualiza, não duplica.
    await req('POST', `/citologia/versoes/${versaoId}/amostras/${amostraId}`, {
      adequacao: 'nao_diagnostica',
      celularidade: 'baixa',
    });
    const segunda = await req('GET', `/citologia/versoes/${versaoId}`);
    expect(segunda.body.avaliacoes).toHaveLength(1);
    expect(segunda.body.avaliacoes[0].celularidade).toBe('baixa');

    /**
     * Amostra que não é do caso não entra no laudo (M12 seção 142): sem esta
     * checagem, a interpretação citológica poderia se prender ao material de
     * outro paciente.
     */
    const recusado = await req(
      'POST',
      `/citologia/versoes/${versaoId}/amostras/00000000-0000-4000-8000-000000000000`,
      { adequacao: 'adequada' },
    );
    expect(recusado.status).toBe(400);
  });

  test('rascunho sem diagnóstico ainda é gravável', async () => {
    /**
     * Pego na verificação visual: a bancada citológica salva a morfologia antes
     * de existir conclusão, e o save ia com `diagnosticos: []`. O insert sem
     * valores estourava 500 - e o mesmo acontecia em qualquer rascunho de
     * histopatologia salvo antes do primeiro diagnóstico.
     */
    const r = await req('POST', `/laudos/versoes/${versaoId}`, {
      descricaoMicroscopica: 'Leitura em andamento.',
      diagnosticos: [],
      margens: [],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  test('Guardian barra diagnóstico afirmativo em amostra não diagnóstica (M12 seção 93)', async () => {
    await req('POST', `/laudos/versoes/${versaoId}`, {
      descricaoMicroscopica: 'Ver avaliação por amostra.',
      diagnosticos: [
        {
          amostraId,
          textoExibido: 'Mastocitoma cutâneo',
          entidade: 'Mastocitoma',
          comportamento: 'maligno',
          lateralidade: 'esquerdo',
        },
      ],
    });

    const r = await req('POST', `/laudos/versoes/${versaoId}/assinatura`);
    expect(r.status, JSON.stringify(r.body)).toBe(409);

    const achado = r.body.achados.find(
      (a: any) => a.codigo === 'CITOLOGIA_DIAGNOSTICO_EM_AMOSTRA_INADEQUADA',
    );
    expect(achado, JSON.stringify(r.body.achados)).toBeTruthy();
    expect(achado.nivel).toBe('critico');

    /**
     * Seção 94: maligno sem nenhum critério estruturado gera alerta DISCRETO -
     * a própria seção pede o tom, então é sugestão e não pode bloquear
     * sozinho.
     */
    const discreto = r.body.achados.find(
      (a: any) => a.codigo === 'CITOLOGIA_MALIGNO_SEM_CRITERIOS',
    );
    expect(discreto?.nivel).toBe('sugestao');
  });

  test('a mesma conclusão, com a ressalva que o material sustenta, assina', async () => {
    /**
     * Duas formas de sair do bloqueio, e o teste usa as duas: a adequação passa
     * a refletir o que foi visto depois de reavaliar as lâminas, e a redação
     * assume o grau de certeza que o material permite (seção 65). O laudo que
     * diz "sugestivo de" está coerente com amostra limitada - o que o Guardian
     * impede é afirmar sem ressalva sobre material declarado insuficiente.
     */
    await req('POST', `/citologia/versoes/${versaoId}/amostras/${amostraId}`, {
      tipoColeta: 'paaf',
      sitio: 'massa cervical',
      numeroLaminas: 3,
      adequacao: 'adequada_com_limitacoes',
      motivosLimitacao: ['excesso de sangue'],
      celularidade: 'moderada',
      preservacao: 'boa',
      fundo: ['hemorrágico'],
      populacoes: [{ tipo: 'células redondas', predominante: true }],
      criteriosMalignidade: { anisocariose: 'moderada', 'nucléolos proeminentes': 'discreto' },
      descricaoCitologica:
        'Esfregaços moderadamente celulares, com população discreta de células redondas.',
      interpretacao: 'Achados sugestivos de neoplasia de células redondas.',
      grauCerteza: 'moderada',
      recomendacoes: 'Histopatologia para classificação definitiva.',
    });

    await req('POST', `/laudos/versoes/${versaoId}`, {
      diagnosticos: [
        {
          amostraId,
          textoExibido: 'Sugestivo de mastocitoma cutâneo',
          entidade: 'Mastocitoma',
          comportamento: 'maligno',
          lateralidade: 'esquerdo',
        },
      ],
    });

    const r = await req('POST', `/laudos/versoes/${versaoId}/assinatura`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.codigoValidacao).toBeTruthy();

    // M12 seção 96: o documento entregue traz a avaliação citológica.
    const pdf = await fetch(`${servidor}${BASE}/laudos/versoes/${versaoId}/pdf`, {
      headers: { cookie },
    });
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('adendo herda a avaliação citológica e os diagnósticos da versão anterior', async () => {
    await req('POST', `/laudos/versoes/${versaoId}/liberacao`);

    const nova = await req('POST', `/laudos/${laudoId}/versoes`, {
      tipo: 'adendo',
      motivo: 'Resultado de imuno-histoquímica em cell block.',
    });
    expect(nova.status, JSON.stringify(nova.body)).toBe(201);

    /**
     * M11: adendo ACRESCENTA. A versão nova nascia só com o texto, sem
     * diagnóstico nem avaliação - e o Guardian barrava a assinatura de um laudo
     * cujo conteúdo já estava assinado na versão anterior.
     */
    const citologia = await req('GET', `/citologia/versoes/${nova.body.versaoId}`);
    expect(citologia.body.avaliacoes).toHaveLength(1);
    expect(citologia.body.avaliacoes[0].adequacao).toBe('adequada_com_limitacoes');

    const laudoAtual = await req('GET', `/laudos/casos/${casoId}`);
    expect(laudoAtual.body.versaoCorrente.versao).toBe(2);
    expect(laudoAtual.body.diagnosticos).toHaveLength(1);
    expect(laudoAtual.body.diagnosticos[0].entidade).toBe('Mastocitoma');
  });
});

describe('acervo de imagens (M16)', () => {
  /**
   * O M16 e dono do ARQUIVO; os demais modulos sao donos do contexto (secao 4).
   * O teste percorre isso: a recepcao fotografa o que recebeu, o patologista
   * escolhe o que entra no laudo, e a imagem retirada do acervo sai do
   * documento junto.
   */
  let casoId: string;
  let imagemId: string;
  let laudoVersaoId: string;

  test('a recepção fotografa o material e a imagem entra no acervo do caso', async () => {
    await entrar('recepcao@lapato.local');

    const servicos = await req('GET', '/catalogo/servicos');
    const clientes = await req('GET', '/catalogo/clientes');

    const criado = await req('POST', '/casos', {
      servicoId: servicos.body.find((s: any) => s.codigo === 'HISTO').id,
      clienteId: clientes.body[0].id,
      paciente: { nome: `Pepita ${Date.now().toString().slice(-5)}` },
      amostras: [{ descricao: 'Fragmento de pele' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    casoId = criado.body.id;

    const envio = await enviarArquivo(
      `/imagens/casos/${casoId}`,
      {
        tipo: 'recebimento',
        moduloContexto: 'M05_RECEBIMENTO',
        legenda: 'Frasco com identificação ilegível.',
        metadados: JSON.stringify({ recipiente: 'FRASCO-1' }),
      },
      { nome: 'frasco.png', tipo: 'image/png', bytes: PNG_MINIMO },
    );
    expect(envio.status, JSON.stringify(envio.body)).toBe(201);
    // Secao 8: identificador proprio, rastreavel.
    expect(envio.body.identificador).toMatch(/^IMG-\d{4}-\d{7}$/);
    imagemId = envio.body.id;

    const galeria = await req('GET', `/imagens/casos/${casoId}`);
    expect(galeria.status).toBe(200);
    expect(galeria.body).toHaveLength(1);
    // Secoes 1 e 134: origem, contexto e autoria fazem parte da imagem.
    expect(galeria.body[0].origem).toBe('produzida_lapato');
    expect(galeria.body[0].moduloContexto).toBe('M05_RECEBIMENTO');
    expect(galeria.body[0].autor).toBeTruthy();
    expect(galeria.body[0].metadados.recipiente).toBe('FRASCO-1');

    // A imagem entra na linha do tempo do caso, mas nao move o fluxo:
    // fotografar nao e etapa.
    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.body.linhaDoTempo.map((e: any) => e.tipo)).toContain('imagem.anexada');
    expect(dossie.body.estado.etapa).toBe('aguardando_recebimento');
  });

  test('formato não aceito é recusado antes de gravar', async () => {
    const r = await enviarArquivo(
      `/imagens/casos/${casoId}`,
      { tipo: 'recebimento', moduloContexto: 'M05_RECEBIMENTO' },
      { nome: 'planilha.csv', tipo: 'text/csv', bytes: Buffer.from('a,b,c') },
    );
    expect(r.status).toBe(400);

    const galeria = await req('GET', `/imagens/casos/${casoId}`);
    expect(galeria.body).toHaveLength(1);
  });

  test('os bytes saem pela API, nunca por URL pública', async () => {
    const comSessao = await fetch(`${servidor}${BASE}/imagens/${imagemId}/arquivo`, {
      headers: { cookie },
    });
    expect(comSessao.status).toBe(200);
    expect(Buffer.from(await comSessao.arrayBuffer()).subarray(0, 4)).toEqual(
      PNG_MINIMO.subarray(0, 4),
    );

    // Bucket privado (Blueprint seção 6): sem sessão não sai nada.
    const semSessao = await fetch(`${servidor}${BASE}/imagens/${imagemId}/arquivo`);
    expect(semSessao.status).toBe(401);
  });

  test('o patologista inclui a imagem no laudo e ela sai no PDF', async () => {
    // Este bloco chegava ao PDF sem passar por recebimento e triagem.
    await levarAteBancada(casoId);
    await entrar('patologista@lapato.local');

    const abrir = await req('POST', `/laudos/casos/${casoId}`);
    laudoVersaoId = abrir.body.versaoId;

    const paginas = async () => {
      const r = await fetch(
        `${servidor}${BASE}/laudos/versoes/${laudoVersaoId}/pdf/pre-visualizacao`,
        { headers: { cookie } },
      );
      expect(r.status).toBe(200);
      const bytes = Buffer.from(await r.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      /**
       * O texto do PDF viaja comprimido, entao procurar a palavra "Imagens"
       * nos bytes nao prova nada. A contagem de paginas prova: a secao de
       * imagens abre pagina propria, e ela so existe se houver imagem
       * selecionada.
       */
      return Number(/\/Count (\d+)/.exec(bytes.toString('latin1'))?.[1] ?? 0);
    };

    const antes = await paginas();

    const selecao = await req('POST', `/imagens/${imagemId}/laudo`, { incluir: true });
    expect(selecao.status, JSON.stringify(selecao.body)).toBe(201);

    const galeria = await req('GET', `/imagens/casos/${casoId}`);
    expect(galeria.body[0].incluidaNoLaudo).toBe(true);
    // Secao 38: a numeracao do documento sai da ordem da selecao.
    expect(galeria.body[0].ordemNoLaudo).toBe(1);

    expect(await paginas()).toBe(antes + 1);
  });

  test('inativar exige motivo, tira do laudo e preserva o histórico', async () => {
    const semMotivo = await req('POST', `/imagens/${imagemId}/inativacao`, { motivo: '' });
    expect(semMotivo.status).toBe(400);

    const r = await req('POST', `/imagens/${imagemId}/inativacao`, {
      motivo: 'Fotografia fora de foco; refeita em seguida.',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    // Sai da galeria padrao...
    const galeria = await req('GET', `/imagens/casos/${casoId}`);
    expect(galeria.body).toHaveLength(0);

    // ...mas continua no acervo, com o motivo - arquivo clinico nao se apaga
    // (secao 69).
    const comInativadas = await req('GET', `/imagens/casos/${casoId}?inativadas=sim`);
    expect(comInativadas.body).toHaveLength(1);
    expect(comInativadas.body[0].motivoInativacao).toContain('fora de foco');
    // E o documento nao carrega imagem retirada do acervo.
    expect(comInativadas.body[0].incluidaNoLaudo).toBe(false);

    const recusada = await req('POST', `/imagens/${imagemId}/laudo`, { incluir: true });
    expect(recusada.status).toBe(400);
  });
});

describe('Portal do Cliente (M04)', () => {
  /**
   * O que este bloco prova nao e "o Portal mostra exames": e que ele mostra
   * SO os do cliente da conta, e so o que ja pode ser visto de fora.
   *
   * A secao 5 do modulo chama o isolamento de "requisito critico de seguranca"
   * e exige que ele viva na camada de dados - por isso o teste tenta alcancar
   * o caso do outro cliente pelo id direto, que e o caminho que uma tela
   * bem-comportada nunca oferece e um atacante tenta primeiro.
   */
  let casoDaCentral: string;
  let versaoAssinada: string;

  test('exame de um cliente não aparece para outro, nem pelo id direto', async () => {
    // O caso nasce pela recepcao, para a Clinica Veterinaria Central.
    await entrar('admin@lapato.local');
    const servicos = await req('GET', '/catalogo/servicos');
    const clientes = await req('GET', '/catalogo/clientes');
    const central = clientes.body.find((c: any) => c.codigo === 'CV');
    expect(central, 'cliente de demonstração ausente').toBeTruthy();

    const criado = await req('POST', '/casos', {
      servicoId: servicos.body.find((s: any) => s.codigo === 'HISTO').id,
      clienteId: central.id,
      paciente: { nome: `Frida ${Date.now().toString().slice(-5)}` },
      historicoClinico: 'Nódulo em região inguinal, evolução de duas semanas.',
      amostras: [{ descricao: 'Nódulo inguinal' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    casoDaCentral = criado.body.id;

    // O veterinario da Central ve o exame.
    await entrar('portal@clinicacentral.local');
    const meus = await req('GET', '/portal/exames');
    expect(meus.status, JSON.stringify(meus.body)).toBe(200);
    expect(meus.body.some((e: any) => e.id === casoDaCentral)).toBe(true);

    // A conta da PetCare nao ve - e nem existe para ela.
    await entrar('portal@petcare.local');
    const alheios = await req('GET', '/portal/exames');
    expect(alheios.status).toBe(200);
    expect(alheios.body.some((e: any) => e.id === casoDaCentral)).toBe(false);

    /**
     * Secao 5: "um usuario nao devera conseguir acessar dados de outro cliente
     * modificando identificadores". 404 e nao 403 de proposito - dizer
     * "proibido" confirmaria que o exame existe.
     */
    const porId = await req('GET', `/portal/exames/${casoDaCentral}`);
    expect(porId.status).toBe(404);

    const escrita = await req('POST', `/portal/exames/${casoDaCentral}/historico`, {
      texto: 'Tentativa de escrever no caso de outro cliente.',
    });
    expect([403, 404]).toContain(escrita.status);
  });

  test('o status vem traduzido e o interno não vaza', async () => {
    await entrar('portal@clinicacentral.local');

    const dossie = await req('GET', `/portal/exames/${casoDaCentral}`);
    expect(dossie.status, JSON.stringify(dossie.body)).toBe(200);

    // Secao 12: o cliente ve "aguardando recebimento", nunca a etapa tecnica.
    expect(dossie.body.status).toBe('aguardando_recebimento');
    const texto = JSON.stringify(dossie.body);
    expect(texto).not.toContain('aguardando_macroscopia');
    expect(texto).not.toContain('nota_interna');

    // Secao 62-63: a linha do tempo externa e traduzida, nao a interna.
    expect(dossie.body.linhaDoTempo.map((e: any) => e.rotulo)).toContain('Exame cadastrado');
    expect(texto).not.toContain('fluxo.etapa_alterada');

    // Sem laudo liberado, nao ha laudo nenhum a mostrar (secao 20).
    expect(dossie.body.laudo).toBeNull();
  });

  test('complementar histórico acrescenta sem apagar o que já existia', async () => {
    const antes = await req('GET', `/portal/exames/${casoDaCentral}`);
    const quantidadeAntes = antes.body.historicos.length;
    expect(quantidadeAntes).toBeGreaterThan(0);

    const r = await req('POST', `/portal/exames/${casoDaCentral}/historico`, {
      texto: 'Paciente iniciou antibiótico há 5 dias; a lesão reduziu discretamente.',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const depois = await req('GET', `/portal/exames/${casoDaCentral}`);
    // Secao 24: o conteudo anterior permanece - o novo e complemento.
    expect(depois.body.historicos).toHaveLength(quantidadeAntes + 1);
    expect(depois.body.historicos[0].texto).toBe(antes.body.historicos[0].texto);
    expect(depois.body.historicos.at(-1).complementar).toBe(true);

    // E o laboratorio ve o complemento no dossie interno, na linha do tempo.
    await entrar('patologista@lapato.local');
    const interno = await req('GET', `/casos/${casoDaCentral}`);
    expect(interno.body.linhaDoTempo.map((e: any) => e.tipo)).toContain(
      'historico.complementado',
    );
  });

  test('laudo só aparece depois de liberado, e o PDF é o assinado', async () => {
    // Ate aqui o caso ficou parado de proposito, para o teste do status
    // externo. Agora ele precisa percorrer o fluxo de verdade.
    await levarAteBancada(casoDaCentral);

    // O patologista elabora e assina - mas ainda NAO libera.
    await entrar('patologista@lapato.local');
    const abrir = await req('POST', `/laudos/casos/${casoDaCentral}`);
    versaoAssinada = abrir.body.versaoId;

    await req('POST', `/laudos/versoes/${versaoAssinada}`, {
      descricaoMicroscopica: 'Proliferação de células fusiformes.',
      diagnosticos: [{ textoExibido: 'Fibrossarcoma cutâneo' }],
    });
    const assinatura = await req('POST', `/laudos/versoes/${versaoAssinada}/assinatura`);
    expect(assinatura.status, JSON.stringify(assinatura.body)).toBe(201);

    /**
     * Assinado nao e liberado. O documento existe e esta congelado, mas o ato
     * que o entrega ao cliente e a liberacao (DIRETRIZES secao 17) - antes
     * dela, o Portal nao o conhece.
     */
    await entrar('portal@clinicacentral.local');
    const antes = await req('GET', `/portal/exames/${casoDaCentral}`);
    expect(antes.body.laudo).toBeNull();

    const pdfCedo = await fetch(`${servidor}${BASE}/portal/laudos/${versaoAssinada}/pdf`, {
      headers: { cookie },
    });
    expect(pdfCedo.status).toBe(404);

    // Liberado, aparece.
    await entrar('patologista@lapato.local');
    const liberacao = await req('POST', `/laudos/versoes/${versaoAssinada}/liberacao`);
    expect(liberacao.status, JSON.stringify(liberacao.body)).toBe(201);

    await entrar('portal@clinicacentral.local');
    const depois = await req('GET', `/portal/exames/${casoDaCentral}`);
    expect(depois.body.status).toBe('laudo_disponivel');
    expect(depois.body.laudo.versoes).toHaveLength(1);
    expect(depois.body.laudo.versoes[0].vigente).toBe(true);

    const pdf = await fetch(`${servidor}${BASE}/portal/laudos/${versaoAssinada}/pdf`, {
      headers: { cookie },
    });
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');

    // O laudo do outro cliente continua fora de alcance, mesmo liberado.
    await entrar('portal@petcare.local');
    const alheio = await fetch(`${servidor}${BASE}/portal/laudos/${versaoAssinada}/pdf`, {
      headers: { cookie },
    });
    expect(alheio.status).toBe(404);
  });

  test('o laboratório cria a conta do Portal pela tela de usuários', async () => {
    /**
     * Sem isto o M04 nao existe em producao: nao ha convite por e-mail (depende
     * do M26), entao quem abre a porta e o administrador, com o mesmo fluxo de
     * senha provisoria das contas internas.
     */
    await entrar('admin@lapato.local');

    const perfis = await req('GET', '/usuarios/perfis');
    const perfilPortal = perfis.body.find((p: any) => p.chave === 'veterinario_solicitante');
    expect(perfilPortal, 'perfil do Portal ausente').toBeTruthy();

    const marca = Date.now().toString().slice(-6);

    // Perfil do Portal sem cliente e recusado: conta externa sem escopo entraria
    // e nao veria nada, sem ninguem entender por que (M04 secao 5).
    const semCliente = await req('POST', '/usuarios', {
      nomeCompleto: `Dra. Externa ${marca}`,
      email: `externa${marca}@clinica.local`,
      perfilIds: [perfilPortal.id],
    });
    expect(semCliente.status).toBe(400);
    expect(semCliente.body.detail).toContain('cliente');

    const clientes = await req('GET', '/catalogo/clientes');
    const criada = await req('POST', '/usuarios', {
      nomeCompleto: `Dra. Externa ${marca}`,
      email: `externa${marca}@clinica.local`,
      perfilIds: [perfilPortal.id],
      clienteId: clientes.body.find((c: any) => c.codigo === 'CV').id,
    });
    expect(criada.status, JSON.stringify(criada.body)).toBe(201);
    expect(criada.body.senhaProvisoria).toBeTruthy();

    // A conta nova ja entra no Portal, presa ao cliente - depois da troca de
    // senha obrigatoria, como qualquer conta criada por terceiro (M02 secao 31).
    cookie = '';
    const login = await req('POST', '/auth/login', {
      instituicao: 'demo',
      email: `externa${marca}@clinica.local`,
      senha: criada.body.senhaProvisoria,
    });
    expect(login.body.estagio).toBe('troca_senha_obrigatoria');

    const troca = await req('POST', '/auth/senha', {
      senhaAtual: criada.body.senhaProvisoria,
      senhaNova: `Externa!${marca}#Nova`,
    });
    expect(troca.status).toBe(200);

    const painel = await req('GET', '/portal/painel');
    expect(painel.status, JSON.stringify(painel.body)).toBe(200);
    expect(painel.body.cliente).toBe('Clínica Veterinária Central');
  });

  test('conta interna não entra no Portal; conta do Portal não entra no sistema', async () => {
    // Recepcao nao tem `portal:acessar`.
    await entrar('recepcao@lapato.local');
    const interna = await req('GET', '/portal/painel');
    expect(interna.status).toBe(403);

    // E a conta do Portal nao alcanca as rotas internas.
    await entrar('portal@clinicacentral.local');
    const fila = await req('GET', '/fluxo/casos');
    expect(fila.status).toBe(403);

    const painel = await req('GET', '/portal/painel');
    expect(painel.status).toBe(200);
    expect(painel.body.cliente).toBe('Clínica Veterinária Central');
    expect(painel.body.laudosLiberados).toBeGreaterThan(0);
  });
});

describe('laudo incompleto não vira beco sem saída (M11)', () => {
  /**
   * O caso que originou este bloco, reportado no uso real: um laudo sem
   * diagnostico atravessou a revisao inteira e so foi barrado na assinatura -
   * onde o formulario ja e leitura, para nao editar por baixo do revisor. O
   * usuario lia "adicione um diagnostico nesta tela" numa tela que nao deixava
   * adicionar nada, e nao havia caminho de volta.
   *
   * Duas saidas, testadas aqui: a completude passa a ser conferida no envio
   * para revisao, e quem ja estiver preso pode retomar a edicao.
   */
  let casoId: string;
  let versaoId: string;

  test('laudo sem diagnóstico não passa do envio para revisão', async () => {
    await entrar('recepcao@lapato.local');
    const servicos = await req('GET', '/catalogo/servicos');
    const clientes = await req('GET', '/catalogo/clientes');
    const criado = await req('POST', '/casos', {
      servicoId: servicos.body.find((s: { codigo: string }) => s.codigo === 'HISTO').id,
      clienteId: clientes.body[0].id,
      paciente: { nome: `Beco ${Date.now().toString().slice(-5)}` },
      amostras: [{ descricao: 'Fragmento' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    casoId = criado.body.id;
    await levarAteBancada(casoId);

    await entrar('patologista@lapato.local');
    const abrir = await req('POST', `/laudos/casos/${casoId}`);
    versaoId = abrir.body.versaoId;
    await req('POST', `/laudos/versoes/${versaoId}`, {
      descricaoMicroscopica: 'Proliferação de células fusiformes.',
    });

    const envio = await req('POST', `/laudos/versoes/${versaoId}/revisao`);
    expect(envio.status, JSON.stringify(envio.body)).toBe(409);

    const achado = envio.body.achados.find(
      (a: { codigo: string }) => a.codigo === 'LAUDO_SEM_DIAGNOSTICO',
    );
    expect(achado).toBeTruthy();
    expect(achado.comoResolver).toContain('Diagnósticos');

    /**
     * O revisor nao chega a ver: a assinatura profissional NAO entra nesta
     * checagem, porque quem elabora nem sempre e quem assina - cobrar aqui
     * barraria o residente que so redige.
     */
    expect(
      envio.body.achados.some(
        (a: { codigo: string }) => a.codigo === 'ASSINATURA_INEXISTENTE_OU_EXPIRADA',
      ),
    ).toBe(false);
  });

  test('com diagnóstico, o envio passa e a revisão aprova', async () => {
    await req('POST', `/laudos/versoes/${versaoId}`, {
      diagnosticos: [{ textoExibido: 'Fibrossarcoma cutâneo' }],
    });

    const envio = await req('POST', `/laudos/versoes/${versaoId}/revisao`);
    expect(envio.status, JSON.stringify(envio.body)).toBe(201);

    await entrar('admin@lapato.local');
    const conclusao = await req('POST', `/laudos/versoes/${versaoId}/revisao/conclusao`, {
      resultado: 'aprovada',
    });
    expect(conclusao.status, JSON.stringify(conclusao.body)).toBe(201);

    const laudo = await req('GET', `/laudos/casos/${casoId}`);
    expect(laudo.body.versaoCorrente.status ?? laudo.body.status).toBe('aguardando_assinatura');
  });

  test('retomar edição volta ao rascunho e desfaz a aprovação', async () => {
    await entrar('patologista@lapato.local');

    const semMotivo = await req('POST', `/laudos/versoes/${versaoId}/reabertura`, { motivo: '' });
    expect(semMotivo.status, 'motivo é obrigatório: o ato desfaz o trabalho do revisor').toBe(400);

    const reabertura = await req('POST', `/laudos/versoes/${versaoId}/reabertura`, {
      motivo: 'Diagnóstico precisa ser revisto antes da assinatura.',
    });
    expect(reabertura.status, JSON.stringify(reabertura.body)).toBe(201);

    const laudo = await req('GET', `/laudos/casos/${casoId}`);
    expect(laudo.body.status).toBe('rascunho');

    // Editavel de novo - era exatamente isto que faltava.
    const edicao = await req('POST', `/laudos/versoes/${versaoId}`, {
      conclusao: 'Fibrossarcoma cutâneo, margens livres.',
    });
    expect(edicao.status, JSON.stringify(edicao.body)).toBe(201);

    // O motivo fica na linha do tempo do caso.
    const dossie = await req('GET', `/casos/${casoId}`);
    expect(dossie.body.linhaDoTempo.map((e: { tipo: string }) => e.tipo)).toContain(
      'laudo.reaberto_para_edicao',
    );
  });

  test('rascunho não pode ser reaberto - só quem está aguardando assinatura', async () => {
    const r = await req('POST', `/laudos/versoes/${versaoId}/reabertura`, {
      motivo: 'Tentativa em estado que não permite.',
    });
    expect(r.status).toBe(400);
    expect(r.body.detail).toContain('aguardando assinatura');
  });
});

describe('assinatura profissional (M02 §45)', () => {
  /**
   * O Guardian barra a assinatura do laudo de quem nao tem assinatura
   * profissional valida - e ate agora ela so existia no CLI de
   * provisionamento. Quem provisionasse a instituicao sem informar o conselho
   * ficava com um bloqueio critico e **nenhum caminho de saida dentro do
   * produto**. Foi o que travou o primeiro uso real.
   *
   * O teste percorre o ciclo nos dois sentidos, no patologista do seed: tirar a
   * assinatura barra, registrar de volta libera. Termina com assinatura valida,
   * porque outros blocos do arquivo assinam com esta mesma conta.
   */
  let usuarioId: string;
  let versaoId: string;

  test('a lista de usuários mostra quem está apto a assinar', async () => {
    await entrar('admin@lapato.local');

    const lista = await req('GET', '/usuarios');
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);

    const patologista = lista.body.find(
      (u: { email: string }) => u.email === 'patologista@lapato.local',
    );
    expect(patologista, 'patologista do seed ausente').toBeTruthy();
    expect(patologista.assinaturaAtiva).toBe(true);
    usuarioId = patologista.id;
  });

  test('validade no passado é recusada', async () => {
    const r = await req('POST', `/usuarios/${usuarioId}/assinaturas`, {
      identificacaoProfissional: 'CRMV-CE 00000',
      validoAte: '2020-01-01T00:00:00.000Z',
    });
    expect(r.status).toBe(400);
    expect(r.body.detail).toContain('validade');
  });

  test('sem assinatura válida o Guardian barra - e o achado diz como resolver', async () => {
    // Um caso pronto para a bancada, com laudo elaborado.
    await entrar('recepcao@lapato.local');
    const servicos = await req('GET', '/catalogo/servicos');
    const clientes = await req('GET', '/catalogo/clientes');
    const criado = await req('POST', '/casos', {
      servicoId: servicos.body.find((s: { codigo: string }) => s.codigo === 'HISTO').id,
      clienteId: clientes.body[0].id,
      paciente: { nome: `Assinatura ${Date.now().toString().slice(-5)}` },
      amostras: [{ descricao: 'Fragmento' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    await levarAteBancada(criado.body.id);

    await entrar('patologista@lapato.local');
    const abrir = await req('POST', `/laudos/casos/${criado.body.id}`);
    versaoId = abrir.body.versaoId;
    await req('POST', `/laudos/versoes/${versaoId}`, {
      descricaoMicroscopica: 'Proliferação de células fusiformes.',
      diagnosticos: [{ textoExibido: 'Fibrossarcoma' }],
    });

    // O administrador inativa a assinatura vigente.
    await entrar('admin@lapato.local');
    const assinaturas = await req('GET', `/usuarios/${usuarioId}/assinaturas`);
    const vigente = assinaturas.body.find((a: { ativa: boolean }) => a.ativa);
    expect(vigente, JSON.stringify(assinaturas.body)).toBeTruthy();
    const inativacao = await req(
      'POST',
      `/usuarios/${usuarioId}/assinaturas/${vigente.id}/inativacao`,
    );
    expect(inativacao.status, JSON.stringify(inativacao.body)).toBe(201);

    const lista = await req('GET', '/usuarios');
    expect(lista.body.find((u: { id: string }) => u.id === usuarioId).assinaturaAtiva).toBe(false);

    // Agora a assinatura do laudo e barrada.
    await entrar('patologista@lapato.local');
    const tentativa = await req('POST', `/laudos/versoes/${versaoId}/assinatura`);
    expect(tentativa.status, JSON.stringify(tentativa.body)).toBe(409);

    const achado = tentativa.body.achados.find(
      (a: { codigo: string }) => a.codigo === 'ASSINATURA_INEXISTENTE_OU_EXPIRADA',
    );
    expect(achado, JSON.stringify(tentativa.body)).toBeTruthy();

    /**
     * M17 secao 11: o alerta existe para o profissional decidir, e decidir
     * exige saber a saida. Sem isto a pessoa le "nao possui assinatura ativa" e
     * fica parada - foi exatamente o que aconteceu no primeiro uso real.
     */
    expect(achado.comoResolver).toContain('Usuários e Perfis');
  });

  test('registrar pela interface devolve a capacidade de assinar', async () => {
    await entrar('admin@lapato.local');

    const registro = await req('POST', `/usuarios/${usuarioId}/assinaturas`, {
      identificacaoProfissional: 'CRMV-CE 4321',
    });
    expect(registro.status, JSON.stringify(registro.body)).toBe(201);

    // Inativacao, nunca exclusao (M01): a anterior continua no historico,
    // porque o laudo ja assinado aponta para ela.
    const assinaturas = await req('GET', `/usuarios/${usuarioId}/assinaturas`);
    expect(assinaturas.body.length).toBeGreaterThanOrEqual(2);
    expect(assinaturas.body.filter((a: { ativa: boolean }) => a.ativa)).toHaveLength(1);

    await entrar('patologista@lapato.local');
    const assinatura = await req('POST', `/laudos/versoes/${versaoId}/assinatura`);
    expect(assinatura.status, JSON.stringify(assinatura.body)).toBe(201);
  });
});

describe('material sem recebimento não chega à bancada', () => {
  /**
   * M05 secao 12: solicitado, cadastrado, recebido e triado sao quatro momentos
   * distintos. Cadastrar e registrar que alguem pediu o exame - nao e o
   * material na mao.
   *
   * O defeito que originou este bloco: a macroscopia so recusava triagem
   * `bloqueado`/`recusado`, e resultado nulo - triagem que **nunca aconteceu** -
   * passava; o laudo nao checava nada. Dava para encassetar e laudar material
   * recem cadastrado, sem recebimento nem conferencia, quebrando a cadeia de
   * custodia no primeiro elo.
   */
  let casoId: string;
  let amostraId: string;

  test('cadastro sozinho não autoriza macroscopia nem laudo', async () => {
    await entrar('recepcao@lapato.local');

    const servicos = await req('GET', '/catalogo/servicos');
    const clientes = await req('GET', '/catalogo/clientes');
    const criado = await req('POST', '/casos', {
      servicoId: servicos.body.find((s: { codigo: string }) => s.codigo === 'HISTO').id,
      clienteId: clientes.body[0].id,
      paciente: { nome: `Sem recebimento ${Date.now().toString().slice(-5)}` },
      amostras: [{ descricao: 'Fragmento' }],
      recipientes: [{ quantidadeDeclarada: 1 }],
    });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    casoId = criado.body.id;
    amostraId = criado.body.amostras?.[0]?.id ?? (await req('GET', `/casos/${casoId}`)).body.amostras[0].id;

    await entrar('patologista@lapato.local');

    const macro = await req('POST', `/macroscopia/amostras/${amostraId}`);
    expect(macro.status, JSON.stringify(macro.body)).toBe(400);
    expect(macro.body.detail).toContain('ainda não foi recebido');

    const laudo = await req('POST', `/laudos/casos/${casoId}`);
    expect(laudo.status, JSON.stringify(laudo.body)).toBe(400);
    expect(laudo.body.detail).toContain('ainda não foi recebido');
  });

  test('recebido mas não triado continua barrado', async () => {
    await entrar('tecnico@lapato.local');
    const dossie = await req('GET', `/casos/${casoId}`);
    const recebimento = await req('POST', `/casos/${casoId}/recebimento`, {
      conferencia: [
        { recipienteId: dossie.body.recipientes[0].id, quantidadeRecebida: 1 },
      ],
    });
    expect(recebimento.status, JSON.stringify(recebimento.body)).toBe(201);

    await entrar('patologista@lapato.local');

    // O servico HISTO exige triagem (M01). Recebido nao basta.
    const macro = await req('POST', `/macroscopia/amostras/${amostraId}`);
    expect(macro.status, JSON.stringify(macro.body)).toBe(400);
    expect(macro.body.detail).toContain('triagem ainda não foi concluída');

    const laudo = await req('POST', `/laudos/casos/${casoId}`);
    expect(laudo.status).toBe(400);
  });

  test('depois da triagem apta a bancada abre normalmente', async () => {
    await entrar('tecnico@lapato.local');
    const triagem = await req('POST', `/casos/${casoId}/triagem`, {
      amostras: [{ amostraId, resultado: 'apto' }],
    });
    expect(triagem.status, JSON.stringify(triagem.body)).toBe(201);

    await entrar('patologista@lapato.local');

    const macro = await req('POST', `/macroscopia/amostras/${amostraId}`);
    expect(macro.status, JSON.stringify(macro.body)).toBe(201);

    const laudo = await req('POST', `/laudos/casos/${casoId}`);
    expect(laudo.status, JSON.stringify(laudo.body)).toBe(201);
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

    /**
     * Bloquear sem dizer por quê é recusado. O bloqueio suspende o prazo e cria
     * uma pendência de descrição genérica; sem o motivo, ninguém consegue
     * resolvê-la depois.
     */
    const semMotivo = await req('POST', `/casos/${criado.body.id}/triagem`, {
      amostras: [{ amostraId, resultado: 'bloqueado' }],
    });
    expect(semMotivo.status).toBe(400);

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

    /**
     * M10 seções 5 e 94: o cliente esclarece, alguém valida e RESOLVE a
     * pendência - e é isso, não uma edição manual de status, que desbloqueia
     * o caso no M07. A pendência nasceu na triagem (M06), mas pertence ao M10;
     * resolver aqui destrava lá.
     */
    const pendencias = await req('GET', '/solicitacoes/pendencias');
    const daTriagem = pendencias.body.find((p: any) => p.casoId === criado.body.id);
    expect(daTriagem, 'pendência da triagem ausente da fila do M10').toBeTruthy();

    // Resolver sem dizer o desfecho é recusado.
    const semResolucao = await req(
      'POST',
      `/solicitacoes/pendencias/${daTriagem.id}/resolucao`,
      { resolucao: '' },
    );
    expect(semResolucao.status).toBe(400);

    const resolucao = await req('POST', `/solicitacoes/pendencias/${daTriagem.id}/resolucao`, {
      resolucao: 'Tutor confirmou por escrito a identificação do material.',
    });
    expect(resolucao.status, JSON.stringify(resolucao.body)).toBe(201);

    const desbloqueado = await req('GET', `/casos/${criado.body.id}`);
    expect(desbloqueado.body.estado.bloqueado).toBe(false);
    expect(desbloqueado.body.linhaDoTempo.map((e: any) => e.tipo)).toContain(
      'fluxo.desbloqueado',
    );
  });
});

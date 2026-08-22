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
      codigo: `EXPR${marca.slice(-2)}`,
      categoria: 'anatomia_patologica',
      modalidade: 'histopatologia',
      prazoDiasUteis: 2,
    });
    expect(servico.status, JSON.stringify(servico.body)).toBe(201);

    // Código repetido é barrado.
    const repetido = await req('POST', '/administracao/servicos', {
      nome: 'Outro',
      codigo: `EXPR${marca.slice(-2)}`,
      categoria: 'anatomia_patologica',
      modalidade: 'histopatologia',
    });
    expect(repetido.status).toBe(400);

    // O serviço novo já aparece nas opções de cadastro (catálogo)...
    const catalogo = await req('GET', '/catalogo/servicos');
    const novo = catalogo.body.find((s: any) => s.codigo === `EXPR${marca.slice(-2)}`);
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
     * Estado alcançável pela tela: o admin cria o serviço de citopatologia
     * antes de existir workflow da modalidade. O caso é recusado com 400 e a
     * mensagem diz o que falta - era um 500 opaco.
     */
    const servico = await req('POST', '/administracao/servicos', {
      nome: `Citologia ${marca}`,
      codigo: `CITO${marca.slice(-2)}`,
      categoria: 'anatomia_patologica',
      modalidade: 'citopatologia',
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

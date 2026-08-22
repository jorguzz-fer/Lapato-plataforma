import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ENV, type Env } from '../config/env.js';

/**
 * Arquivo armazenado sob uma chave privada.
 *
 * DIRETRIZES / Blueprint secao 6: bucket privado, sem acesso publico direto.
 * Quem baixa passa pela API, que decide se autoriza - nenhum provedor aqui
 * devolve URL publica.
 */
export interface StorageProvider {
  readonly nome: string;
  salvar(chave: string, dados: Buffer, mimeType: string): Promise<{ hash: string }>;
  baixar(chave: string): Promise<Buffer>;
}

/** SHA-256 do conteudo - o mesmo algoritmo em qualquer provedor. */
function hashDoConteudo(dados: Buffer): string {
  return createHash('sha256').update(dados).digest('hex');
}

/**
 * Provedor local, em disco.
 *
 * Existe pela mesma razao do `CopilotoStubProvider`: dev e teste nao podem
 * depender de uma credencial de nuvem so para rodar. Nao e para producao - a
 * validacao em `env.ts` barra `STORAGE_PROVIDER=local` junto de
 * `NODE_ENV=production` no nivel de infraestrutura (Dockerfile/Coolify), nao
 * aqui, para nao duplicar a regra.
 */
@Injectable()
export class StorageLocalProvider implements StorageProvider {
  readonly nome = 'local';

  constructor(@Inject(ENV) private readonly env: Env) {}

  private caminho(chave: string): string {
    // `resolve` normaliza; a chave nunca vem de entrada do usuario sem passar
    // pelo identificador gerado no servico, mas a normalizacao fica de todo jeito.
    return resolve(this.env.STORAGE_LOCAL_DIR, chave);
  }

  async salvar(chave: string, dados: Buffer): Promise<{ hash: string }> {
    const caminho = this.caminho(chave);
    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, dados);
    return { hash: hashDoConteudo(dados) };
  }

  async baixar(chave: string): Promise<Buffer> {
    return readFile(this.caminho(chave));
  }
}

/**
 * Provedor Cloudflare R2, via API compativel com S3.
 *
 * R2 nao cobra egresso, o que importa aqui porque o PDF do laudo e baixado
 * por quem assina, por quem revisa e potencialmente pelo Portal do Cliente
 * (M04) mais tarde - trafego repetido do mesmo arquivo pequeno.
 *
 * Nao e gerenciado pelo Nest (sem `@Injectable`) de proposito: construir o
 * `S3Client` exige as quatro credenciais, e um provider do Nest e instanciado
 * na subida do modulo mesmo quando `STORAGE_PROVIDER=local` - derrubaria o
 * ambiente de dev por falta de uma credencial que ele nem usa. `StorageFactory`
 * cria esta classe com `new`, e so quando `STORAGE_PROVIDER=r2`.
 */
export class StorageR2Provider implements StorageProvider {
  readonly nome = 'r2';
  private readonly cliente: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
      // Defesa em profundidade: `carregarEnv` ja bloqueia a subida sem isto,
      // mas o construtor nao deveria assumir silenciosamente que passou por ela.
      throw new Error('Credenciais do R2 ausentes.');
    }

    this.bucket = env.R2_BUCKET;
    this.cliente = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  async salvar(chave: string, dados: Buffer, mimeType: string): Promise<{ hash: string }> {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: chave,
        Body: dados,
        ContentType: mimeType,
      }),
    );
    return { hash: hashDoConteudo(dados) };
  }

  async baixar(chave: string): Promise<Buffer> {
    const resposta = await this.cliente.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: chave }),
    );
    const bytes = await resposta.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Objeto "${chave}" vazio ou nao encontrado no R2.`);
    return Buffer.from(bytes);
  }
}

/**
 * Seleciona o provedor conforme a configuracao - mesmo padrao do
 * `CopilotoFactory`. Servicos de dominio conhecem apenas `StorageProvider`;
 * trocar de backend (R2 hoje, outro S3-compativel amanha) nao os toca.
 */
@Injectable()
export class StorageFactory {
  private r2: StorageR2Provider | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly local: StorageLocalProvider,
  ) {}

  criar(): StorageProvider {
    if (this.env.STORAGE_PROVIDER === 'r2') {
      // Criado sob demanda e memorizado - nao na subida do modulo, para o
      // ambiente local nunca precisar das credenciais do R2.
      this.r2 ??= new StorageR2Provider(this.env);
      return this.r2;
    }
    return this.local;
  }
}

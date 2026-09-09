import { api } from '../../api';

/**
 * Espelho do que o servidor aceita (M16 secao 61: "limite de tamanho, formatos
 * permitidos... arquivos rejeitados deverao gerar mensagem clara"). Repetir a
 * regra aqui nao substitui a validacao do servidor - serve para o usuario saber
 * ANTES de escolher o arquivo, em vez de descobrir por erro.
 */
export const FORMATOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const TAMANHO_MAXIMO_IMAGEM_MB = 25;

/**
 * Miniatura gerada no navegador, no momento do envio.
 *
 * Redimensionar no servidor exigiria dependência nativa de imagem na imagem
 * Docker da API; aqui o arquivo já está na mão de quem envia. O original sobe
 * intacto — a miniatura é só para a galeria não baixar 8 MB por quadradinho
 * (M16 §73).
 */
export async function gerarMiniatura(arquivo: File, lado = 400): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72));
  } catch {
    // Navegador sem createImageBitmap ou formato que ele não decodifica: segue
    // sem miniatura, e a galeria cai no original.
    return null;
  }
}

/** Recusa antes de subir: mandar 30 MB pela rede para receber "não aceito" gasta o tempo de quem envia. */
export function conferirImagem(arquivo: File): void {
  if (!FORMATOS_IMAGEM.includes(arquivo.type)) {
    throw new Error(
      `"${arquivo.name}" não é um formato aceito. Envie JPEG, PNG, WebP ou HEIC — ` +
        'PDF e documentos não entram no acervo de imagens.',
    );
  }
  if (arquivo.size > TAMANHO_MAXIMO_IMAGEM_MB * 1024 * 1024) {
    throw new Error(
      `"${arquivo.name}" tem ${(arquivo.size / 1024 / 1024).toFixed(1)} MB e o limite é ${TAMANHO_MAXIMO_IMAGEM_MB} MB.`,
    );
  }
}

/**
 * Um envio ao acervo do caso (M16). O mesmo caminho serve a galeria, o
 * recebimento e o cadastro do caso: mesma validação, mesma miniatura, mesmo
 * acervo. O tipo vem da tela que envia - a pessoa não escolhe "etapa"
 * (terceira revisão com o Hugo: "só anexa").
 */
export async function enviarImagemDoCaso(
  casoId: string,
  arquivo: File,
  tipo: string,
  moduloContexto: string,
): Promise<void> {
  conferirImagem(arquivo);
  const corpo = new FormData();
  corpo.append('arquivo', arquivo);
  corpo.append('tipo', tipo);
  corpo.append('moduloContexto', moduloContexto);
  const mini = await gerarMiniatura(arquivo);
  if (mini) corpo.append('miniatura', mini, 'miniatura.jpg');
  await api.postForm(`/imagens/casos/${casoId}`, corpo);
}

'use client';
// OCR grátis no próprio aparelho (Tesseract, português). Na primeira vez baixa ~10 MB, depois fica em cache.

async function toCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const maxSide = 2000;
    const scale = Math.min(2, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    // tons de cinza + contraste (cupom térmico costuma vir apagado)
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    let min = 255, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      p[i] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < p.length; i += 4) {
      let g = ((p[i] - min) / range) * 255;
      g = g < 128 ? g * 0.75 : Math.min(255, g * 1.1);
      p[i] = p[i + 1] = p[i + 2] = g;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function ocrImage(file: File, onProgress?: (msg: string) => void): Promise<string> {
  onProgress?.('Preparando a foto…');
  const canvas = await toCanvas(file);
  const { createWorker } = await import('tesseract.js');
  onProgress?.('Carregando o leitor de texto…');
  const worker = await createWorker('por', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(`Lendo o cupom… ${Math.round(m.progress * 100)}%`);
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}

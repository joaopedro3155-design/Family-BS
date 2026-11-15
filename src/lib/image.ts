'use client';
import jsQR from 'jsqr';

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function draw(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Procura um QR code na foto (tenta em dois tamanhos). */
export async function decodeQr(file: File): Promise<string | null> {
  const img = await loadImage(file);
  for (const size of [1400, 900, 2200]) {
    const c = draw(img, size);
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const code = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
    if (code?.data) return code.data;
  }
  return null;
}

/** Reduz a foto para mandar ao Claude (JPEG, lado maior 1600 px). */
export async function compressImage(file: File): Promise<{ base64: string; mediaType: string }> {
  const img = await loadImage(file);
  const c = draw(img, 1600);
  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
}

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

/** Lê um QR de um recorte (x, y, w, h) de qualquer fonte desenhável, reduzido a `size` px. */
export function scanRegion(src: CanvasImageSource, sw: number, sh: number, crop: number, size: number, canvas?: HTMLCanvasElement, invert = false): string | null {
  const side = Math.min(sw, sh) * crop;
  const w = crop >= 1 ? sw : side, h = crop >= 1 ? sh : side;
  const x = (sw - w) / 2, y = (sh - h) / 2;
  const scale = Math.min(1, size / Math.max(w, h));
  const c = canvas ?? document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const code = jsQR(data.data, data.width, data.height, { inversionAttempts: invert ? 'attemptBoth' : 'dontInvert' });
  return code?.data || null;
}

/** Procura um QR code na foto: tenta vários recortes e tamanhos (o QR da NFC-e é denso). */
export async function decodeQr(file: File): Promise<string | null> {
  const img = await loadImage(file);
  const w = img.naturalWidth, h = img.naturalHeight;
  const tries: [number, number][] = [[1, 1400], [0.6, 1000], [0.8, 1200], [0.45, 800], [1, 2400], [0.35, 700], [1, 900]];
  for (const [crop, size] of tries) {
    const r = scanRegion(img, w, h, crop, size, undefined, true);
    if (r) return r;
  }
  return null;
}

/** Normaliza o conteúdo do QR da NFC-e para um link. */
export function qrToUrl(raw: string): string | null {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t) || /fazenda|sefaz|nfce/i.test(t)) return `https://${t.replace(/^\/+/, '')}`;
  return null;
}

/** Reduz a foto para mandar ao Claude (JPEG, lado maior 1600 px). */
export async function compressImage(file: File): Promise<{ base64: string; mediaType: string }> {
  const img = await loadImage(file);
  const c = draw(img, 1600);
  const dataUrl = c.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
}

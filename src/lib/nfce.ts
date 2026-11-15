// Leitura da NFC-e (cupom fiscal eletrônico) a partir do QR code.
import type { ReceiptItem } from './stock';

/** Valida o conteúdo do QR e extrai a URL da SEFAZ e a chave de acesso (44 dígitos). */
export function parseNfceQr(qr: string): { url: string; accessKey: string | null } | null {
  const t = qr.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  if (!/fazenda|sefaz|nfce|nfe/i.test(u.hostname + u.pathname)) return null;
  const p = u.searchParams.get('p') || u.searchParams.get('chNFe') || '';
  const key = (p.split('|')[0] || '').replace(/\D/g, '');
  const fromPath = t.match(/\d{44}/)?.[0] ?? null;
  return { url: t, accessKey: key.length === 44 ? key : fromPath };
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const clean = s.replace(/[^\d,.-]/g, '');
  if (!clean) return null;
  const v = clean.includes(',') ? Number(clean.replace(/\./g, '').replace(',', '.')) : Number(clean);
  return Number.isNaN(v) ? null : v;
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

export interface NfceParsed {
  store: string | null;
  cnpj: string | null;
  issuedOn: string | null;
  total: number | null;
  paymentMethod: string | null;
  items: ReceiptItem[];
}

/**
 * Lê a página pública padrão da NFC-e (layout usado por SP e pela maioria dos estados).
 * Se o layout for diferente, items volta vazio e o servidor manda o texto da página para o Claude.
 */
export function parseNfceHtml(html: string): NfceParsed {
  const items: ReceiptItem[] = [];
  const rowRe = /<tr[^>]*id="Item\s*\+?\s*\d+"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const name = text(row.match(/class="txtTit\d?"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const qty = num(text(row.match(/class="Rqtd"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '').replace(/^.*?:/, ''));
    const unit = text(row.match(/class="RUN"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '').replace(/^.*?:/, '').trim() || null;
    const unitPrice = num(text(row.match(/class="RvlUnit"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '').replace(/^.*?:/, ''));
    const total = num(text(row.match(/class="valor"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? ''));
    if (name) items.push({ name, qty: qty ?? 1, unit, unitPrice, total });
  }
  const store = text(html.match(/id="u20"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '') || null;
  const cnpj = html.match(/CNPJ:\s*([\d./-]{14,18})/i)?.[1] ?? null;
  const date = html.match(/Emiss[ãa]o:\s*<\/strong>\s*(\d{2})\/(\d{2})\/(\d{4})|Emiss[ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const issuedOn = date ? `${date[3] ?? date[6]}-${date[2] ?? date[5]}-${date[1] ?? date[4]}` : null;
  const total = num(text(html.match(/class="totalNumb txtMax"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '')) ?? null;
  const pay = text(html.match(/class="tx"[^>]*>([\s\S]*?)<\/label>/i)?.[1] ?? '').toLowerCase();
  const paymentMethod = /cr[eé]dito/.test(pay) ? 'credito' : /d[eé]bito/.test(pay) ? 'debito' : /pix|instant/.test(pay) ? 'pix' : /dinheiro/.test(pay) ? 'dinheiro' : null;
  return { store, cnpj, issuedOn, total, paymentMethod, items };
}

export function htmlToText(html: string): string {
  return text(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''));
}

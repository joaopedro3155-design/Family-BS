// Regras do estoque: nomes, correspondência com a nota e estimativa de duração.

export interface ReadReceiptResponse {
  source: 'nfce' | 'foto';
  accessKey: string | null;
  store: string | null;
  cnpj: string | null;
  issuedOn: string | null;
  total: number | null;
  paymentMethod: string | null;
  suggestedCategory: string | null;
  items: ReceiptItem[];
  warning?: string;
  storeKind?: 'posto' | 'padaria' | 'acougue' | 'mercado' | 'farmacia' | 'pet' | 'restaurante' | null;
}

export interface ReceiptItem { name: string; qty: number; unit: string | null; unitPrice: number | null; total: number | null }

export interface StockItem {
  id: string;
  household_id: string;
  name: string;
  category: 'alimentos' | 'higiene' | 'casa' | 'bebe' | 'pet' | 'outros';
  unit: string;
  quantity: number;
  quantity_updated_at: string;
  daily_usage: number | null;
  min_days: number;
  aliases: string[];
  last_price: number | null;
  last_store: string | null;
  active: boolean;
}

export interface Movement { delta: number; kind: 'compra' | 'consumo' | 'ajuste' | 'acabou'; occurred_at: string }

export const STOCK_CATEGORIES: { id: StockItem['category']; label: string }[] = [
  { id: 'alimentos', label: 'Alimentos' },
  { id: 'higiene', label: 'Higiene' },
  { id: 'casa', label: 'Casa' },
  { id: 'bebe', label: 'Bebê' },
  { id: 'pet', label: 'Pet' },
  { id: 'outros', label: 'Outros' },
];

const STOP = new Set(['de', 'da', 'do', 'com', 'sem', 'e', 'em', 'tp', 'tipo', 'un', 'und', 'pct', 'pc', 'cx', 'kg', 'g', 'gr', 'ml', 'l', 'lt']);

/** "CAFÉ PILÃO 500G tradicional" -> "cafe pilao tradicional" (sem acento, sem medidas) */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d+[.,]?\d*\s*(kg|g|gr|ml|l|lt|un|m)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
    .join(' ');
}

/** Acha o item do estoque que corresponde ao nome da nota. */
export function matchStockItem(receiptName: string, items: Pick<StockItem, 'id' | 'name' | 'aliases'>[]): string | null {
  const n = normalizeName(receiptName);
  if (!n) return null;
  const words = new Set(n.split(' '));
  // 1) apelido igual
  for (const it of items) if ((it.aliases ?? []).some((a) => normalizeName(a) === n)) return it.id;
  // 2) todas as palavras do nome do item aparecem na nota (item mais específico primeiro)
  const sorted = [...items].sort((a, b) => normalizeName(b.name).split(' ').length - normalizeName(a.name).split(' ').length);
  for (const it of sorted) {
    const iw = normalizeName(it.name).split(' ').filter(Boolean);
    // aceita abreviações da nota: "HIG" = higiênico, "CAFEZINHO" contém "cafe"
    if (iw.length && iw.every((w) => words.has(w) || [...words].some((x) => (x.startsWith(w) && w.length >= 4) || (w.startsWith(x) && x.length >= 3)))) return it.id;
  }
  return null;
}

const DAY = 86400000;

/**
 * Consumo médio por dia.
 * - Ciclos "acabou": o que tinha desde a última vez que zerou ÷ dias até zerar.
 * - Senão, intervalo entre compras: tudo o que foi comprado (menos a última compra) ÷ dias entre a primeira e a última.
 */
export function estimateDailyUsage(movements: Movement[]): number | null {
  const ms = [...movements].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const cycles: number[] = [];
  let cycleStart: number | null = null; let bought = 0;
  for (const m of ms) {
    const t = Date.parse(m.occurred_at);
    if (m.kind === 'compra') {
      if (cycleStart === null) cycleStart = t;
      bought += m.delta;
    } else if (m.kind === 'acabou') {
      if (cycleStart !== null && t - cycleStart >= DAY && bought > 0) cycles.push(bought / ((t - cycleStart) / DAY));
      cycleStart = null; bought = 0;
    }
  }
  if (cycles.length) return cycles.reduce((s, c) => s + c, 0) / cycles.length;
  const buys = ms.filter((m) => m.kind === 'compra');
  if (buys.length >= 2) {
    const days = (Date.parse(buys[buys.length - 1].occurred_at) - Date.parse(buys[0].occurred_at)) / DAY;
    if (days >= 1) return buys.slice(0, -1).reduce((s, b) => s + b.delta, 0) / days;
  }
  return null;
}

/** Quantidade estimada agora (desconta o consumo desde a última atualização). */
export function currentQuantity(item: Pick<StockItem, 'quantity' | 'quantity_updated_at' | 'daily_usage'>, now = new Date()): number {
  const q = Number(item.quantity);
  if (!item.daily_usage) return q;
  const days = (now.getTime() - Date.parse(item.quantity_updated_at)) / DAY;
  return Math.max(0, q - Number(item.daily_usage) * Math.max(0, days));
}

export function daysLeft(item: Pick<StockItem, 'quantity' | 'quantity_updated_at' | 'daily_usage'>, now = new Date()): number | null {
  if (!item.daily_usage || Number(item.daily_usage) <= 0) return Number(item.quantity) <= 0 ? 0 : null;
  return currentQuantity(item, now) / Number(item.daily_usage);
}

export function needsBuying(item: Pick<StockItem, 'quantity' | 'quantity_updated_at' | 'daily_usage' | 'min_days'>, now = new Date()): boolean {
  const d = daysLeft(item, now);
  if (d === null) return Number(item.quantity) <= 0;
  return d <= item.min_days;
}

/** Texto da lista para o WhatsApp. */
export function whatsappText(title: string, urgent: { name: string; quantity?: string | null }[], extra: { name: string; quantity?: string | null }[]): string {
  const line = (i: { name: string; quantity?: string | null }) => `• ${i.name}${i.quantity ? ` (${i.quantity})` : ''}`;
  const parts = [`*${title}*`];
  if (urgent.length) parts.push('', '*Precisa comprar*', ...urgent.map(line));
  if (extra.length) parts.push('', '*Se der*', ...extra.map(line));
  parts.push('', '_Enviado pelo Family BS_');
  return parts.join('\n');
}

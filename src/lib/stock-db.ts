// Gravações do estoque e das notas. Funciona com o cliente do navegador (com as regras de
// segurança da família) e com o cliente do servidor (bot do Telegram).
import type { SupabaseClient } from '@supabase/supabase-js';
import { currentQuantity, estimateDailyUsage, normalizeName, type Movement, type ReceiptItem, type StockItem } from './stock';

export async function applyMovement(
  sb: SupabaseClient,
  item: StockItem,
  delta: number,
  kind: Movement['kind'],
  extra: { unitPrice?: number | null; store?: string | null; receiptId?: string | null; alias?: string | null; createdBy?: string | null } = {},
): Promise<void> {
  const now = new Date();
  const before = currentQuantity(item, now);
  const after = kind === 'acabou' ? 0 : Math.max(0, before + delta);
  await sb.from('stock_movements').insert({
    household_id: item.household_id, item_id: item.id, delta: kind === 'acabou' ? -before : delta, kind,
    unit_price: extra.unitPrice ?? null, store: extra.store ?? null, receipt_id: extra.receiptId ?? null, occurred_at: now.toISOString(),
    ...(extra.createdBy ? { created_by: extra.createdBy } : {}),
  });
  const { data: moves } = await sb.from('stock_movements').select('delta,kind,occurred_at').eq('item_id', item.id).order('occurred_at');
  const usage = estimateDailyUsage((moves as Movement[]) ?? []);
  const aliases = new Set(item.aliases ?? []);
  if (extra.alias && normalizeName(extra.alias) !== normalizeName(item.name)) aliases.add(extra.alias);
  await sb.from('stock_items').update({
    quantity: Math.round(after * 100) / 100,
    quantity_updated_at: now.toISOString(),
    daily_usage: usage ?? item.daily_usage,
    ...(extra.unitPrice ? { last_price: extra.unitPrice } : {}),
    ...(extra.store ? { last_store: extra.store } : {}),
    aliases: Array.from(aliases).slice(-10),
  }).eq('id', item.id);
}

export interface StockPick {
  receiptItem: ReceiptItem;
  itemId?: string | null;                                   // item existente
  create?: { name: string; category: StockItem['category']; unit: string } | null; // ou criar
  qty: number;
}

export interface SaveReceiptInput {
  householdId: string;
  accountId: string;
  categoryId: string | null;
  source: 'nfce' | 'foto' | 'telegram';
  accessKey: string | null;
  store: string | null;
  cnpj: string | null;
  issuedOn: string;
  total: number;
  paymentMethod: string | null;
  installments?: number;
  spentBy: string | null;
  items: ReceiptItem[];
  picks: StockPick[];
  createdBy?: string | null;
}

export async function saveReceipt(sb: SupabaseClient, r: SaveReceiptInput): Promise<{ transactionId: string; receiptId: string; stocked: number }> {
  if (r.accessKey) {
    const { data: dup } = await sb.from('receipts').select('id').eq('household_id', r.householdId).eq('access_key', r.accessKey).maybeSingle();
    if (dup) throw new Error('Essa nota já foi lançada.');
  }
  const { data: rec, error: e1 } = await sb.from('receipts').insert({
    household_id: r.householdId, source: r.source, access_key: r.accessKey, store_name: r.store, store_cnpj: r.cnpj,
    issued_on: r.issuedOn, total: r.total, payment_method: r.paymentMethod, items: r.items,
  }).select('id').single();
  if (e1 || !rec) throw new Error(e1?.message ?? 'não salvou a nota');

  const { data: tx, error: e2 } = await sb.from('transactions').insert({
    household_id: r.householdId, account_id: r.accountId, category_id: r.categoryId, tipo: 'despesa', amount: r.total,
    occurred_on: r.issuedOn, description: r.store ? `Compra · ${r.store}` : 'Compra', payment_method: r.paymentMethod,
    spent_by: r.spentBy, source: 'nota_fiscal', installments: 1, installment_no: 1,
    ...(r.createdBy ? { created_by: r.createdBy } : {}),
  }).select('id').single();
  if (e2 || !tx) throw new Error(e2?.message ?? 'não salvou o lançamento');
  await sb.from('receipts').update({ transaction_id: tx.id }).eq('id', rec.id);

  const prices = r.items.filter((i) => i.unitPrice && i.name).map((i) => ({
    household_id: r.householdId, item_key: normalizeName(i.name) || i.name.toLowerCase(), item_name: i.name,
    store: r.store || 'Loja', unit_price: i.unitPrice, observed_on: r.issuedOn, receipt_id: rec.id,
  }));
  if (prices.length) await sb.from('price_history').insert(prices);

  let stocked = 0;
  for (const p of r.picks) {
    let item: StockItem | null = null;
    if (p.itemId) {
      const { data } = await sb.from('stock_items').select('*').eq('id', p.itemId).single();
      item = data as StockItem;
    } else if (p.create) {
      const { data } = await sb.from('stock_items').upsert({
        household_id: r.householdId, name: p.create.name, category: p.create.category, unit: p.create.unit, quantity: 0,
      }, { onConflict: 'household_id,name' }).select('*').single();
      item = data as StockItem;
    }
    if (!item) continue;
    await applyMovement(sb, item, p.qty, 'compra', { unitPrice: p.receiptItem.unitPrice, store: r.store, receiptId: rec.id, alias: p.receiptItem.name, createdBy: r.createdBy });
    stocked++;
  }
  return { transactionId: tx.id, receiptId: rec.id, stocked };
}

import { NextResponse } from 'next/server';
import { claudeConfigured, interpretMessage, readReceipt } from '@/lib/claude';
import { admin, householdContext } from '@/lib/server';
import { addMonthsToDate, money, splitInstallments, timeLabel, todayISO } from '@/lib/format';
import { matchStockItem, needsBuying, type StockItem } from '@/lib/stock';
import { applyMovement, saveReceipt } from '@/lib/stock-db';
import { parseMessage } from '@/lib/parse-message';
import type { Category } from '@/lib/types';

export const maxDuration = 60;

const TG = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function reply(chatId: number, text: string) {
  await fetch(`${TG()}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface TgMessage { chat: { id: number }; text?: string; caption?: string; photo?: { file_id: string; file_size?: number }[] }

export async function POST(req: Request) {
  if (!process.env.TELEGRAM_BOT_TOKEN || req.headers.get('x-telegram-bot-api-secret-token') !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }
  const update = (await req.json().catch(() => ({}))) as { message?: TgMessage };
  const msg = update.message;
  if (!msg) return NextResponse.json({ ok: true });
  const chatId = msg.chat.id;
  try {
    await handle(msg, chatId);
  } catch (e) {
    await reply(chatId, `Não consegui: ${esc(e instanceof Error ? e.message : String(e))}`);
  }
  return NextResponse.json({ ok: true });
}

async function handle(msg: TgMessage, chatId: number) {
  const sb = admin();
  const text = (msg.text ?? msg.caption ?? '').trim();

  if (text.startsWith('/vincular')) {
    const code = text.split(/\s+/)[1]?.toUpperCase();
    const { data: c } = await sb.from('telegram_codes').select('*').eq('code', code ?? '').gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!c) { await reply(chatId, 'Código inválido ou vencido. Gere outro no app: Ajustes → Telegram.'); return; }
    await sb.from('telegram_links').upsert({ chat_id: chatId, household_id: c.household_id, user_id: c.user_id });
    await sb.from('telegram_codes').delete().eq('code', c.code);
    await reply(chatId, '✅ Conectado ao Family BS!\n\nMande um gasto (“gastei 45 no almoço no pix”), uma foto de cupom ou comprovante, ou use /hoje, /lista, /estoque e /desfazer.');
    return;
  }

  const { data: link } = await sb.from('telegram_links').select('*').eq('chat_id', chatId).maybeSingle();
  if (!link) { await reply(chatId, 'Olá! Para usar, abra o Family BS → Ajustes → Telegram, gere o código e mande aqui: /vincular CÓDIGO'); return; }
  const h = link.household_id as string; const userId = link.user_id as string;
  const ctx = await householdContext(sb, h);
  const today = todayISO();

  if (text === '/start' || text === '/ajuda') {
    await reply(chatId, 'Mande um gasto em texto, uma foto de cupom/comprovante, ou: /hoje (agenda), /lista (compras), /estoque (acabando), /desfazer (apaga o último lançamento feito aqui).');
    return;
  }

  if (text === '/hoje') {
    const start = new Date(`${today}T00:00:00-03:00`).toISOString(); const end = new Date(`${today}T23:59:59-03:00`).toISOString();
    const { data: ev } = await sb.from('events').select('title,starts_at,owner_user').eq('household_id', h).gte('starts_at', start).lte('starts_at', end).order('starts_at');
    const name = (id: string | null) => (id ? ctx.members.find((m) => m.user_id === id)?.display_name.split(' ')[0] : 'Todos');
    await reply(chatId, ev?.length ? `<b>Hoje</b>\n${ev.map((e) => `${timeLabel(e.starts_at)} · ${esc(e.title)} (${name(e.owner_user)})`).join('\n')}` : 'Nada marcado para hoje.');
    return;
  }

  if (text === '/lista') {
    const { data: li } = await sb.from('shopping_items').select('name,quantity,urgent').eq('household_id', h).eq('checked', false).order('urgent', { ascending: false });
    await reply(chatId, li?.length ? `<b>Lista de compras</b>\n${li.map((i) => `${i.urgent ? '❗' : '•'} ${esc(i.name)}${i.quantity ? ` (${esc(i.quantity)})` : ''}`).join('\n')}` : 'A lista está vazia.');
    return;
  }

  if (text === '/estoque') {
    const { data: items } = await sb.from('stock_items').select('*').eq('household_id', h).eq('active', true);
    const low = ((items ?? []) as StockItem[]).filter((i) => needsBuying(i));
    await reply(chatId, low.length ? `<b>Acabando</b>\n${low.map((i) => `• ${esc(i.name)}`).join('\n')}` : 'Nada acabando no estoque.');
    return;
  }

  if (text === '/desfazer') {
    const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const { data: last } = await sb.from('transactions').select('id,description,amount,installment_group').eq('household_id', h).eq('created_by', userId)
      .in('source', ['mensagem', 'nota_fiscal']).gte('created_at', since).order('created_at', { ascending: false }).limit(1);
    if (!last?.length) { await reply(chatId, 'Nada recente para desfazer.'); return; }
    const t = last[0];
    if (t.installment_group) await sb.from('transactions').delete().eq('installment_group', t.installment_group);
    else await sb.from('transactions').delete().eq('id', t.id);
    await reply(chatId, `Apagado: ${esc(t.description ?? '')} (${money(Number(t.amount), true)}).`);
    return;
  }

  // Foto: cupom ou comprovante
  if (msg.photo?.length) {
    if (!claudeConfigured()) { await reply(chatId, 'Para ler fotos é preciso configurar o Claude no app.'); return; }
    const best = msg.photo[msg.photo.length - 1];
    const f = await (await fetch(`${TG()}/getFile?file_id=${best.file_id}`)).json() as { result?: { file_path: string } };
    if (!f.result) throw new Error('não baixei a foto');
    const bin = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.result.file_path}`)).arrayBuffer());
    const r = await readReceipt({ imageBase64: bin.toString('base64'), mediaType: 'image/jpeg' }, ctx.categoriesPF);
    if (!r.total) { await reply(chatId, 'Não achei o valor total nessa foto. Tente uma foto mais nítida ou mande em texto.'); return; }
    const { data: stock } = await sb.from('stock_items').select('*').eq('household_id', h).eq('active', true);
    const items = r.itens.map((i) => ({ name: i.nome, qty: Number(i.quantidade) || 1, unit: i.unidade, unitPrice: i.preco_unitario, total: i.total }));
    const picks = items.map((ri) => ({ receiptItem: ri, itemId: matchStockItem(ri.name, (stock ?? []) as StockItem[]), qty: ri.qty })).filter((p) => p.itemId);
    const cat = ctx.categories.find((c) => c.account_id === ctx.pf?.id && c.name === r.categoria_sugerida && c.tipo === 'despesa');
    const saved = await saveReceipt(sb, {
      householdId: h, accountId: ctx.pf!.id, categoryId: cat?.id ?? null, source: 'telegram', accessKey: null, store: r.loja, cnpj: r.cnpj,
      issuedOn: r.data ?? today, total: r.total, paymentMethod: r.forma_pagamento, spentBy: userId, items, picks, createdBy: userId,
    });
    await reply(chatId, `✅ Lancei ${money(r.total, true)}${r.loja ? ` · ${esc(r.loja)}` : ''}${cat ? ` em ${esc(cat.name)}` : ''}.${saved.stocked ? `\n📦 ${saved.stocked} item(ns) somados ao estoque.` : ''}\n/desfazer para apagar.`);
    return;
  }

  if (!text) return;

  // Texto: lançamento
  let p: { tipo: 'receita' | 'despesa'; conta: 'PF' | 'PJ'; valor: number | null; descricao: string; category_id: string | null; forma: string | null; parcelas: number; data: string; quem: string | null; itens: { nome: string; quantidade: number }[] };
  if (claudeConfigured()) {
    const r = await interpretMessage(text, { today, categoriesPF: ctx.categoriesPF, categoriesPJ: ctx.categoriesPJ, members: ctx.members.map((m) => m.display_name), pjName: ctx.pj?.name ?? 'Empresa' });
    const acc = r.conta === 'PJ' ? ctx.pj : ctx.pf;
    const cat = ctx.categories.find((c) => c.account_id === acc?.id && c.name === r.categoria && c.tipo === r.tipo);
    const who = ctx.members.find((m) => r.quem && m.display_name.toLowerCase().startsWith(r.quem.toLowerCase().split(' ')[0]));
    p = { tipo: r.tipo, conta: r.conta, valor: r.valor, descricao: r.descricao, category_id: cat?.id ?? null, forma: r.forma_pagamento, parcelas: r.parcelas, data: r.data || today, quem: who?.user_id ?? userId, itens: r.itens_estoque };
  } else {
    const r = parseMessage(text, ctx.categories.filter((c) => c.account_id === ctx.pf?.id) as unknown as Category[]);
    p = { tipo: r.tipo, conta: 'PF', valor: r.amount, descricao: r.description, category_id: r.category_id, forma: r.payment_method, parcelas: r.installments, data: today, quem: userId, itens: [] };
  }
  if (!p.valor) { await reply(chatId, 'Não entendi o valor. Ex.: “gastei 87,50 no mercado no crédito em 3x”.'); return; }
  const acc = p.conta === 'PJ' ? ctx.pj : ctx.pf;
  const n = p.tipo === 'despesa' && p.forma === 'credito' ? p.parcelas : 1;
  const parts = splitInstallments(p.valor, n);
  const group = n > 1 ? crypto.randomUUID() : null;
  const { error } = await sb.from('transactions').insert(parts.map((v, i) => ({
    household_id: h, account_id: acc!.id, category_id: p.category_id, tipo: p.tipo, amount: v, occurred_on: addMonthsToDate(p.data, i),
    description: p.descricao, payment_method: p.forma, installments: n, installment_no: i + 1, installment_group: group,
    spent_by: p.conta === 'PF' ? p.quem : null, source: 'mensagem', created_by: userId,
  })));
  if (error) throw new Error(error.message);
  let stocked = 0;
  if (p.itens.length) {
    const { data: stock } = await sb.from('stock_items').select('*').eq('household_id', h).eq('active', true);
    for (const it of p.itens) {
      const id = matchStockItem(it.nome, (stock ?? []) as StockItem[]);
      const item = (stock ?? []).find((s) => s.id === id) as StockItem | undefined;
      if (item) { await applyMovement(sb, item, Number(it.quantidade) || 1, 'compra', { createdBy: userId }); stocked++; }
    }
  }
  const catName = ctx.categories.find((c) => c.id === p.category_id)?.name;
  await reply(chatId, `✅ ${p.tipo === 'receita' ? 'Entrada' : 'Gasto'} de ${money(p.valor, true)}${n > 1 ? ` em ${n}x` : ''}${catName ? ` · ${esc(catName)}` : ' · sem categoria'} (${p.conta === 'PJ' ? esc(ctx.pj?.name ?? 'PJ') : 'Família'}).${stocked ? `\n📦 ${stocked} item(ns) somados ao estoque.` : ''}\n/desfazer para apagar.`);
}

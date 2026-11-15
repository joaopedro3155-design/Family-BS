import { NextResponse } from 'next/server';
import { admin, pushToHousehold } from '@/lib/server';
import { dueEventReminders, reminderText } from '@/lib/reminders';
import { nextDue, daysBetween } from '@/lib/recurring';
import { monthKey, monthRange, timeLabel, todayISO } from '@/lib/format';
import type { EventItem, RecurringBill } from '@/lib/types';
import { needsBuying, type StockItem } from '@/lib/stock';

// Chamado a cada 5 minutos pelo agendador do Supabase (supabase/cron.sql)
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }
  const sb = admin();
  const now = new Date();
  const today = todayISO(now);
  const hourSP = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(now));
  const report = { eventos: 0, contas: 0, limites: 0, resumos: 0 };

  // 1) Compromissos das próximas 48 h
  const horizon = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
  const { data: events } = await sb.from('events').select('id,household_id,title,starts_at,reminders,owner_user,location').gte('starts_at', now.toISOString()).lte('starts_at', horizon);
  const ids = (events ?? []).map((e) => e.id);
  const { data: sentRows } = ids.length ? await sb.from('event_notifications').select('event_id,minutes_before').in('event_id', ids) : { data: [] };
  const sent = new Set((sentRows ?? []).map((r) => `${r.event_id}:${r.minutes_before}`));
  for (const r of dueEventReminders((events ?? []) as EventItem[], sent, now)) {
    const e = (events ?? []).find((x) => x.id === r.eventId)!;
    const { error } = await sb.from('event_notifications').insert({ event_id: e.id, minutes_before: r.minutes });
    if (error) continue; // outro disparo já enviou
    await pushToHousehold(sb, e.household_id, {
      title: e.title,
      body: `${reminderText(r.minutes)} · ${timeLabel(e.starts_at)}${e.location ? ` · ${e.location}` : ''}`,
      url: '/agenda', tag: `ev-${e.id}`,
    }, e.owner_user ? [e.owner_user] : undefined);
    report.eventos++;
  }

  // 2) Contas recorrentes e 3) limites: uma vez por dia, a partir das 8h
  if (hourSP >= 8) {
    const { data: bills } = await sb.from('recurring_bills').select('*').eq('active', true).eq('tipo', 'despesa');
    for (const b of (bills ?? []) as (RecurringBill & { last_notified_on: string | null })[]) {
      if (b.last_notified_on === today) continue;
      const due = nextDue(b, today);
      if (!due) continue;
      const d = daysBetween(today, due);
      if (d !== b.remind_days_before && d !== 0) continue;
      await sb.from('recurring_bills').update({ last_notified_on: today }).eq('id', b.id);
      await pushToHousehold(sb, b.household_id, {
        title: d === 0 ? `${b.name} vence hoje` : `${b.name} vence em ${d} dia${d > 1 ? 's' : ''}`,
        body: b.variable ? 'Valor variável: confira a fatura.' : 'Toque para lançar o pagamento.',
        url: '/financas/recorrentes', tag: `bill-${b.id}`,
      });
      report.contas++;
    }

    const { start, end } = monthRange(monthKey(now));
    const { data: cats } = await sb.from('categories').select('id,household_id,name,monthly_limit').not('monthly_limit', 'is', null).eq('archived', false);
    for (const c of cats ?? []) {
      const { data: txs } = await sb.from('transactions').select('amount').eq('category_id', c.id).eq('tipo', 'despesa').gte('occurred_on', start).lt('occurred_on', end);
      const used = (txs ?? []).reduce((s, t) => s + Number(t.amount), 0);
      const pct = (used / Number(c.monthly_limit)) * 100;
      const threshold = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
      if (!threshold) continue;
      const { error } = await sb.from('limit_alerts').insert({ category_id: c.id, month: start, threshold });
      if (error) continue; // já avisado
      await pushToHousehold(sb, c.household_id, {
        title: threshold === 100 ? `${c.name}: limite do mês atingido` : `${c.name}: 80% do limite`,
        body: `Já foram ${Math.round(pct)}% do limite deste mês.`,
        url: '/financas', tag: `lim-${c.id}`,
      });
      report.limites++;
    }
  }

  // 4) Resumo do dia às 7h: agenda, contas e estoque
  if (hourSP >= 7) {
    const { data: hs } = await sb.from('households').select('id,last_digest_on');
    for (const h of hs ?? []) {
      if (h.last_digest_on === today) continue;
      await sb.from('households').update({ last_digest_on: today }).eq('id', h.id);
      const dayStart = new Date(`${today}T00:00:00-03:00`).toISOString();
      const dayEnd = new Date(`${today}T23:59:59-03:00`).toISOString();
      const [{ data: ev }, { data: bl }, { data: st }] = await Promise.all([
        sb.from('events').select('title,starts_at').eq('household_id', h.id).gte('starts_at', dayStart).lte('starts_at', dayEnd).order('starts_at'),
        sb.from('recurring_bills').select('name,due_day,due_month,frequency').eq('household_id', h.id).eq('active', true).eq('tipo', 'despesa'),
        sb.from('stock_items').select('*').eq('household_id', h.id).eq('active', true),
      ]);
      const bills = (bl ?? []).filter((b) => { const d = nextDue(b as RecurringBill, today); return d !== null && daysBetween(today, d) <= 1; });
      const low = ((st ?? []) as StockItem[]).filter((i) => needsBuying(i));
      const parts: string[] = [];
      if (ev?.length) parts.push(`${ev.length} compromisso(s): ${ev.slice(0, 3).map((e) => `${timeLabel(e.starts_at)} ${e.title}`).join(', ')}`);
      if (bills.length) parts.push(`Contas: ${bills.map((b) => b.name).join(', ')}`);
      if (low.length) parts.push(`Acabando: ${low.slice(0, 4).map((i) => i.name).join(', ')}`);
      if (!parts.length) continue;
      await pushToHousehold(sb, h.id, { title: 'Bom dia! Seu dia no Family BS', body: parts.join(' · '), url: '/', tag: `digest-${today}` });
      report.resumos++;
    }
  }

  return NextResponse.json({ ok: true, ...report });
}

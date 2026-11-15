'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { EyeButton, Money, PageHeader, Bar, Empty, LocationLink } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { dayLabel, monthKey, monthRange, timeLabel, todayISO } from '@/lib/format';
import { daysBetween, nextDue } from '@/lib/recurring';
import type { EventItem, RecurringBill, Transaction } from '@/lib/types';

export default function Hoje() {
  const { householdId, me, members, memberName, accounts, categories } = useApp();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const today = todayISO();
  const pf = accounts.find((a) => a.kind === 'PF');

  useEffect(() => {
    if (!householdId) return;
    const sb = supabase();
    const start = new Date(`${today}T00:00:00`).toISOString();
    const end = new Date(`${today}T23:59:59`).toISOString();
    const { start: ms, end: me2 } = monthRange(monthKey());
    Promise.all([
      sb.from('events').select('*').eq('household_id', householdId).gte('starts_at', start).lte('starts_at', end).order('starts_at'),
      sb.from('recurring_bills').select('*').eq('household_id', householdId).eq('active', true),
      sb.from('transactions').select('*').eq('household_id', householdId).gte('occurred_on', ms).lt('occurred_on', me2),
    ]).then(([e, b, t]) => {
      setEvents((e.data as EventItem[]) ?? []);
      setBills((b.data as RecurringBill[]) ?? []);
      setTxs((t.data as Transaction[]) ?? []);
    });
  }, [householdId, today]);

  const dueSoon = bills
    .map((b) => ({ b, due: nextDue(b, today) }))
    .filter((x) => x.due && daysBetween(today, x.due) <= Math.max(3, x.b.remind_days_before) && x.b.tipo === 'despesa')
    .sort((a, b) => (a.due! < b.due! ? -1 : 1));

  const pfTx = txs.filter((t) => t.account_id === pf?.id && !t.is_profit_transfer);
  const spent = pfTx.filter((t) => t.tipo === 'despesa').reduce((s, t) => s + Number(t.amount), 0);
  const income = pfTx.filter((t) => t.tipo === 'receita').reduce((s, t) => s + Number(t.amount), 0);

  const limitAlerts = categories
    .filter((c) => c.monthly_limit && c.account_id === pf?.id)
    .map((c) => {
      const used = pfTx.filter((t) => t.category_id === c.id && t.tipo === 'despesa').reduce((s, t) => s + Number(t.amount), 0);
      return { c, used, pct: (used / Number(c.monthly_limit)) * 100 };
    })
    .filter((x) => x.pct >= 80)
    .sort((a, b) => b.pct - a.pct);

  const hour = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()));
  const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <>
      <PageHeader title={`${hello}, ${me?.display_name.split(' ')[0] ?? ''}`} subtitle={dayLabel(today)}>
        <EyeButton />
      </PageHeader>

      <div className="card dark stack">
        <div className="row between">
          <span className="small strong muted">Resumo do dia da família</span>
          <div className="row">{members.map((m, i) => <span key={m.user_id} className="avatar" style={{ background: m.color, marginLeft: i ? -8 : 0, border: '2px solid #23201C' }}>{m.display_name[0]}</span>)}</div>
        </div>
        <div className="grid3">
          <div className="stack" style={{ gap: 2 }}><span className="mid">{events.length}</span><span className="small muted">compromissos</span></div>
          <div className="stack" style={{ gap: 2 }}><span className="mid">{dueSoon.length}</span><span className="small muted">contas a vencer</span></div>
          <div className="stack" style={{ gap: 2 }}><span className="mid">{limitAlerts.length}</span><span className="small muted">limites no alerta</span></div>
        </div>
      </div>

      <div className="cols">
        <section className="stack">
          <div className="row between"><h2>Agenda de hoje</h2><Link href="/agenda" className="small strong">Ver semana</Link></div>
          <div className="list">
            {events.length === 0 && <Empty>Nada marcado para hoje.</Empty>}
            {events.map((e) => (
              <div key={e.id} className="list-item">
                <span className="strong small" style={{ width: 44 }}>{timeLabel(e.starts_at)}</span>
                <div className="grow"><span className="strong">{e.title}</span>{e.location && <LocationLink location={e.location} />}</div>
                <span className={e.owner_user ? (members[0]?.user_id === e.owner_user ? 'pill blue' : 'pill orange') : 'pill'}>{memberName(e.owner_user)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="stack">
          <h2>Alertas</h2>
          <div className="list">
            {dueSoon.length === 0 && limitAlerts.length === 0 && <Empty>Nenhum alerta agora.</Empty>}
            {dueSoon.map(({ b, due }) => {
              const d = daysBetween(today, due!);
              return (
                <Link key={b.id} href="/financas/recorrentes" className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="grow"><span className="strong">{b.name} {d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : `vence em ${d} dias`}</span><span className="small muted"><Money v={b.amount} />{b.variable ? ' · valor variável' : ''}</span></div>
                </Link>
              );
            })}
            {limitAlerts.map(({ c, used, pct }) => (
              <div key={c.id} className="list-item">
                <div className="grow">
                  <span className="strong">{c.name}: {Math.round(pct)}% do limite</span>
                  <span className="small muted"><Money v={used} /> de <Money v={c.monthly_limit} /></span>
                  <Bar pct={pct} />
                </div>
              </div>
            ))}
          </div>

          <Link href="/financas" className="card stack" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="small strong muted">Família (PF) · este mês</span>
            <div className="row between"><span>Gasto</span><span className="strong"><Money v={spent} /></span></div>
            <div className="row between"><span>Entradas</span><span className="strong"><Money v={income} /></span></div>
          </Link>
        </section>
      </div>
    </>
  );
}

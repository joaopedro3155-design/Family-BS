'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Bar, Chips, Empty, EyeButton, Money, PageHeader, Segmented } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { addMonths, monthKey, monthLabel, monthRange, todayISO } from '@/lib/format';
import type { Kind, Transaction } from '@/lib/types';

const inMonth = (t: Transaction, key: string) => t.occurred_on.startsWith(key);

export default function Financas() {
  const { householdId, accounts, categories, members, memberName } = useApp();
  const [kind, setKind] = useState<Kind>('PF');
  const [who, setWho] = useState('all');
  const [month, setMonth] = useState(monthKey());
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState(false);
  const account = accounts.find((a) => a.kind === kind);
  const pfAccount = accounts.find((a) => a.kind === 'PF');
  const pjAccount = accounts.find((a) => a.kind === 'PJ');

  const [rev, setRev] = useState(0);
  const load = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!householdId || !account) return;
    let alive = true;
    const from = monthRange(addMonths(month, -6)).start;
    const to = monthRange(month).end;
    supabase().from('transactions').select('*').eq('household_id', householdId).eq('account_id', account.id)
      .gte('occurred_on', from).lt('occurred_on', to).order('occurred_on', { ascending: false }).limit(5000)
      .then(({ data }) => { if (alive) setTxs((data as Transaction[]) ?? []); });
    return () => { alive = false; };
  }, [householdId, account, month, rev]);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const filtered = useMemo(() => txs.filter((t) => kind === 'PJ' || who === 'all' || t.spent_by === who), [txs, kind, who]);
  const cur = useMemo(() => filtered.filter((t) => inMonth(t, month)), [filtered, month]);
  const sum = (list: Transaction[], tipo: 'receita' | 'despesa', excludeTransfer = true) =>
    list.filter((t) => t.tipo === tipo && !(excludeTransfer && t.is_profit_transfer)).reduce((s, t) => s + Number(t.amount), 0);

  const despesas = sum(cur, 'despesa');
  const receitas = sum(cur, 'receita');
  const prevMonths = [1, 2, 3, 4, 5, 6].map((i) => addMonths(month, -i));
  const monthsWithData = prevMonths.filter((m) => filtered.some((t) => inMonth(t, m)));
  const avgDesp = monthsWithData.length ? monthsWithData.reduce((s, m) => s + sum(filtered.filter((t) => inMonth(t, m)), 'despesa'), 0) / monthsWithData.length : null;
  const transferred = sum(cur, 'despesa', false) - despesas;
  const lucro = receitas - despesas;

  const limits = categories.filter((c) => c.account_id === account?.id && c.monthly_limit && !c.archived).map((c) => {
    const used = cur.filter((t) => t.category_id === c.id && t.tipo === 'despesa').reduce((s, t) => s + Number(t.amount), 0);
    return { c, used, pct: (used / Number(c.monthly_limit)) * 100 };
  }).sort((a, b) => b.pct - a.pct);

  // vazamentos: média dos 3 meses anteriores vs os 3 antes deles
  const leaks = useMemo(() => {
    const recent = [1, 2, 3].map((i) => addMonths(month, -i));
    const older = [4, 5, 6].map((i) => addMonths(month, -i));
    const byCat = new Map<string, { r: number; o: number }>();
    for (const t of filtered) {
      if (t.tipo !== 'despesa' || !t.category_id || t.is_profit_transfer) continue;
      const k = t.occurred_on.slice(0, 7);
      const e = byCat.get(t.category_id) ?? { r: 0, o: 0 };
      if (recent.includes(k)) e.r += Number(t.amount);
      else if (older.includes(k)) e.o += Number(t.amount);
      byCat.set(t.category_id, e);
    }
    return Array.from(byCat.entries())
      .map(([id, e]) => ({ name: catById.get(id)?.name ?? '—', r: e.r / 3, o: e.o / 3 }))
      .filter((x) => x.o > 0 && x.r >= x.o * 1.3 && x.r - x.o >= 50)
      .sort((a, b) => b.r - b.o - (a.r - a.o))
      .slice(0, 5);
  }, [filtered, month, catById]);

  const groups = useMemo(() => {
    const g = new Map<string, number>();
    for (const t of cur) {
      if (t.tipo !== 'despesa' || t.is_profit_transfer) continue;
      const name = t.category_id ? catById.get(t.category_id)?.grupo ?? 'Outros' : 'Sem categoria';
      g.set(name, (g.get(name) ?? 0) + Number(t.amount));
    }
    return Array.from(g.entries()).sort((a, b) => b[1] - a[1]);
  }, [cur, catById]);
  const maxGroup = groups[0]?.[1] ?? 1;

  async function transferProfit() {
    if (!householdId || !pfAccount || !pjAccount || lucro <= 0) return;
    if (!confirm('Registrar a transferência do lucro deste mês para a conta da família?')) return;
    setBusy(true);
    const sb = supabase();
    const dist = categories.find((c) => c.account_id === pjAccount.id && c.name === 'Distribuição de lucro');
    const rec = categories.find((c) => c.account_id === pfAccount.id && c.tipo === 'receita' && c.name.startsWith('Lucro'));
    const occurred = month === monthKey() ? todayISO() : monthRange(month).start;
    const amount = Math.round(lucro * 100) / 100;
    await sb.from('transactions').insert([
      { household_id: householdId, account_id: pjAccount.id, category_id: dist?.id ?? null, tipo: 'despesa', amount, occurred_on: occurred, description: 'Lucro transferido para a família', payment_method: 'transferencia', is_profit_transfer: true, source: 'manual' },
      { household_id: householdId, account_id: pfAccount.id, category_id: rec?.id ?? null, tipo: 'receita', amount, occurred_on: occurred, description: `Lucro ${pjAccount.name}`, payment_method: 'transferencia', source: 'manual' },
    ]);
    setBusy(false);
    load();
  }

  async function remove(t: Transaction) {
    const msg = t.installment_group ? 'Apagar este lançamento e todas as parcelas?' : 'Apagar este lançamento?';
    if (!confirm(msg)) return;
    const sb = supabase();
    if (t.installment_group) await sb.from('transactions').delete().eq('installment_group', t.installment_group);
    else await sb.from('transactions').delete().eq('id', t.id);
    load();
  }

  return (
    <>
      <PageHeader title="Finanças">
        <EyeButton />
        <Link href="/financas/categorias" className="icon-btn" aria-label="Categorias e limites"><Icon name="gear" /></Link>
      </PageHeader>

      <Segmented value={kind} onChange={(k) => { setKind(k); setWho('all'); }} options={[{ id: 'PF', label: 'Família (PF)' }, { id: 'PJ', label: pjAccount?.name ? `${pjAccount.name} (PJ)` : 'Empresa (PJ)' }]} />
      {kind === 'PF' && <Chips value={who} onChange={setWho} options={[{ id: 'all', label: 'Todos' }, ...members.map((m) => ({ id: m.user_id, label: m.display_name.split(' ')[0] }))]} />}

      <div className="row between">
        <button className="link-btn" onClick={() => setMonth(addMonths(month, -1))}>‹ anterior</button>
        <span className="strong">{monthLabel(month)}</span>
        <button className="link-btn" onClick={() => setMonth(addMonths(month, 1))}>próximo ›</button>
      </div>

      <div className="cols">
        <div className="stack">
          <div className="card stack">
            <div className="row between" style={{ alignItems: 'flex-end' }}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="small strong muted">{kind === 'PF' ? 'Gasto da família' : 'Despesas da empresa'}</span>
                <span className="big"><Money v={despesas} /></span>
              </div>
              {avgDesp !== null && <span className="small muted">média 6 meses <Money v={avgDesp} /></span>}
            </div>
            {avgDesp ? <Bar pct={(despesas / avgDesp) * 100} warnAt={100} /> : null}
            <div className="row between small">
              <span>{kind === 'PF' ? 'Entradas' : 'Faturamento'}: <strong><Money v={receitas} /></strong></span>
              <span>{kind === 'PF' ? 'Saldo' : 'Lucro'}: <strong className={lucro < 0 ? 'orange' : ''}><Money v={lucro} /></strong></span>
            </div>
          </div>

          {kind === 'PJ' && (
            <div className="card dark stack">
              <span className="strong">Lucro → conta da família</span>
              {transferred > 0 ? (
                <span className="small muted">Já transferido este mês: <Money v={transferred} /></span>
              ) : (
                <span className="small muted">O lucro entra na família como receita, sem contar duas vezes.</span>
              )}
              <button className="btn primary" disabled={busy || lucro <= 0 || transferred > 0} onClick={transferProfit}>Transferir lucro do mês</button>
            </div>
          )}

          <section className="stack">
            <div className="row between"><h2>Limites do mês</h2><Link href="/financas/categorias" className="small strong">Editar</Link></div>
            <div className="card stack">
              {limits.length === 0 && <span className="muted small">Defina limites nas categorias (ex.: Restaurantes R$ 600) para receber alertas.</span>}
              {limits.map(({ c, used, pct }) => (
                <div key={c.id} className="stack" style={{ gap: 4 }}>
                  <div className="row between small"><span className="strong">{c.name}</span><span className={pct >= 90 ? 'orange strong' : 'muted'}><Money v={used} /> / <Money v={c.monthly_limit} /> · {Math.round(pct)}%</span></div>
                  <Bar pct={pct} />
                </div>
              ))}
            </div>
          </section>

          <section className="card dark stack">
            <span className="strong">Possíveis vazamentos</span>
            {leaks.length === 0 && <span className="small muted">Nenhum aumento fora do normal nos últimos 3 meses.</span>}
            {leaks.map((l) => (
              <span key={l.name} className="small">• {l.name}: <Money v={l.o} />/mês → <Money v={l.r} />/mês</span>
            ))}
          </section>

          <Link href="/financas/recorrentes" className="card row gap12" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span className="icon-btn" style={{ border: 'none', background: 'var(--teal-soft)', color: 'var(--teal)' }}><Icon name="repeat" /></span>
            <div className="grow"><span className="strong">Contas recorrentes</span><span className="small muted">Aluguel, carro, plano de saúde, contador…</span></div>
          </Link>
        </div>

        <div className="stack">
          <section className="stack">
            <h2>Por grupo</h2>
            <div className="card stack">
              {groups.length === 0 && <span className="muted small">Sem despesas neste mês.</span>}
              {groups.map(([g, v]) => (
                <div key={g} className="stack" style={{ gap: 4 }}>
                  <div className="row between small"><span className="strong">{g}</span><span className="muted"><Money v={v} /></span></div>
                  <Bar pct={(v / maxGroup) * 100} warnAt={Infinity} />
                </div>
              ))}
            </div>
          </section>

          <section className="stack">
            <h2>Lançamentos</h2>
            <div className="list">
              {cur.length === 0 && <Empty>Nenhum lançamento neste mês.</Empty>}
              {cur.slice(0, 80).map((t) => (
                <div key={t.id} className="list-item">
                  <div className="grow">
                    <span className="strong">{t.description || catById.get(t.category_id ?? '')?.name || 'Sem descrição'}</span>
                    <span className="small muted">
                      {t.occurred_on.split('-').reverse().slice(0, 2).join('/')} · {catById.get(t.category_id ?? '')?.name ?? 'Sem categoria'}
                      {t.installments > 1 ? ` · ${t.installment_no}/${t.installments}` : ''}
                      {kind === 'PF' && t.spent_by ? ` · ${memberName(t.spent_by)}` : ''}
                    </span>
                  </div>
                  <span className={t.tipo === 'receita' ? 'strong ok' : 'strong'}>{t.tipo === 'receita' ? '+' : ''}<Money v={Number(t.amount)} /></span>
                  <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label="Apagar lançamento" onClick={() => remove(t)}><Icon name="trash" size={16} /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

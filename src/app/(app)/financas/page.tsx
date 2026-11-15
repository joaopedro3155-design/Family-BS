'use client';
import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Bar, Chips, Empty, EyeButton, Money, PageHeader, Segmented } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { addMonths, monthKey, monthLabel, monthRange, todayISO } from '@/lib/format';
import type { Category, Kind, Transaction } from '@/lib/types';

// Mesma ordem da planilha
const GROUP_ORDER = ['Receitas', 'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Filha', 'Lazer', 'Cuidados Pessoais', 'Vestuário', 'Animal Estimação', 'Despesas Bancárias', 'Gratidão', 'Investimento', 'Despesas gerais', 'Outros'];
const groupRank = (g: string) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? 90 : i; };
const PALETTE = ['#E8590C', '#57524C', '#F59F00', '#9C6644', '#FD7E14', '#A8A29E', '#C2470A', '#D6B48C', '#7A2E05', '#FFA94D', '#3F3A35', '#E8B07A', '#B05A2E', '#8F857B', '#FFC078', '#5C4033'];
type View = 'resumo' | 'planilha' | 'lancamentos';

const inMonth = (t: Transaction, key: string) => t.occurred_on.startsWith(key);

export default function Financas() {
  const { householdId, accounts, categories, members, memberName } = useApp();
  const [kind, setKind] = useState<Kind>('PF');
  const [who, setWho] = useState('all');
  const [month, setMonth] = useState(monthKey());
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('resumo');
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
  const itemsOf = (g: string) => {
    const m = new Map<string, number>();
    for (const t of cur) {
      if (t.tipo !== 'despesa' || t.is_profit_transfer) continue;
      const c = t.category_id ? catById.get(t.category_id) : undefined;
      if ((c?.grupo ?? (t.category_id ? 'Outros' : 'Sem categoria')) !== g) continue;
      const n = c?.name ?? 'Sem categoria';
      m.set(n, (m.get(n) ?? 0) + Number(t.amount));
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  };

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

      <div className="fin-actions">
        <Link href="/lancar" className="fin-action primary"><Icon name="plus" /><span>Lançar</span></Link>
        <Link href="/financas/recorrentes" className="fin-action"><Icon name="repeat" /><span>Recorrentes</span></Link>
        <Link href="/financas/categorias" className="fin-action"><Icon name="edit" /><span>Categorias</span></Link>
      </div>

      <Segmented value={kind} onChange={(k) => { setKind(k); setWho('all'); }} options={[{ id: 'PF', label: 'Família (PF)' }, { id: 'PJ', label: pjAccount?.name ? `${pjAccount.name} (PJ)` : 'Empresa (PJ)' }]} />
      {kind === 'PF' && <Chips value={who} onChange={setWho} options={[{ id: 'all', label: 'Todos' }, ...members.map((m) => ({ id: m.user_id, label: m.display_name.split(' ')[0] }))]} />}

      <div className="row between">
        <button className="link-btn" onClick={() => setMonth(addMonths(month, -1))}>‹ anterior</button>
        <span className="strong">{monthLabel(month)}</span>
        <button className="link-btn" onClick={() => setMonth(addMonths(month, 1))}>próximo ›</button>
      </div>

      <Segmented value={view} onChange={setView} options={[{ id: 'resumo', label: 'Resumo' }, { id: 'planilha', label: 'Planilha' }, { id: 'lancamentos', label: 'Lançamentos' }]} />

      {view === 'resumo' && (
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
          </div>

          <div className="stack">
            <LeakPanel groups={groups} total={despesas} itemsOf={itemsOf} leaks={leaks} />
          </div>
        </div>
      )}

      {view === 'planilha' && account && (
        <Planilha month={month} txs={filtered} categories={categories.filter((c) => c.account_id === account.id)} accountId={account.id} />
      )}

      {view === 'lancamentos' && (
        <section className="stack">
          <div className="list">
            {cur.length === 0 && <Empty>Nenhum lançamento neste mês.</Empty>}
            {cur.slice(0, 150).map((t) => (
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
      )}
    </>
  );
}

function Donut({ parts, size = 200 }: { parts: { label: string; v: number; color: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + p.v, 0);
  const r = 70, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="Gastos por categoria">
      <circle cx="100" cy="100" r={r} fill="none" stroke="var(--line2)" strokeWidth="34" />
      {total > 0 && parts.map((p) => {
        const len = (p.v / total) * c;
        const el = <circle key={p.label} cx="100" cy="100" r={r} fill="none" stroke={p.color} strokeWidth="34" strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 100 100)" />;
        acc += len;
        return el;
      })}
    </svg>
  );
}

function LeakPanel({ groups, total, itemsOf, leaks }: { groups: [string, number][]; total: number; itemsOf: (g: string) => [string, number][]; leaks: { name: string; r: number; o: number }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const parts = groups.map(([g, v], i) => ({ label: g, v, color: PALETTE[i % PALETTE.length] }));
  return (
    <section className="stack">
      <h2>Vazamento de gastos</h2>
      <div className="card stack" style={{ alignItems: 'center' }}>
        {groups.length === 0 ? <span className="muted small">Sem despesas neste mês.</span> : (
          <>
            <div style={{ position: 'relative', width: 200, height: 200 }}>
              <Donut parts={parts} />
              <div className="donut-center"><span className="small muted">Total</span><span className="strong"><Money v={total} /></span></div>
            </div>
            <div className="list" style={{ width: '100%', border: 'none' }}>
              {parts.map((p) => (
                <div key={p.label}>
                  <button className="list-item leak-row" onClick={() => setOpen(open === p.label ? null : p.label)} aria-expanded={open === p.label}>
                    <span className="dot" style={{ background: p.color }} />
                    <span className="grow strong">{p.label}</span>
                    <span className="small muted">{total ? Math.round((p.v / total) * 100) : 0}%</span>
                    <span className="strong"><Money v={p.v} /></span>
                  </button>
                  {open === p.label && (
                    <div className="leak-items">
                      {itemsOf(p.label).map(([n, v]) => (
                        <div key={n} className="row between small"><span>{n}</span><span><Money v={v} /></span></div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="card dark stack">
        <span className="strong">Gastos que subiram</span>
        {leaks.length === 0 && <span className="small muted">Nenhum aumento fora do normal nos últimos 3 meses.</span>}
        {leaks.map((l) => (
          <span key={l.name} className="small">• {l.name}: <Money v={l.o} />/mês → <Money v={l.r} />/mês</span>
        ))}
        <span className="small muted">Compara a média dos últimos 3 meses com os 3 anteriores.</span>
      </div>
    </section>
  );
}

function Planilha({ month, txs, categories, accountId }: { month: string; txs: Transaction[]; categories: Category[]; accountId: string }) {
  const { householdId, reloadCategories } = useApp();
  const months = [addMonths(month, -2), addMonths(month, -1), month];
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const val = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) {
      if (t.is_profit_transfer && t.tipo === 'despesa') continue;
      const k = `${t.category_id ?? 'none'}|${t.tipo}|${t.occurred_on.slice(0, 7)}`;
      m.set(k, (m.get(k) ?? 0) + Number(t.amount));
    }
    return m;
  }, [txs]);
  const cell = (catId: string, tipo: string, mo: string) => val.get(`${catId}|${tipo}|${mo}`) ?? 0;

  const sections = useMemo(() => {
    const byGroup = new Map<string, Category[]>();
    for (const c of categories) {
      const used = months.some((mo) => cell(c.id, c.tipo, mo) > 0);
      if (c.archived && !used) continue;
      const g = c.tipo === 'receita' ? 'Receitas' : c.grupo || 'Outros';
      byGroup.set(g, [...(byGroup.get(g) ?? []), c]);
    }
    return Array.from(byGroup.entries())
      .sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([g, cats]) => ({ g, tipo: g === 'Receitas' ? 'receita' : 'despesa', cats: cats.sort((a, b) => a.name.localeCompare(b.name)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, val, month]);

  const totalOf = (tipo: string, mo: string) => {
    let s = 0;
    for (const [k, v] of val) { const [, tp, m] = k.split('|'); if (tp === tipo && m === mo) s += v; }
    return s;
  };
  const uncategorized = months.map((mo) => cell('none', 'despesa', mo));

  async function addCategory(grupo: string, tipo: string) {
    const n = name.trim();
    const g = (grupo || newGroup).trim();
    if (!n || !g) { setErr('Digite o nome.'); return; }
    if (categories.some((c) => c.name.toLowerCase() === n.toLowerCase() && (c.grupo === g || tipo === 'receita'))) { setErr('Essa categoria já existe.'); return; }
    const { error } = await supabase().from('categories').insert({ household_id: householdId, account_id: accountId, name: n, grupo: tipo === 'receita' ? 'Receitas' : g, tipo, monthly_limit: null, archived: false });
    if (error) { setErr(error.message); return; }
    setName(''); setNewGroup(''); setAdding(null); setErr(null);
    await reloadCategories();
  }

  const addRow = (g: string, tipo: string) => adding === g ? (
    <tr className="add-row"><td colSpan={4}>
      <form className="row gap8" onSubmit={(e) => { e.preventDefault(); addCategory(g, tipo); }}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Nova categoria em ${g}`} />
        <button className="btn small primary" type="submit">Salvar</button>
        <button className="link-btn" type="button" onClick={() => { setAdding(null); setErr(null); }}>Cancelar</button>
      </form>
      {err && <span className="error small">{err}</span>}
    </td></tr>
  ) : (
    <tr className="add-row"><td colSpan={4}><button className="link-btn small" onClick={() => { setAdding(g); setName(''); setErr(null); }}>+ categoria</button></td></tr>
  );

  const mLabel = (mo: string) => monthLabel(mo).split(' ')[0].slice(0, 3);
  return (
    <section className="stack">
      <div className="sheet-wrap">
        <table className="xls">
          <thead><tr><th>Categoria</th>{months.map((mo) => <th key={mo} className={mo === month ? 'cur' : ''}>{mLabel(mo)}</th>)}</tr></thead>
          <tbody>
            {sections.map((sec) => (
              <Fragment key={sec.g}>
                <tr className="grp"><td>{sec.g}</td>{months.map((mo) => <td key={mo} className={mo === month ? 'cur' : ''}><Money v={sec.cats.reduce((s, c) => s + cell(c.id, c.tipo, mo), 0)} /></td>)}</tr>
                {sec.cats.map((c) => (
                  <tr key={c.id}><td className="cat">{c.name}{c.monthly_limit ? <span className="lim"> · limite <Money v={c.monthly_limit} /></span> : null}</td>{months.map((mo) => { const v = cell(c.id, c.tipo, mo); return <td key={mo} className={`${mo === month ? 'cur ' : ''}${v ? '' : 'zero'}${c.monthly_limit && mo === month && v > Number(c.monthly_limit) ? ' over' : ''}`}>{v ? <Money v={v} /> : '–'}</td>; })}</tr>
                ))}
                {addRow(sec.g, sec.tipo)}
              </Fragment>
            ))}
            {uncategorized.some((v) => v > 0) && (
              <tr><td className="cat muted">Sem categoria</td>{uncategorized.map((v, i) => <td key={i} className={months[i] === month ? 'cur' : ''}>{v ? <Money v={v} /> : '–'}</td>)}</tr>
            )}
            <tr className="tot"><td>Total receitas</td>{months.map((mo) => <td key={mo}><Money v={totalOf('receita', mo)} /></td>)}</tr>
            <tr className="tot"><td>Total despesas</td>{months.map((mo) => <td key={mo}><Money v={totalOf('despesa', mo)} /></td>)}</tr>
            <tr className="tot saldo"><td>Saldo</td>{months.map((mo) => { const v = totalOf('receita', mo) - totalOf('despesa', mo); return <td key={mo} className={v < 0 ? 'orange' : 'ok'}><Money v={v} /></td>; })}</tr>
          </tbody>
        </table>
      </div>
      <div className="card stack">
        <span className="strong">Novo grupo</span>
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); addCategory('', 'despesa'); }}>
          <div className="grid2">
            <input value={newGroup} onChange={(e) => { setNewGroup(e.target.value); setAdding(null); }} placeholder="Grupo (ex.: Viagem)" />
            <input value={adding === null ? name : ''} onChange={(e) => setName(e.target.value)} placeholder="Primeira categoria" />
          </div>
          <button className="btn small" type="submit">Criar grupo</button>
          {err && adding === null && <span className="error small">{err}</span>}
        </form>
      </div>
      <p className="small muted">Toque em “+ categoria” para incluir uma linha no grupo. Para limites e para renomear, use Categorias.</p>
    </section>
  );
}

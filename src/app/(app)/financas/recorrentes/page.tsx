'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Empty, EyeButton, Money, PageHeader, Segmented } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { monthKey, monthRange, parseMoney, todayISO } from '@/lib/format';
import { daysBetween, nextDue } from '@/lib/recurring';
import type { Kind, RecurringBill, Transaction } from '@/lib/types';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export default function Recorrentes() {
  const { householdId, accounts } = useApp();
  const [kind, setKind] = useState<Kind>('PF');
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [paid, setPaid] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Partial<RecurringBill> | null>(null);
  const account = accounts.find((a) => a.kind === kind);
  const today = todayISO();

  const [rev, setRev] = useState(0);
  const load = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!householdId || !account) return;
    let alive = true;
    const sb = supabase();
    const { start, end } = monthRange(monthKey());
    Promise.all([
      sb.from('recurring_bills').select('*').eq('household_id', householdId).eq('account_id', account.id).order('active', { ascending: false }).order('name'),
      sb.from('transactions').select('recurring_id').eq('household_id', householdId).not('recurring_id', 'is', null).gte('occurred_on', start).lt('occurred_on', end),
    ]).then(([b, t]) => {
      if (!alive) return;
      setBills((b.data as RecurringBill[]) ?? []);
      setPaid(new Set(((t.data as Pick<Transaction, 'recurring_id'>[]) ?? []).map((x) => x.recurring_id!)));
    });
    return () => { alive = false; };
  }, [householdId, account, rev]);

  const active = bills.filter((b) => b.active && b.tipo === 'despesa');
  const monthly = active.filter((b) => b.frequency === 'mensal').reduce((s, b) => s + Number(b.amount ?? 0), 0);

  async function launch(b: RecurringBill) {
    let amount = b.amount ? Number(b.amount) : NaN;
    if (b.variable || !amount) {
      const typed = prompt(`Valor de ${b.name} este mês:`, b.amount ? String(b.amount).replace('.', ',') : '');
      if (typed === null) return;
      amount = parseMoney(typed);
    }
    if (!amount || Number.isNaN(amount)) return;
    await supabase().from('transactions').insert({
      household_id: householdId, account_id: b.account_id, category_id: b.category_id, tipo: b.tipo, amount,
      occurred_on: today, description: b.name, recurring_id: b.id, source: 'recorrente', payment_method: 'boleto',
    });
    load();
  }

  return (
    <>
      <PageHeader title="Contas recorrentes" subtitle={`${active.length} ativas`} back="/financas">
        <EyeButton />
      </PageHeader>
      <Segmented value={kind} onChange={setKind} options={[{ id: 'PF', label: 'Família (PF)' }, { id: 'PJ', label: 'Empresa (PJ)' }]} />
      <div className="card row between"><span className="strong">Total mensal fixo</span><span className="mid"><Money v={monthly} /></span></div>
      {active.some((b) => !b.due_day) && <div className="card warn small">Algumas contas estão sem dia de vencimento. Toque nelas e informe o dia para ligar os lembretes.</div>}
      <button className="btn primary" onClick={() => setEditing({ account_id: account?.id, tipo: 'despesa', frequency: 'mensal', remind_days_before: 3, active: true, variable: false })}><Icon name="plus" size={16} /> Nova conta recorrente</button>

      <div className="list">
        {bills.length === 0 && <Empty>Nenhuma conta recorrente ainda.</Empty>}
        {bills.map((b) => {
          const due = nextDue(b, today);
          const d = due ? daysBetween(today, due) : null;
          const isPaid = paid.has(b.id);
          return (
            <div key={b.id} className="list-item" style={{ opacity: b.active ? 1 : 0.5 }}>
              <button className="grow" style={{ background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' }} onClick={() => setEditing(b)}>
                <span className="strong">{b.name}{b.tipo === 'receita' ? ' (entrada)' : ''}</span>
                <span className="small muted">
                  {b.frequency === 'anual' ? `Anual · ${MONTHS[(b.due_month ?? 1) - 1]}` : b.variable ? 'Mensal variável' : 'Mensal fixa'}
                  {' · '}{b.due_day ? `dia ${b.due_day}` : 'sem vencimento'}
                  {d !== null && b.active ? ` · ${d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : `em ${d} dias`}` : ''}
                </span>
              </button>
              <span className="strong small">{b.amount ? <Money v={Number(b.amount)} /> : 'varia'}</span>
              {b.active && (isPaid
                ? <span className="pill">Lançada</span>
                : <button className="btn small" onClick={() => launch(b)}>Lançar</button>)}
            </div>
          );
        })}
      </div>

      {editing && <BillSheet value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function BillSheet({ value, onClose, onSaved }: { value: Partial<RecurringBill>; onClose: () => void; onSaved: () => void }) {
  const { householdId, categories } = useApp();
  const [v, setV] = useState(value);
  const [amount, setAmount] = useState(value.amount ? String(value.amount).replace('.', ',') : '');
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<RecurringBill>) => setV((o) => ({ ...o, ...p }));
  const cats = categories.filter((c) => c.account_id === v.account_id && c.tipo === (v.tipo ?? 'despesa') && !c.archived);

  async function save() {
    if (!v.name?.trim()) { setErr('Dê um nome.'); return; }
    const a = amount.trim() ? parseMoney(amount) : null;
    if (a !== null && Number.isNaN(a)) { setErr('Valor inválido.'); return; }
    const row = {
      household_id: householdId, account_id: v.account_id, category_id: v.category_id || null, name: v.name.trim(), tipo: v.tipo ?? 'despesa',
      amount: a, variable: !!v.variable, frequency: v.frequency ?? 'mensal', due_day: v.due_day || null,
      due_month: v.frequency === 'anual' ? v.due_month || 1 : null, remind_days_before: v.remind_days_before ?? 3, active: v.active ?? true,
    };
    const sb = supabase();
    const { error } = v.id ? await sb.from('recurring_bills').update(row).eq('id', v.id) : await sb.from('recurring_bills').insert(row);
    if (error) { setErr(error.message); return; }
    onSaved();
  }

  async function remove() {
    if (!v.id || !confirm('Apagar esta conta recorrente? Os lançamentos já feitos continuam.')) return;
    await supabase().from('recurring_bills').delete().eq('id', v.id);
    onSaved();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Conta recorrente" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{v.id ? 'Editar conta' : 'Nova conta recorrente'}</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <label className="field"><span>Nome</span><input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Aluguel, financiamento do carro…" /></label>
        <Segmented value={v.tipo ?? 'despesa'} onChange={(t) => set({ tipo: t, category_id: null })} options={[{ id: 'despesa', label: 'Conta a pagar' }, { id: 'receita', label: 'Entrada fixa' }]} />
        <div className="grid2">
          <label className="field"><span>Valor</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={v.variable ? 'média (opcional)' : '0,00'} /></label>
          <label className="field"><span>Categoria</span>
            <select value={v.category_id ?? ''} onChange={(e) => set({ category_id: e.target.value || null })}>
              <option value="">—</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={!!v.variable} onChange={(e) => set({ variable: e.target.checked })} />Valor muda todo mês (luz, água, gás)</label>
        <div className="grid2">
          <label className="field"><span>Frequência</span>
            <select value={v.frequency ?? 'mensal'} onChange={(e) => set({ frequency: e.target.value as 'mensal' | 'anual' })}>
              <option value="mensal">Mensal</option><option value="anual">Anual</option>
            </select>
          </label>
          <label className="field"><span>Dia do vencimento</span><input type="number" min={1} max={31} value={v.due_day ?? ''} onChange={(e) => set({ due_day: e.target.value ? Number(e.target.value) : null })} /></label>
        </div>
        {v.frequency === 'anual' && (
          <label className="field"><span>Mês</span>
            <select value={v.due_month ?? 1} onChange={(e) => set({ due_month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Avisar quantos dias antes</span><input type="number" min={0} max={30} value={v.remind_days_before ?? 3} onChange={(e) => set({ remind_days_before: Number(e.target.value) })} /></label>
        {v.id && <label className="check"><input type="checkbox" checked={v.active ?? true} onChange={(e) => set({ active: e.target.checked })} />Ativa</label>}
        {err && <p className="error">{err}</p>}
        <button className="btn primary" onClick={save}>Salvar</button>
        {v.id && <button className="btn danger" onClick={remove}><Icon name="trash" size={16} /> Apagar</button>}
      </div>
    </div>
  );
}

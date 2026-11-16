'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { PageHeader, Segmented, CategorySelect } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { addMonthsToDate, money, parseMoney, splitInstallments, todayISO } from '@/lib/format';
import { parseMessage } from '@/lib/parse-message';
import { api, useStatus } from '@/lib/api';
import { PAYMENT_METHODS, type Kind, type Tipo } from '@/lib/types';

type Mode = 'mensagem' | 'manual' | 'foto';

export default function Lancar() {
  const { householdId, accounts, categories, members, me } = useApp();
  const router = useRouter();
  const status = useStatus();
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<Mode>('mensagem');
  const [msg, setMsg] = useState('');
  const [kind, setKind] = useState<Kind>('PF');
  const [tipo, setTipo] = useState<Tipo>('despesa');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [method, setMethod] = useState('credito');
  const [installments, setInstallments] = useState(1);
  const [date, setDate] = useState(todayISO());
  const [spentBy, setSpentBy] = useState<string>(me?.user_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const account = accounts.find((a) => a.kind === kind);
  const cats = categories.filter((c) => c.account_id === account?.id && c.tipo === tipo && !c.archived);

  async function interpret() {
    setErr(null);
    if (status?.claude) {
      setThinking(true);
      try {
        const r = await api<{ tipo: Tipo; conta: Kind; valor: number | null; descricao: string; category_id: string | null; forma_pagamento: string | null; parcelas: number; data: string; spent_by: string | null }>('/api/ia/interpretar', { text: msg });
        setKind(r.conta === 'PJ' ? 'PJ' : 'PF');
        setTipo(r.tipo);
        if (r.valor) setAmount(r.valor.toFixed(2).replace('.', ','));
        if (r.forma_pagamento) setMethod(r.forma_pagamento);
        setInstallments(r.parcelas || 1);
        setCategoryId(r.category_id ?? '');
        setDesc(r.descricao || msg);
        if (r.data) setDate(r.data);
        if (r.spent_by) setSpentBy(r.spent_by);
        setThinking(false);
        setMode('manual');
        return;
      } catch (e) {
        setErr(`O Claude não respondeu (${e instanceof Error ? e.message : e}); usei a leitura simples.`);
        setThinking(false);
      }
    }
    const p = parseMessage(msg, categories.filter((c) => c.account_id === account?.id));
    setTipo(p.tipo);
    if (p.amount) setAmount(p.amount.toFixed(2).replace('.', ','));
    if (p.payment_method) setMethod(p.payment_method);
    setInstallments(p.installments);
    setCategoryId(p.category_id ?? '');
    setDesc(p.description);
    setMode('manual');
  }

  async function save() {
    const total = parseMoney(amount);
    if (!total || Number.isNaN(total) || total <= 0) { setErr('Informe um valor.'); return; }
    if (!account || !householdId) return;
    setBusy(true); setErr(null);
    const n = tipo === 'despesa' && method === 'credito' ? Math.max(1, installments) : 1;
    const parts = splitInstallments(total, n);
    const group = n > 1 ? crypto.randomUUID() : null;
    const rows = parts.map((v, i) => ({
      household_id: householdId, account_id: account.id, category_id: categoryId || null, tipo, amount: v,
      occurred_on: addMonthsToDate(date, i), description: desc.trim() || null, payment_method: method,
      installments: n, installment_no: i + 1, installment_group: group,
      spent_by: kind === 'PF' ? spentBy || null : null, source: mode === 'manual' && msg ? 'mensagem' : 'manual',
    }));
    const { error } = await supabase().from('transactions').insert(rows);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSaved(n > 1 ? `Lançado em ${n} parcelas de ${money(parts[0], true)}.` : 'Lançado.');
    setAmount(''); setDesc(''); setMsg(''); setInstallments(1); setCategoryId('');
  }

  return (
    <>
      <PageHeader title="Lançar" back="/" />
      <Segmented value={mode} onChange={(m) => { setMode(m); setSaved(null); }} options={[{ id: 'mensagem', label: 'Mensagem' }, { id: 'manual', label: 'Manual' }, { id: 'foto', label: 'Foto / QR' }]} />

      {saved && <div className="card soft row between"><span className="strong">{saved}</span><button className="link-btn" onClick={() => router.push('/financas')}>Ver finanças</button></div>}

      {mode === 'mensagem' && (
        <div className="card stack">
          <label className="field"><span>Escreva como falaria</span>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="gastei 87,50 no mercado no crédito em 3x" />
          </label>
          <button className="btn primary" disabled={!msg.trim() || thinking} onClick={interpret}>{thinking ? 'O Claude está lendo…' : status?.claude ? 'Interpretar com o Claude' : 'Interpretar'}</button>
          <p className="muted small">Você confere tudo antes de salvar.{status?.telegram ? ' Também dá para mandar pelo bot do Telegram.' : ''}</p>
        </div>
      )}

      {mode === 'foto' && (
        <div className="card stack">
          <p>Leia o QR code do cupom fiscal (NFC-e) ou a foto de qualquer comprovante. O gasto é lançado e os itens abastecem o estoque.</p>
          <Link href="/lancar/nota" className="btn primary">Ler nota fiscal ou comprovante</Link>
        </div>
      )}

      {mode === 'manual' && (
        <div className="card stack">
          <Segmented value={kind} onChange={(k) => { setKind(k); setCategoryId(''); }} options={[{ id: 'PF', label: 'Família (PF)' }, { id: 'PJ', label: 'Empresa (PJ)' }]} />
          <Segmented value={tipo} onChange={(t) => { setTipo(t); setCategoryId(''); }} options={[{ id: 'despesa', label: 'Gasto' }, { id: 'receita', label: 'Entrada' }]} />
          <div className="grid2">
            <label className="field"><span>Valor</span><input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ fontFamily: 'var(--font-head)', fontSize: 20, fontWeight: 700 }} /></label>
            <label className="field"><span>Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          <label className="field"><span>Descrição</span><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="O que foi" /></label>
          <label className="field"><span>Categoria</span>
            <CategorySelect cats={cats} value={categoryId} onChange={setCategoryId} emptyLabel="Escolha…" />
          </label>
          <div className="grid2">
            <label className="field"><span>Forma de pagamento</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            {tipo === 'despesa' && method === 'credito' ? (
              <label className="field"><span>Parcelas</span>
                <select value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x</option>)}
                </select>
              </label>
            ) : kind === 'PF' ? (
              <label className="field"><span>Quem</span>
                <select value={spentBy} onChange={(e) => setSpentBy(e.target.value)}>
                  <option value="">Todos</option>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
                </select>
              </label>
            ) : <span />}
          </div>
          {kind === 'PF' && tipo === 'despesa' && method === 'credito' && (
            <label className="field"><span>Quem</span>
              <select value={spentBy} onChange={(e) => setSpentBy(e.target.value)}>
                <option value="">Todos</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
              </select>
            </label>
          )}
          {err && <p className="error">{err}</p>}
          <button className="btn primary block" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>
      )}
    </>
  );
}

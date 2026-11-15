'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Bar, Chips, EyeButton, Money, PageHeader } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { currentQuantity, daysLeft, needsBuying, normalizeName, STOCK_CATEGORIES, type StockItem } from '@/lib/stock';
import { applyMovement } from '@/lib/stock-db';

const QUICK = [
  ['Café', 'alimentos', 'pct'], ['Arroz', 'alimentos', 'pct'], ['Feijão', 'alimentos', 'pct'], ['Leite', 'alimentos', 'cx'], ['Açúcar', 'alimentos', 'pct'], ['Azeite', 'alimentos', 'un'],
  ['Papel higiênico', 'higiene', 'rolo'], ['Sabonete', 'higiene', 'un'], ['Creme dental', 'higiene', 'un'], ['Shampoo', 'higiene', 'un'],
  ['Detergente', 'casa', 'un'], ['Sabão em pó', 'casa', 'cx'], ['Saco de lixo', 'casa', 'rolo'], ['Amaciante', 'casa', 'un'],
] as const;

function fmtQty(n: number) { return n % 1 === 0 ? String(n) : n.toFixed(1).replace('.', ','); }

export default function Estoque() {
  const { householdId } = useApp();
  const router = useRouter();
  const [items, setItems] = useState<StockItem[]>([]);
  const [cat, setCat] = useState<string>('all');
  const [editing, setEditing] = useState<Partial<StockItem> | null>(null);
  const [rev, setRev] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const reload = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    supabase().from('stock_items').select('*').eq('household_id', householdId).order('name')
      .then(({ data }) => { if (alive) { setItems((data as StockItem[]) ?? []); setLoaded(true); } });
    return () => { alive = false; };
  }, [householdId, rev]);

  const active = useMemo(() => items.filter((i) => i.active), [items]);
  const shown = active.filter((i) => cat === 'all' || i.category === cat);
  const low = useMemo(() => active.filter((i) => needsBuying(i)).sort((a, b) => (daysLeft(a) ?? 0) - (daysLeft(b) ?? 0)), [active]);

  async function move(i: StockItem, delta: number, kind: 'compra' | 'consumo' | 'acabou') {
    await applyMovement(supabase(), i, delta, kind);
    reload();
  }

  async function makeList() {
    const sb = supabase();
    const { data: open } = await sb.from('shopping_items').select('stock_item_id').eq('household_id', householdId).eq('checked', false);
    const have = new Set((open ?? []).map((o) => o.stock_item_id));
    const rows = low.filter((i) => !have.has(i.id)).map((i) => ({ household_id: householdId, name: i.name, stock_item_id: i.id, urgent: true, source: 'estoque' }));
    if (rows.length) await sb.from('shopping_items').insert(rows);
    router.push('/estoque/lista');
  }

  async function quickAdd(name: string, category: string, unit: string) {
    await supabase().from('stock_items').upsert({ household_id: householdId, name, category, unit, quantity: 1 }, { onConflict: 'household_id,name' });
    reload();
  }

  return (
    <>
      <PageHeader title="Estoque" subtitle="Comida, higiene e casa">
        <EyeButton />
        <button className="icon-btn" aria-label="Adicionar item" onClick={() => setEditing({ category: 'alimentos', unit: 'un', quantity: 1, min_days: 5, aliases: [], active: true })}><Icon name="plus" /></button>
      </PageHeader>

      <div className="row gap8 wrap">
        <Link href="/estoque/lista" className="btn dark"><Icon name="check" size={16} /> Lista de compras</Link>
        <Link href="/lancar/nota" className="btn">Ler nota fiscal</Link>
      </div>

      {low.length > 0 && (
        <section className="stack">
          <div className="row between"><h2>Acabando</h2><button className="link-btn" onClick={makeList}>Pôr na lista ({low.length})</button></div>
          <div className="grid3">
            {low.slice(0, 6).map((i) => {
              const d = daysLeft(i);
              return (
                <button key={i.id} className="card" style={{ background: 'var(--orange-soft)', border: 'none', textAlign: 'left', padding: 10, cursor: 'pointer' }} onClick={() => setEditing(i)}>
                  <span className="strong small" style={{ color: '#7C2D12' }}>{i.name}</span><br />
                  <span className="mid" style={{ color: '#7C2D12' }}>{d === null ? 'acabou' : d < 1 ? 'hoje' : `~${Math.round(d)} d`}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <Chips value={cat} onChange={setCat} options={[{ id: 'all', label: 'Todos' }, ...STOCK_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))]} />

      <div className="list">
        {loaded && shown.length === 0 && (
          <div className="stack" style={{ padding: 16 }}>
            <span className="muted small">Comece pelos itens que vocês compram sempre. Toque para adicionar:</span>
            <div className="row wrap gap8">{QUICK.filter((q) => !items.some((i) => i.name === q[0])).map((q) => <button key={q[0]} className="chip" onClick={() => quickAdd(q[0], q[1], q[2])}>+ {q[0]}</button>)}</div>
            <span className="muted small">Depois, ao ler as notas fiscais, o app soma as compras e aprende quanto tempo cada item dura.</span>
          </div>
        )}
        {shown.map((i) => {
          const d = daysLeft(i);
          const q = currentQuantity(i);
          return (
            <div key={i.id} className="list-item">
              <button className="grow" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setEditing(i)}>
                <span className="strong">{i.name}</span>
                <span className="small muted">≈ {fmtQty(q)} {i.unit} · {d === null ? 'aprendendo o consumo' : d < 1 ? 'acaba hoje' : `dura ~${Math.round(d)} dias`}</span>
                {d !== null && <Bar pct={Math.min(100, (d / Math.max(i.min_days * 3, 1)) * 100)} warn={needsBuying(i)} />}
              </button>
              <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label={`Usei um de ${i.name}`} onClick={() => move(i, -1, 'consumo')}>−</button>
              <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label={`Comprei um de ${i.name}`} onClick={() => move(i, 1, 'compra')}>+</button>
            </div>
          );
        })}
      </div>

      {editing && <ItemSheet value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} onMove={async (i, k) => { await move(i, 0, k); setEditing(null); }} />}
    </>
  );
}

function ItemSheet({ value, onClose, onSaved, onMove }: { value: Partial<StockItem>; onClose: () => void; onSaved: () => void; onMove: (i: StockItem, k: 'acabou') => void }) {
  const { householdId } = useApp();
  const [v, setV] = useState(value);
  const [aliases, setAliases] = useState((value.aliases ?? []).join(', '));
  const [prices, setPrices] = useState<{ store: string; price: number; date: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<StockItem>) => setV((o) => ({ ...o, ...p }));

  useEffect(() => {
    if (!value.id || !householdId) return;
    const keys = [value.name ?? '', ...(value.aliases ?? [])].map(normalizeName).filter(Boolean);
    const since = new Date(Date.now() - 150 * 86400000).toISOString().slice(0, 10);
    supabase().from('price_history').select('store,unit_price,observed_on,item_key').eq('household_id', householdId).in('item_key', keys).gte('observed_on', since)
      .then(({ data }) => {
        const best = new Map<string, { store: string; price: number; date: string }>();
        for (const p of data ?? []) {
          const cur = best.get(p.store);
          if (!cur || Number(p.unit_price) < cur.price) best.set(p.store, { store: p.store, price: Number(p.unit_price), date: p.observed_on });
        }
        setPrices(Array.from(best.values()).sort((a, b) => a.price - b.price));
      });
  }, [value.id, value.name, value.aliases, householdId]);

  async function save() {
    if (!v.name?.trim()) { setErr('Dê um nome.'); return; }
    const row = {
      household_id: householdId, name: v.name.trim(), category: v.category ?? 'alimentos', unit: v.unit || 'un', min_days: v.min_days ?? 5,
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean), active: v.active ?? true,
      ...(v.id && v.quantity === value.quantity ? {} : { quantity: Number(v.quantity) || 0, quantity_updated_at: new Date().toISOString() }),
    };
    const sb = supabase();
    const { error } = v.id ? await sb.from('stock_items').update(row).eq('id', v.id) : await sb.from('stock_items').insert(row);
    if (error) { setErr(error.message.includes('duplicate') ? 'Já existe um item com esse nome.' : error.message); return; }
    onSaved();
  }

  async function remove() {
    if (!v.id || !confirm('Apagar este item do estoque?')) return;
    await supabase().from('stock_items').delete().eq('id', v.id);
    onSaved();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Item do estoque" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{v.id ? v.name : 'Novo item'}</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <label className="field"><span>Nome</span><input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Café 500 g" /></label>
        <div className="grid2">
          <label className="field"><span>Tipo</span>
            <select value={v.category} onChange={(e) => set({ category: e.target.value as StockItem['category'] })}>{STOCK_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          </label>
          <label className="field"><span>Unidade</span><input value={v.unit ?? ''} onChange={(e) => set({ unit: e.target.value })} placeholder="un, pct, kg, rolo" /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Quantidade agora</span><input type="number" step="0.5" min={0} value={v.quantity ?? 0} onChange={(e) => set({ quantity: Number(e.target.value) })} /></label>
          <label className="field"><span>Avisar com quantos dias</span><input type="number" min={1} max={60} value={v.min_days ?? 5} onChange={(e) => set({ min_days: Number(e.target.value) })} /></label>
        </div>
        <label className="field"><span>Nomes na nota fiscal (separe por vírgula)</span><input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="CAFE PILAO 500G, CAFE MELITTA" /></label>
        {v.id && v.daily_usage ? <p className="small muted">Consumo aprendido: {Number(v.daily_usage) >= 1 ? `${Number(v.daily_usage).toFixed(1).replace('.', ',')} ${v.unit}/dia` : `1 ${v.unit} a cada ${Math.round(1 / Number(v.daily_usage))} dias`}</p> : null}
        {prices.length > 0 && (
          <div className="card stack" style={{ padding: 12 }}>
            <span className="small strong">Onde vocês pagaram menos (últimos 5 meses)</span>
            {prices.slice(0, 4).map((p) => <div key={p.store} className="row between small"><span>{p.store}</span><span className="strong"><Money v={p.price} /></span></div>)}
          </div>
        )}
        {err && <p className="error">{err}</p>}
        <button className="btn primary" onClick={save}>Salvar</button>
        {v.id && <button className="btn" onClick={() => onMove(v as StockItem, 'acabou')}>Acabou (zerar e aprender o consumo)</button>}
        {v.id && <button className="btn danger" onClick={remove}><Icon name="trash" size={16} /> Apagar</button>}
      </div>
    </div>
  );
}

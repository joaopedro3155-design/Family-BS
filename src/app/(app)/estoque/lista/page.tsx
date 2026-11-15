'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Empty, PageHeader } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { daysLeft, needsBuying, whatsappText, type StockItem } from '@/lib/stock';

interface ShopItem { id: string; name: string; quantity: string | null; stock_item_id: string | null; checked: boolean; urgent: boolean; source: string }

export default function Lista() {
  const { householdId, householdName } = useApp();
  const [items, setItems] = useState<ShopItem[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [rev, setRev] = useState(0);
  const reload = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    const sb = supabase();
    Promise.all([
      sb.from('shopping_items').select('*').eq('household_id', householdId).order('created_at'),
      sb.from('stock_items').select('*').eq('household_id', householdId).eq('active', true),
    ]).then(([a, b]) => { if (alive) { setItems((a.data as ShopItem[]) ?? []); setStock((b.data as StockItem[]) ?? []); } });
    return () => { alive = false; };
  }, [householdId, rev]);

  const open = items.filter((i) => !i.checked);
  const urgent = open.filter((i) => i.urgent);
  const extra = open.filter((i) => !i.urgent);
  const bought = items.filter((i) => i.checked);
  const inList = new Set(open.map((i) => i.stock_item_id).filter(Boolean));
  // itens que não são urgentes mas vão acabar logo (sugestões para incluir)
  const suggestions = stock.filter((s) => !inList.has(s.id)).filter((s) => {
    const d = daysLeft(s);
    return needsBuying(s) || (d !== null && d <= s.min_days * 2.5);
  }).slice(0, 8);

  async function add(n: string, q: string | null, urgentFlag: boolean, stockId: string | null = null) {
    if (!n.trim()) return;
    await supabase().from('shopping_items').insert({ household_id: householdId, name: n.trim(), quantity: q?.trim() || null, urgent: urgentFlag, stock_item_id: stockId, source: stockId ? 'estoque' : 'manual' });
    setName(''); setQty('');
    reload();
  }
  async function toggle(i: ShopItem) { await supabase().from('shopping_items').update({ checked: !i.checked }).eq('id', i.id); reload(); }
  async function setUrgent(i: ShopItem, u: boolean) { await supabase().from('shopping_items').update({ urgent: u }).eq('id', i.id); reload(); }
  async function remove(i: ShopItem) { await supabase().from('shopping_items').delete().eq('id', i.id); reload(); }
  async function clearBought() { await supabase().from('shopping_items').delete().eq('household_id', householdId).eq('checked', true); reload(); }

  function exportWhatsApp() {
    const text = whatsappText(`Lista de compras · ${householdName}`, urgent, extra);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }
  async function share() {
    const text = whatsappText(`Lista de compras · ${householdName}`, urgent, extra);
    if (navigator.share) await navigator.share({ text }).catch(() => {});
    else { await navigator.clipboard.writeText(text); alert('Lista copiada.'); }
  }

  const row = (i: ShopItem) => (
    <div key={i.id} className="list-item">
      <label className="check grow" style={{ flexDirection: 'row' }}>
        <input type="checkbox" checked={i.checked} onChange={() => toggle(i)} aria-label={`Comprado: ${i.name}`} />
        <span className="grow"><span className="strong" style={{ textDecoration: i.checked ? 'line-through' : 'none' }}>{i.name}{i.quantity ? ` (${i.quantity})` : ''}</span>
          {i.source === 'estoque' && <span className="small muted">do estoque</span>}</span>
      </label>
      {!i.checked && <button className="link-btn" onClick={() => setUrgent(i, !i.urgent)}>{i.urgent ? 'Se der' : 'Urgente'}</button>}
      <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label={`Tirar ${i.name}`} onClick={() => remove(i)}><Icon name="trash" size={16} /></button>
    </div>
  );

  return (
    <>
      <PageHeader title="Lista de compras" subtitle={`${open.length} itens`} back="/estoque" />

      <div className="card stack">
        <div className="row gap8">
          <input aria-label="Item" className="grow" style={{ height: 46, borderRadius: 12, border: '1px solid var(--line)', padding: '0 14px' }} placeholder="Incluir item da sua escolha" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(name, qty, false)} />
          <input aria-label="Quantidade" style={{ width: 80, height: 46, borderRadius: 12, border: '1px solid var(--line)', padding: '0 10px' }} placeholder="qtd" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="row gap8">
          <button className="btn small" disabled={!name.trim()} onClick={() => add(name, qty, false)}>Incluir em “se der”</button>
          <button className="btn small dark" disabled={!name.trim()} onClick={() => add(name, qty, true)}>Incluir como urgente</button>
        </div>
      </div>

      <section className="stack" style={{ gap: 6 }}>
        <span className="small strong muted">PRECISA COMPRAR</span>
        <div className="list">{urgent.length ? urgent.map((i) => row(i)) : <Empty>Nada urgente.</Empty>}</div>
      </section>

      <section className="stack" style={{ gap: 6 }}>
        <span className="small strong muted">SE DER</span>
        <div className="list">{extra.length ? extra.map((i) => row(i)) : <Empty>Inclua o que quiser antes de exportar.</Empty>}</div>
      </section>

      {suggestions.length > 0 && (
        <section className="stack" style={{ gap: 6 }}>
          <span className="small strong muted">DO ESTOQUE, VAI ACABAR EM BREVE</span>
          <div className="row wrap gap8">
            {suggestions.map((s) => <button key={s.id} className="chip" onClick={() => add(s.name, null, needsBuying(s), s.id)}>+ {s.name}</button>)}
          </div>
        </section>
      )}

      <div className="stack" style={{ gap: 8 }}>
        <button className="btn block" style={{ background: '#166534', borderColor: '#166534', color: '#fff' }} disabled={!open.length} onClick={exportWhatsApp}>Exportar para o WhatsApp</button>
        <button className="btn block" disabled={!open.length} onClick={share}>Compartilhar / copiar</button>
      </div>

      {bought.length > 0 && (
        <section className="stack" style={{ gap: 6 }}>
          <div className="row between"><span className="small strong muted">COMPRADOS</span><button className="link-btn" onClick={clearBought}>Limpar</button></div>
          <div className="list">{bought.map((i) => row(i))}</div>
          <span className="small muted">Para somar ao estoque, leia a nota fiscal em Lançar → Nota fiscal.</span>
        </section>
      )}
    </>
  );
}

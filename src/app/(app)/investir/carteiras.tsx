'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Empty } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { todayISO } from '@/lib/format';
import { analyze, holding, LEVELS, SEED_BR, SEED_INT, toSymbol, type Analysis, type Buy, type Level, type Market, type Quote, type WatchItem } from '@/lib/market';
import type { Headline } from '@/lib/rss';

// A lista acompanhada e as compras ficam num registro da família (tabela investment_briefs, chave 1900-01-01).
const KEY = '1900-01-01';
const fmtNum = (v: number, cur: string, dec = 2) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur === 'BRL' ? 'BRL' : 'USD', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
const fmtPct = (v: number | null | undefined, signed = true) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`);
const upDown = (v: number | null | undefined) => (v === null || v === undefined ? 'muted' : v >= 0 ? 'up' : 'down');

export function useWatchlist(householdId: string | null) {
  const [items, setItems] = useState<WatchItem[] | null>(null);
  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    supabase().from('investment_briefs').select('content').eq('household_id', householdId).eq('week_start', KEY).maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const saved = (data?.content as { items?: WatchItem[] } | undefined)?.items;
        setItems(saved ?? [...SEED_BR, ...SEED_INT].map((s) => ({ ...s, buys: [] })));
      });
    return () => { alive = false; };
  }, [householdId]);
  const save = useCallback(async (next: WatchItem[]) => {
    setItems(next);
    if (!householdId) return;
    await supabase().from('investment_briefs').upsert({ household_id: householdId, week_start: KEY, content: { items: next } }, { onConflict: 'household_id,week_start' });
  }, [householdId]);
  return { items, save };
}

/** Cotações com atualização automática a cada 60 s enquanto a tela está aberta. */
export function useQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [updated, setUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const key = symbols.slice().sort().join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      setLoading(true);
      try {
        const chunks: string[][] = [];
        const list = key.split(',');
        for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
        const res = await Promise.all(chunks.map((c) => fetch(`/api/cotacoes?symbols=${encodeURIComponent(c.join(','))}`).then((r) => r.json())));
        if (!alive) return;
        setQuotes((old) => Object.assign({}, old, ...res.map((r) => r.quotes ?? {})));
        setUpdated(new Date());
      } catch { /* tenta de novo no próximo ciclo */ }
      if (alive) setLoading(false);
    };
    load();
    const t = setInterval(load, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [key]);
  return { quotes, updated, loading };
}

function Sparkline({ closes, color }: { closes: number[]; color: string }) {
  const pts = closes.slice(-180);
  if (pts.length < 2) return <div style={{ height: 44 }} />;
  const min = Math.min(...pts), max = Math.max(...pts), w = 300, h = 44;
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden="true">
      <polyline points={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function RangeBar({ a, cur }: { a: Analysis; cur: string }) {
  if (a.pos52 === null || a.low52 === null || a.high52 === null) return null;
  return (
    <div className="stack" style={{ gap: 3 }}>
      <div className="range52"><span style={{ left: `${Math.min(100, Math.max(0, a.pos52 * 100))}%` }} /></div>
      <div className="row between tiny muted"><span>mín. 52 sem. {fmtNum(a.low52, cur)}</span><span>máx. {fmtNum(a.high52, cur)}</span></div>
    </div>
  );
}

const ORDER: Level[] = ['desconto', 'bom', 'neutro', 'esticado', 'novo'];

export function StockPanel({ market, items, save, owners }: { market: Market; items: WatchItem[]; save: (n: WatchItem[]) => Promise<void>; owners: string[] }) {
  const { showValues } = useApp();
  const mine = items.filter((i) => i.market === market);
  const symbols = useMemo(() => [...mine.map((i) => i.symbol), ...(market === 'INT' ? ['BRL=X'] : [])], [mine, market]);
  const { quotes, updated, loading } = useQuotes(symbols);
  const [filter, setFilter] = useState<Level | 'all'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [buying, setBuying] = useState<WatchItem | null>(null);
  const [adding, setAdding] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const cur = market === 'BR' ? 'BRL' : 'USD';
  const usdbrl = quotes['BRL=X']?.price ?? null;

  const rows = mine.map((it) => {
    const q = quotes[it.symbol] ?? null;
    const a = q ? analyze(q) : null;
    return { it, q, a, h: holding(it, q?.price ?? null) };
  });
  const owned = rows.filter((r) => r.h.qty > 0);
  const totals = owned.reduce((s, r) => ({ cost: s.cost + r.h.cost, value: s.value + (r.h.value ?? r.h.cost) }), { cost: 0, value: 0 });
  const shown = rows
    .filter((r) => filter === 'all' || r.a?.level === filter)
    .sort((x, y) => (y.h.qty > 0 ? 1 : 0) - (x.h.qty > 0 ? 1 : 0) || ORDER.indexOf(x.a?.level ?? 'novo') - ORDER.indexOf(y.a?.level ?? 'novo'));

  async function addTicker() {
    const t = adding.trim();
    if (!t) return;
    const { symbol, label } = toSymbol(t, market);
    if (items.some((i) => i.symbol === symbol)) { setAddErr('Já está na lista.'); return; }
    setAddErr(null);
    const r = await fetch(`/api/cotacoes?symbols=${encodeURIComponent(symbol)}`).then((x) => x.json()).catch(() => null);
    const q: Quote | null = r?.quotes?.[symbol] ?? null;
    if (!q) { setAddErr(`Não achei cotação para ${label}. Confira o código${market === 'BR' ? ' (ex.: PETR4, ITSA4, BOVA11)' : ' (ex.: NVDA, VOO, QQQ)'}.`); return; }
    await save([...items, { symbol, label, name: q.name ?? label, sector: '—', market, buys: [] }]);
    setAdding('');
  }
  const update = (sym: string, f: (i: WatchItem) => WatchItem | null) => save(items.map((i) => (i.symbol === sym ? f(i) : i)).filter(Boolean) as WatchItem[]);

  return (
    <section className="stack">
      <div className="card dark stack" style={{ gap: 6 }}>
        <span className="small strong muted">{market === 'BR' ? 'Ações brasileiras que você tem' : 'Ações internacionais que você tem'}</span>
        {owned.length === 0 ? (
          <span className="small muted">Nenhuma ainda. Toque em “+ Comprei” numa ação para registrar.</span>
        ) : (
          <>
            <span className="big">{showValues ? fmtNum(totals.value, cur) : '•••••'}</span>
            {market === 'INT' && usdbrl && showValues && <span className="small muted">≈ {fmtNum(totals.value * usdbrl, 'BRL')} (dólar {usdbrl.toFixed(2).replace('.', ',')})</span>}
            <span className={`small ${totals.value >= totals.cost ? 'up-dark' : 'down-dark'}`}>{showValues ? `${totals.value >= totals.cost ? 'Ganho' : 'Perda'} de ${fmtNum(Math.abs(totals.value - totals.cost), cur)} (${fmtPct((totals.value / totals.cost - 1) * 100)})` : 'Valores ocultos'}</span>
          </>
        )}
      </div>

      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <h2>{market === 'BR' ? 'Ações no Brasil' : 'Ações no exterior'}</h2>
        <span className="tiny muted">{loading ? 'atualizando…' : updated ? `atualizado ${updated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      </div>
      <div className="chips">
        <button className={filter === 'all' ? 'chip on' : 'chip'} onClick={() => setFilter('all')}>Todas</button>
        {ORDER.slice(0, 4).map((l) => (
          <button key={l} className={filter === l ? 'chip on' : 'chip'} onClick={() => setFilter(l)}><span className="dot" style={{ background: LEVELS[l].color }} /> {LEVELS[l].label}</button>
        ))}
      </div>

      <div className="stock-grid">
        {shown.length === 0 && <Empty>Nenhuma ação com esse sinal agora.</Empty>}
        {shown.map(({ it, q, a, h }) => {
          const lv = a ? LEVELS[a.level] : LEVELS.novo;
          const isOpen = open === it.symbol;
          return (
            <div key={it.symbol} className="stock-card" style={{ borderLeftColor: lv.color }}>
              <button className="stock-head" onClick={() => setOpen(isOpen ? null : it.symbol)} aria-expanded={isOpen}>
                <span className="grow stack" style={{ gap: 1, alignItems: 'flex-start' }}>
                  <span className="strong">{it.name}</span>
                  <span className="tiny muted">{it.label} · {it.sector}</span>
                </span>
                <span className="stack" style={{ gap: 1, alignItems: 'flex-end' }}>
                  <span className="strong">{q ? fmtNum(q.price, q.currency) : '—'}</span>
                  <span className={`tiny strong ${upDown(a?.ret.d1)}`}>{fmtPct(a?.ret.d1)} hoje</span>
                </span>
              </button>
              {q && <Sparkline closes={q.closes} color={lv.color} />}
              <div className="row between" style={{ gap: 8 }}>
                <span className="signal" style={{ color: lv.color, background: lv.bg }} title={lv.hint}>● {lv.label}</span>
                <button className="btn small primary" onClick={() => setBuying(it)}><Icon name="plus" size={14} /> Comprei</button>
              </div>
              {h.qty > 0 && (
                <span className="tiny">
                  Você tem <strong>{showValues ? h.qty.toLocaleString('pt-BR') : '•••'}</strong> · preço médio {showValues ? fmtNum(h.avg, cur) : '•••'} · {' '}
                  <strong className={upDown(h.pl)}>{showValues && h.pl !== null ? `${h.pl >= 0 ? '+' : ''}${fmtNum(h.pl, cur)} (${fmtPct(h.plPct)})` : '•••'}</strong>
                </span>
              )}
              {isOpen && <StockDetail it={it} q={q} a={a} cur={q?.currency ?? cur} onRemoveBuy={(id) => update(it.symbol, (i) => ({ ...i, buys: i.buys.filter((b) => b.id !== id) }))} onUnwatch={() => { if (confirm(`Parar de acompanhar ${it.label}?${h.qty ? ' As compras registradas também serão apagadas.' : ''}`)) update(it.symbol, () => null); }} />}
            </div>
          );
        })}
      </div>

      <form className="row gap8" onSubmit={(e) => { e.preventDefault(); addTicker(); }}>
        <input className="grow" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={market === 'BR' ? 'Acompanhar outra ação (ex.: ITSA4, BOVA11)' : 'Acompanhar outra (ex.: AMD, VOO, QQQ)'} autoCapitalize="characters" />
        <button className="btn small" type="submit" disabled={!adding.trim()}>Acompanhar</button>
      </form>
      {addErr && <span className="small error">{addErr}</span>}

      <p className="tiny muted">
        Cotações do Yahoo Finance{market === 'BR' ? ' (B3 com cerca de 15 min de atraso)' : ''}, atualizadas a cada minuto com a tela aberta. O sinal colorido é um termômetro técnico
        (faixa de 52 semanas, RSI e médias de 50/200 dias): ajuda a ver se o preço está caro ou descontado, mas não olha balanço nem notícias e não é recomendação de compra.
      </p>

      {buying && <BuySheet item={buying} price={quotes[buying.symbol]?.price ?? null} cur={quotes[buying.symbol]?.currency ?? cur} owners={owners} onClose={() => setBuying(null)} onSave={async (b) => { await update(buying.symbol, (i) => ({ ...i, buys: [...i.buys, b] })); setBuying(null); }} />}
    </section>
  );
}

function StockDetail({ it, q, a, cur, onRemoveBuy, onUnwatch }: { it: WatchItem; q: Quote | null; a: Analysis | null; cur: string; onRemoveBuy: (id: string) => void; onUnwatch: () => void }) {
  const { showValues } = useApp();
  const [news, setNews] = useState<Headline[] | null>(null);
  useEffect(() => {
    let alive = true;
    const name = it.name.replace(/\s*\(.*\)/, '');
    fetch(`/api/noticias?q=${encodeURIComponent(`${name} ${it.market === 'BR' ? it.label : 'ações'} when:14d`)}`).then((r) => r.json()).then((j) => { if (alive) setNews((j.items ?? []).slice(0, 6)); }).catch(() => { if (alive) setNews([]); });
    return () => { alive = false; };
  }, [it]);
  return (
    <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--line2)', paddingTop: 10 }}>
      {a && (
        <>
          <div className="ret-grid">
            {([['Hoje', a.ret.d1], ['1 mês', a.ret.m1], ['3 meses', a.ret.m3], ['6 meses', a.ret.m6], ['No ano', a.ret.ytd], ['12 meses', a.ret.y1]] as [string, number | null][]).map(([l, v]) => (
              <div key={l} className="ret"><span className="tiny muted">{l}</span><span className={`small strong ${upDown(v)}`}>{fmtPct(v)}</span></div>
            ))}
          </div>
          <RangeBar a={a} cur={cur} />
          <div className="tiny muted">
            RSI {a.rsi?.toFixed(0) ?? '—'} · média 50d {a.sma50 ? fmtNum(a.sma50, cur) : '—'} · média 200d {a.sma200 ? fmtNum(a.sma200, cur) : '—'}
          </div>
          <ul className="reasons">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </>
      )}
      {!q && <span className="small muted">Sem cotação agora (fonte fora do ar ou código inválido).</span>}
      {it.buys.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="tiny strong muted">COMPRAS REGISTRADAS</span>
          {it.buys.map((b) => (
            <div key={b.id} className="row between tiny">
              <span>{b.date.split('-').reverse().join('/')} · {showValues ? `${b.qty} × ${fmtNum(b.price, cur)}` : '•••'} · {b.owner} · {b.broker}</span>
              <button className="link-btn tiny" onClick={() => { if (confirm('Apagar esta compra?')) onRemoveBuy(b.id); }}>apagar</button>
            </div>
          ))}
        </div>
      )}
      <div className="stack" style={{ gap: 4 }}>
        <span className="tiny strong muted">NOTÍCIAS RECENTES</span>
        {news === null && <span className="tiny muted">Carregando…</span>}
        {news?.length === 0 && <span className="tiny muted">Nenhuma notícia nos últimos 14 dias.</span>}
        {news?.map((n) => (
          <a key={n.link} href={n.link} target="_blank" rel="noopener noreferrer" className="news-mini">
            <span className="small">{n.title}</span>
            <span className="tiny muted">{n.source ?? ''}{n.published ? ` · ${new Date(n.published).toLocaleDateString('pt-BR')}` : ''}</span>
          </a>
        ))}
      </div>
      <button className="link-btn tiny" style={{ alignSelf: 'flex-start', color: 'var(--orange)' }} onClick={onUnwatch}>Parar de acompanhar</button>
    </div>
  );
}

function BuySheet({ item, price, cur, owners, onClose, onSave }: { item: WatchItem; price: number | null; cur: string; owners: string[]; onClose: () => void; onSave: (b: Buy) => Promise<void> }) {
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState('');
  const [px, setPx] = useState(price ? price.toFixed(2).replace('.', ',') : '');
  const [owner, setOwner] = useState(owners[0] ?? 'João Pedro');
  const [broker, setBroker] = useState(item.market === 'BR' ? 'XP' : 'XP Internacional');
  const [err, setErr] = useState<string | null>(null);
  const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
  async function save() {
    const q = num(qty), p = num(px);
    if (!(q > 0) || !(p > 0)) { setErr('Informe a quantidade e o preço pago.'); return; }
    await onSave({ id: crypto.randomUUID(), date, qty: q, price: p, owner, broker: broker.trim() || '—' });
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Registrar compra de ${item.label}`} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>Comprei {item.label}</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <span className="small muted">{item.name}{price ? ` · cotação agora ${fmtNum(price, cur)}` : ''}</span>
        <div className="grid2">
          <label className="field"><span>Quantidade</span><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={item.market === 'BR' ? 'Ex.: 100' : 'Ex.: 2,5'} autoFocus /></label>
          <label className="field"><span>Preço pago ({cur === 'BRL' ? 'R$' : 'US$'})</span><input inputMode="decimal" value={px} onChange={(e) => setPx(e.target.value)} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>De quem</span><select value={owner} onChange={(e) => setOwner(e.target.value)}>{owners.map((o) => <option key={o}>{o}</option>)}</select></label>
        </div>
        <label className="field"><span>Corretora</span><input value={broker} onChange={(e) => setBroker(e.target.value)} /></label>
        {qty && px && num(qty) > 0 && num(px) > 0 && <span className="small">Total: <strong>{fmtNum(num(qty) * num(px), cur)}</strong></span>}
        {err && <p className="error">{err}</p>}
        <button className="btn primary" onClick={save}>Salvar compra</button>
      </div>
    </div>
  );
}

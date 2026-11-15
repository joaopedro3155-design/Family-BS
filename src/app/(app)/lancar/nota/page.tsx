'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { PageHeader, Segmented } from '@/components/ui';
import { api, useStatus } from '@/lib/api';
import { compressImage, decodeQr, qrToUrl, scanRegion } from '@/lib/image';
import { supabase } from '@/lib/supabase';
import { money, parseMoney, todayISO } from '@/lib/format';
import { matchStockItem, STOCK_CATEGORIES, type ReadReceiptResponse, type StockItem } from '@/lib/stock';
import { saveReceipt, type StockPick } from '@/lib/stock-db';
import { PAYMENT_METHODS, type Kind } from '@/lib/types';

type PickChoice = string; // id do item | 'new' | 'skip'

export default function Nota() {
  const status = useStatus();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [data, setData] = useState<ReadReceiptResponse | null>(null);

  async function fromFile(f: File) {
    setErr(null); setBusy('Procurando o QR code…');
    try {
      const raw = await decodeQr(f).catch(() => null);
      const qr = raw ? qrToUrl(raw) : null;
      if (qr) {
        setBusy('Buscando a nota na SEFAZ…');
        setData(await api<ReadReceiptResponse>('/api/notas/ler', { qr }));
      } else {
        if (status && !status.claude) throw new Error('Não achei o QR code na foto. Tente pela câmera ao vivo (botão “Ler QR code com a câmera”), com o QR bem iluminado e ocupando o quadrado.');
        setBusy('O Claude está lendo o comprovante…');
        const img = await compressImage(f);
        setData(await api<ReadReceiptResponse>('/api/notas/ler', { image: img.base64, mediaType: img.mediaType }));
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }

  async function fromQr(qr: string) {
    setErr(null); setBusy('Buscando a nota na SEFAZ…');
    try { setData(await api<ReadReceiptResponse>('/api/notas/ler', { qr })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }
  const fromLink = () => fromQr(qrToUrl(link) ?? link.trim());
  const [scanning, setScanning] = useState(false);

  if (data) return <Confirm data={data} onReset={() => setData(null)} />;

  return (
    <>
      <PageHeader title="Nota fiscal ou comprovante" back="/lancar" />
      <div className="card stack">
        <p>Aponte a câmera para o <strong>QR code do cupom fiscal</strong>: ele traz todos os itens e preços.</p>
        <button className="btn primary" disabled={!!busy} onClick={() => setScanning(true)}>{busy ?? 'Ler QR code com a câmera'}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) fromFile(f); e.target.value = ''; }} />
        <button className="btn" disabled={!!busy} onClick={() => fileRef.current?.click()}>Usar foto da galeria</button>
        {status && !status.claude && <p className="small muted">Sem o Claude configurado, só o QR code da NFC-e funciona.</p>}
      </div>
      <div className="card stack">
        <label className="field"><span>Ou cole o link do QR code</span><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.nfce.fazenda.sp.gov.br/…" /></label>
        <button className="btn" disabled={!!busy || !link.trim()} onClick={fromLink}>Buscar nota</button>
      </div>
      {err && <div className="card warn small">{err}</div>}
      {scanning && <QrScanner onClose={() => setScanning(false)} onResult={(qr) => { setScanning(false); fromQr(qr); }} />}
    </>
  );
}

function QrScanner({ onClose, onResult }: { onClose: () => void; onResult: (url: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState('Abrindo a câmera…');
  const [found, setFound] = useState<string | null>(null);
  const done = useRef(onResult);
  useEffect(() => { done.current = onResult; }, [onResult]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0, stopped = false, n = 0, last = 0;
    const canvas = document.createElement('canvas');
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setMsg('Este navegador não libera a câmera. Use “Usar foto da galeria”.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        setMsg(name === 'NotAllowedError' ? 'A câmera foi bloqueada. No iPhone: Ajustes › Apps › Safari › Câmera › Permitir, e abra o app de novo.' : 'Não consegui abrir a câmera.');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = videoRef.current!;
      v.srcObject = stream;
      v.setAttribute('playsinline', 'true');
      await v.play().catch(() => {});
      setMsg('Centralize o QR code no quadrado');
      const tick = (t: number) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (t - last < 120 || v.readyState < 2 || !v.videoWidth) return;
        last = t; n++;
        // alterna recortes: centro (rápido) e quadro inteiro (QR maior ou fora do centro)
        const plan: [number, number, boolean][] = [[0.7, 720, false], [0.5, 640, false], [1, 1000, n % 6 === 0]];
        const [crop, size, inv] = plan[n % plan.length];
        const raw = scanRegion(v, v.videoWidth, v.videoHeight, crop, size, canvas, inv);
        const url = raw ? qrToUrl(raw) : null;
        if (raw && !url) setMsg('Esse QR não é de nota fiscal (NFC-e).');
        if (url) {
          stopped = true;
          navigator.vibrate?.(80);
          setFound(url);
          stream?.getTracks().forEach((tr) => tr.stop());
          setTimeout(() => done.current(url), 250);
        }
      };
      raf = requestAnimationFrame(tick);
    }
    start();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Ler QR code">
      <video ref={videoRef} muted playsInline autoPlay />
      <div className={found ? 'scan-frame ok' : 'scan-frame'} />
      <div className="scan-bar">
        <span>{found ? 'QR lido! Buscando a nota…' : msg}</span>
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}

function Confirm({ data, onReset }: { data: ReadReceiptResponse; onReset: () => void }) {
  const { householdId, accounts, categories, members, me } = useApp();
  const [stock, setStock] = useState<StockItem[]>([]);
  const [kind, setKind] = useState<Kind>('PF');
  const [total, setTotal] = useState(data.total ? data.total.toFixed(2).replace('.', ',') : '');
  const [date, setDate] = useState(data.issuedOn ?? todayISO());
  const [method, setMethod] = useState(data.paymentMethod ?? 'credito');
  const [spentBy, setSpentBy] = useState(me?.user_id ?? '');
  const account = accounts.find((a) => a.kind === kind);
  const cats = categories.filter((c) => c.account_id === account?.id && c.tipo === 'despesa' && !c.archived);
  const suggested = cats.find((c) => c.name === data.suggestedCategory) ?? cats.find((c) => /supermercado/i.test(c.name));
  const [categoryId, setCategoryId] = useState(suggested?.id ?? '');
  const [choices, setChoices] = useState<PickChoice[]>(() => data.items.map(() => 'skip'));
  const [qtys, setQtys] = useState<number[]>(() => data.items.map((i) => i.qty || 1));
  const [newCat, setNewCat] = useState<StockItem['category'][]>(() => data.items.map(() => 'alimentos'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    supabase().from('stock_items').select('*').eq('household_id', householdId).eq('active', true).order('name').then(({ data: s }) => {
      if (!alive) return;
      const list = (s as StockItem[]) ?? [];
      setStock(list);
      setChoices(data.items.map((i) => matchStockItem(i.name, list) ?? 'skip'));
    });
    return () => { alive = false; };
  }, [householdId, data.items]);

  async function save() {
    const t = parseMoney(total);
    if (!t || Number.isNaN(t)) { setErr('Confira o valor total.'); return; }
    if (!account || !householdId) return;
    setBusy(true); setErr(null);
    const picks: StockPick[] = data.items.map((ri, idx) => {
      const c = choices[idx];
      if (c === 'skip') return null;
      return c === 'new'
        ? { receiptItem: ri, create: { name: ri.name.slice(0, 60), category: newCat[idx], unit: ri.unit?.toLowerCase() || 'un' }, qty: qtys[idx] }
        : { receiptItem: ri, itemId: c, qty: qtys[idx] };
    }).filter(Boolean) as StockPick[];
    try {
      const sb = supabase();
      const r = await saveReceipt(sb, {
        householdId, accountId: account.id, categoryId: categoryId || null, source: data.source, accessKey: data.accessKey,
        store: data.store, cnpj: data.cnpj, issuedOn: date, total: t, paymentMethod: method, spentBy: kind === 'PF' ? spentBy || null : null,
        items: data.items, picks,
      });
      const ids = picks.map((p) => p.itemId).filter(Boolean) as string[];
      if (ids.length) await sb.from('shopping_items').update({ checked: true }).eq('household_id', householdId).in('stock_item_id', ids);
      setDone(`Lançado ${money(t, true)}${r.stocked ? ` e ${r.stocked} item(ns) somados ao estoque` : ''}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  if (done) {
    return (
      <>
        <PageHeader title="Pronto" back="/lancar" />
        <div className="card soft stack"><span className="strong">{done}</span></div>
        <div className="row gap8"><button className="btn" onClick={onReset}>Ler outra nota</button><Link className="btn primary" href="/estoque">Ver estoque</Link></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Conferir nota" back="/lancar" />
      <div className="card dark stack">
        <span className="strong">{data.store ?? 'Loja não identificada'}</span>
        <span className="small muted">{data.source === 'nfce' ? 'NFC-e (SEFAZ)' : 'Lido pelo Claude'} · {data.items.length} itens</span>
      </div>
      <div className="card stack">
        <Segmented value={kind} onChange={(k) => { setKind(k); setCategoryId(''); }} options={[{ id: 'PF', label: 'Família (PF)' }, { id: 'PJ', label: 'Empresa (PJ)' }]} />
        <div className="grid2">
          <label className="field"><span>Total</span><input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
          <label className="field"><span>Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Pagamento</span><select value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label className="field"><span>Categoria</span><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        {kind === 'PF' && (
          <label className="field"><span>Quem</span><select value={spentBy} onChange={(e) => setSpentBy(e.target.value)}><option value="">Os dois</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></label>
        )}
      </div>

      {data.items.length > 0 && (
        <section className="stack" style={{ gap: 6 }}>
          <span className="small strong muted">ABASTECER O ESTOQUE</span>
          <div className="list">
            {data.items.map((ri, idx) => (
              <div key={idx} className="list-item" style={{ flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 160 }}>
                  <span className="strong small">{ri.name}</span>
                  <span className="small muted">{ri.qty} {ri.unit ?? ''}{ri.unitPrice ? ` · ${money(ri.unitPrice, true)}` : ''}</span>
                </div>
                <select aria-label={`Estoque para ${ri.name}`} value={choices[idx]} onChange={(e) => setChoices((c) => c.map((x, i) => (i === idx ? e.target.value : x)))} style={{ height: 38, borderRadius: 10, border: '1px solid var(--line)', maxWidth: 170 }}>
                  <option value="skip">Não controlar</option>
                  <option value="new">+ Novo item</option>
                  {stock.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {choices[idx] !== 'skip' && (
                  <input aria-label="Quantidade" type="number" min={0} step="0.5" value={qtys[idx]} onChange={(e) => setQtys((q) => q.map((x, i) => (i === idx ? Number(e.target.value) : x)))} style={{ width: 64, height: 38, borderRadius: 10, border: '1px solid var(--line)', padding: '0 8px' }} />
                )}
                {choices[idx] === 'new' && (
                  <select aria-label="Tipo do novo item" value={newCat[idx]} onChange={(e) => setNewCat((c) => c.map((x, i) => (i === idx ? (e.target.value as StockItem['category']) : x)))} style={{ height: 38, borderRadius: 10, border: '1px solid var(--line)' }}>
                    {STOCK_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
          <span className="small muted">Perecíveis (frutas, pão, carne) normalmente ficam em “Não controlar”.</span>
        </section>
      )}

      {err && <p className="error">{err}</p>}
      <button className="btn primary block" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Lançar gasto e atualizar estoque'}</button>
      <button className="btn block" onClick={onReset}>Cancelar</button>
    </>
  );
}

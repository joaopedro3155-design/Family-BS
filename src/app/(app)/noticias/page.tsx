'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Chips, Empty, PageHeader } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { api, useStatus } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { dayLabel } from '@/lib/format';
import { NEWS_LABELS } from '@/lib/types';

interface Item { titulo: string; resumo: string; fontes: { titulo: string; url: string }[] }
interface Digest { category: string; digest_date: string; items: Item[] }

function host(u: string) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

export default function Noticias() {
  const { householdId } = useApp();
  const status = useStatus();
  const [cat, setCat] = useState('principais');
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    supabase().from('news_digests').select('category,digest_date,items').eq('household_id', householdId).eq('category', cat)
      .order('digest_date', { ascending: false }).limit(1)
      .then(({ data }) => { if (alive) { setDigest(((data ?? [])[0] as Digest) ?? null); setLoaded(true); } });
    return () => { alive = false; };
  }, [householdId, cat, rev]);

  async function refresh() {
    setBusy(true); setErr(null);
    try { await api('/api/noticias/gerar', { category: cat }); setRev((r) => r + 1); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  return (
    <>
      <PageHeader title="Notícias" subtitle="Pesquisa do Claude, com fontes">
        <button className="icon-btn" aria-label="Preferências de notícias" onClick={() => setPrefsOpen(true)}><Icon name="gear" /></button>
      </PageHeader>
      <Chips value={cat} onChange={setCat} options={NEWS_LABELS} />

      {status && !status.claude && <div className="card warn small">As notícias são pesquisadas pelo Claude. Configure a chave da API (ANTHROPIC_API_KEY) para ativar.</div>}

      <div className="row between">
        <span className="small muted">{digest ? `Atualizado: ${dayLabel(digest.digest_date)}` : loaded ? 'Ainda sem resumo nesta categoria.' : ''}</span>
        {status?.claude && <button className="btn small" disabled={busy} onClick={refresh}>{busy ? 'Pesquisando… (até 1 min)' : 'Atualizar agora'}</button>}
      </div>
      {err && <p className="error">{err}</p>}

      <div className="stack">
        {loaded && (!digest || digest.items.length === 0) && <Empty>Os resumos saem automaticamente toda manhã. Você também pode tocar em “Atualizar agora”.</Empty>}
        {digest?.items.map((n, i) => (
          <article key={i} className={i === 0 ? 'card dark stack' : 'card stack'}>
            <h3 style={{ fontSize: i === 0 ? 19 : 16, lineHeight: 1.3 }}>{n.titulo}</h3>
            <p className={i === 0 ? '' : 'muted'} style={{ fontSize: 14 }}>{n.resumo}</p>
            <div className="row wrap gap8">
              {n.fontes.map((f) => (
                <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className="pill" style={i === 0 ? { background: 'rgba(255,255,255,.12)', color: '#5EEAD4' } : {}}>{host(f.url)}</a>
              ))}
            </div>
          </article>
        ))}
      </div>
      <p className="small muted">Resumos feitos por IA a partir das fontes listadas. Confira a matéria original antes de decidir algo importante.</p>

      {prefsOpen && <Prefs onClose={() => setPrefsOpen(false)} />}
    </>
  );
}

function Prefs({ onClose }: { onClose: () => void }) {
  const { householdId } = useApp();
  const [cats, setCats] = useState<string[]>(NEWS_LABELS.map((n) => n.id));
  const [city, setCity] = useState('Jundiaí');
  const [extra, setExtra] = useState('');
  useEffect(() => {
    if (!householdId) return;
    supabase().from('news_preferences').select('*').eq('household_id', householdId).maybeSingle().then(({ data }) => {
      if (!data) return;
      setCats(data.categories ?? []); setCity(data.city ?? 'Jundiaí'); setExtra(data.extra_topics ?? '');
    });
  }, [householdId]);
  async function save() {
    await supabase().from('news_preferences').upsert({ household_id: householdId, categories: cats, city, extra_topics: extra || null });
    onClose();
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Preferências de notícias" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>Notícias da família</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <div className="field"><span>Categorias do resumo diário</span>
          <div className="row wrap gap12">{NEWS_LABELS.map((n) => (
            <label key={n.id} className="check"><input type="checkbox" checked={cats.includes(n.id)} onChange={(e) => setCats((c) => e.target.checked ? [...c, n.id] : c.filter((x) => x !== n.id))} />{n.label}</label>
          ))}</div>
        </div>
        <label className="field"><span>Cidade (descontos e notícias locais)</span><input value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label className="field"><span>Interesses extras</span><textarea value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Ex.: time de futebol, protendido, revisão da vida toda do INSS…" /></label>
        <p className="small muted">Cada categoria é uma pesquisa por dia (custo da API do Claude por uso).</p>
        <button className="btn primary" onClick={save}>Salvar</button>
      </div>
    </div>
  );
}

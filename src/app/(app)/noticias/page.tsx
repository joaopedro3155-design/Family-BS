'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Chips, Empty, PageHeader } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { NEWS_FEEDS, type Headline } from '@/lib/rss';

const ALL = Object.keys(NEWS_FEEDS);

function ago(iso: string | null) {
  if (!iso) return '';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
}

export default function Noticias() {
  const { householdId } = useApp();
  const [cats, setCats] = useState<string[]>(ALL);
  const [city, setCity] = useState('Jundiaí');
  const [cat, setCat] = useState('principais');
  const [items, setItems] = useState<Headline[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    if (!householdId) return;
    supabase().from('news_preferences').select('categories,city').eq('household_id', householdId).maybeSingle().then(({ data }) => {
      if (!data) return;
      const c = ((data.categories as string[]) ?? []).filter((x) => NEWS_FEEDS[x]);
      // a categoria da cidade entra sempre que houver cidade
      setCats(c.length ? Array.from(new Set(['principais', ...c, 'jundiai'])) : ALL);
      if (data.city) setCity(data.city as string);
    });
  }, [householdId, rev]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/noticias?cat=${cat}&cidade=${encodeURIComponent(city)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) { setItems(j.items ?? []); setErr(j.error ?? null); } })
      .catch(() => { if (alive) { setItems([]); setErr('Sem conexão com as fontes agora.'); } });
    return () => { alive = false; };
  }, [cat, city, rev]);

  const label = (id: string) => NEWS_FEEDS[id].label.replace('{cidade}', city);

  return (
    <>
      <PageHeader title="Notícias" subtitle="Manchetes de fontes abertas, grátis">
        <button className="icon-btn" aria-label="Preferências de notícias" onClick={() => setPrefsOpen(true)}><Icon name="gear" /></button>
      </PageHeader>
      <Chips value={cat} onChange={(c) => { setItems(null); setCat(c); }} options={cats.filter((c) => NEWS_FEEDS[c]).map((c) => ({ id: c, label: label(c) }))} />
      {err && <div className="card warn small">{err}</div>}

      <div className="list">
        {items === null && <Empty>Carregando manchetes…</Empty>}
        {items?.length === 0 && <Empty>Nenhuma manchete agora nesta categoria.</Empty>}
        {items?.map((h, i) => (
          <a key={h.link + i} href={h.link} target="_blank" rel="noopener noreferrer" className="list-item" style={{ color: 'inherit', textDecoration: 'none', alignItems: 'flex-start' }}>
            <div className="grow">
              <span className="strong" style={{ lineHeight: 1.35 }}>{h.title}</span>
              <span className="small muted">{[h.source, ago(h.published)].filter(Boolean).join(' · ')}</span>
            </div>
          </a>
        ))}
      </div>
      <p className="small muted">Manchetes do Google Notícias, atualizadas a cada 30 minutos. Toque para ler na fonte original.</p>

      {prefsOpen && <Prefs city={city} cats={cats} onClose={() => { setPrefsOpen(false); setRev((r) => r + 1); }} />}
    </>
  );
}

function Prefs({ city: c0, cats: k0, onClose }: { city: string; cats: string[]; onClose: () => void }) {
  const { householdId } = useApp();
  const [cats, setCats] = useState<string[]>(k0);
  const [city, setCity] = useState(c0);
  async function save() {
    await supabase().from('news_preferences').upsert({ household_id: householdId, categories: cats, city: city.trim() || 'Jundiaí' });
    onClose();
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Preferências de notícias" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>Notícias da família</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <div className="field"><span>Categorias</span>
          <div className="row wrap gap12">{ALL.filter((id) => id !== 'principais' && id !== 'jundiai').map((id) => (
            <label key={id} className="check"><input type="checkbox" checked={cats.includes(id)} onChange={(e) => setCats((c) => e.target.checked ? [...c, id] : c.filter((x) => x !== id))} />{NEWS_FEEDS[id].label}</label>
          ))}</div>
        </div>
        <label className="field"><span>Cidade (notícias locais e descontos)</span><input value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <button className="btn primary" onClick={save}>Salvar</button>
      </div>
    </div>
  );
}

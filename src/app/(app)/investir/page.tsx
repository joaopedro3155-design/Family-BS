'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Empty, EyeButton, Money, PageHeader, Segmented } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { api, useStatus } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { dayLabel, parseMoney } from '@/lib/format';
import { ASSET_CLASSES } from '@/lib/types';
import { realRate, type Indicator } from '@/lib/bcb';
import type { Headline } from '@/lib/rss';
import type { Market } from '@/lib/market';
import { StockPanel, useWatchlist } from './carteiras';

interface Position { id: string; owner: string; broker: string; name: string; asset_class: string; amount: number; invested: number | null; rate: string | null; applied_at: string | null; liquidity: string | null; maturity: string | null; notes: string | null }

const DEFAULT_OWNERS = ['João Pedro', 'Kamila', 'Filha', 'Sogro'];
const LIQUIDITY = ['Diária', 'No vencimento', 'D+1 a D+30', 'Mais de 30 dias'];
const fmtDate = (d: string) => d.split('-').reverse().join('/');
interface Brief { week_start: string; content: { resumo: string; indicadores: { nome: string; valor: string; comentario: string }[]; carteira: string; ideias: { curto: string[]; medio: string[]; longo: string[] }; fontes: { titulo: string; url: string }[] } }

const label = (id: string) => ASSET_CLASSES.find((a) => a.id === id)?.label ?? id;
const color = (id: string) => ASSET_CLASSES.find((a) => a.id === id)?.color ?? '#475569';

export default function Investir() {
  const { householdId } = useApp();
  const status = useStatus();
  const [positions, setPositions] = useState<Position[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [risk, setRisk] = useState<'conservador' | 'moderado' | 'arrojado'>('moderado');
  const [goals, setGoals] = useState('');
  const [horizon, setHorizon] = useState<'curto' | 'medio' | 'longo'>('curto');
  const [editing, setEditing] = useState<Partial<Position> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [owner, setOwner] = useState('Todos');
  const [market, setMarket] = useState<Market>('BR');
  const watch = useWatchlist(householdId);
  const [rev, setRev] = useState(0);
  const reload = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    const sb = supabase();
    Promise.all([
      sb.from('portfolio_positions').select('*').eq('household_id', householdId).order('amount', { ascending: false }),
      sb.from('investment_briefs').select('week_start,content').eq('household_id', householdId).gt('week_start', '1900-01-01').order('week_start', { ascending: false }).limit(1),
      sb.from('investor_profile').select('*').eq('household_id', householdId).maybeSingle(),
    ]).then(([p, b, pr]) => {
      if (!alive) return;
      setPositions((p.data as Position[]) ?? []);
      setBrief(((b.data ?? [])[0] as Brief) ?? null);
      if (pr.data) { setRisk(pr.data.risk); setGoals(pr.data.goals ?? ''); }
    });
    return () => { alive = false; };
  }, [householdId, rev]);

  const owners = [...new Set([...DEFAULT_OWNERS, ...positions.map((p) => p.owner || 'João Pedro')])];
  const usedOwners = owners.filter((o) => positions.some((p) => (p.owner || 'João Pedro') === o));
  const shown = owner === 'Todos' ? positions : positions.filter((p) => (p.owner || 'João Pedro') === owner);
  const total = shown.reduce((s, p) => s + Number(p.amount), 0);
  const invested = shown.reduce((s, p) => s + Number(p.invested ?? p.amount), 0);
  const gain = total - invested;
  const ownerTotal = (o: string) => positions.filter((p) => (p.owner || 'João Pedro') === o).reduce((s, p) => s + Number(p.amount), 0);
  const newPosition = () => setEditing({ owner: owner === 'Todos' ? 'João Pedro' : owner, broker: 'XP', asset_class: 'renda_fixa', amount: 0 });
  const byClass = ASSET_CLASSES.map((a) => ({ ...a, v: shown.filter((p) => p.asset_class === a.id).reduce((s, p) => s + Number(p.amount), 0) })).filter((a) => a.v > 0);

  async function saveProfile(r = risk, g = goals) {
    await supabase().from('investor_profile').upsert({ household_id: householdId, risk: r, goals: g || null });
  }
  async function generate() {
    setBusy(true); setErr(null);
    try { await saveProfile(); await api('/api/investimentos/resumo', {}); reload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  return (
    <>
      <PageHeader title="Investimentos" subtitle="Carteira nacional e internacional">
        <EyeButton />
        {market === 'BR' && <button className="icon-btn" aria-label="Adicionar investimento" onClick={newPosition}><Icon name="plus" /></button>}
      </PageHeader>

      <Segmented value={market} onChange={setMarket} options={[{ id: 'BR', label: '🇧🇷 Nacional' }, { id: 'INT', label: '🌎 Internacional' }]} />
      <div style={{ height: 12 }} />

      {market === 'INT' && (watch.items ? <StockPanel market="INT" items={watch.items} save={watch.save} owners={owners} /> : <span className="small muted">Carregando…</span>)}
      {market === 'BR' && (<>

      {usedOwners.length > 0 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {['Todos', ...usedOwners].map((o) => (
            <button key={o} className={owner === o ? 'chip on' : 'chip'} onClick={() => setOwner(o)}>{o}</button>
          ))}
        </div>
      )}

      <div className="cols">
        <div className="stack">
          <div className="card dark stack">
            <span className="small strong muted">{owner === 'Todos' ? 'Total de todos os titulares' : `Investimentos de ${owner}`}</span>
            <span className="big"><Money v={total} /></span>
            {invested > 0 && Math.abs(gain) >= 0.01 && (
              <span className="small" style={{ color: gain >= 0 ? '#FDBA8C' : '#FCA5A5' }}>{gain >= 0 ? 'Rendeu ' : 'Perdeu '}<Money v={Math.abs(gain)} /> sobre <Money v={invested} /> aplicados</span>
            )}
            {owner === 'Todos' && usedOwners.length > 1 && (
              <div className="grid2 small">{usedOwners.map((o) => <span key={o}>{o}: <Money v={ownerTotal(o)} /></span>)}</div>
            )}
            {total > 0 && (
              <>
                <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
                  {byClass.map((a) => <div key={a.id} style={{ width: `${(a.v / total) * 100}%`, background: a.color }} />)}
                </div>
                <div className="grid2 small">
                  {byClass.map((a) => <span key={a.id} className="row gap8"><span className="dot" style={{ background: a.color }} />{a.label} {Math.round((a.v / total) * 100)}%</span>)}
                </div>
              </>
            )}
          </div>

          <section className="stack">
            <div className="row between"><h2>Investimentos</h2><button className="btn small" onClick={newPosition}><Icon name="plus" size={16} /> Adicionar</button></div>
            <div className="list">
              {shown.length === 0 && <Empty>Cadastre cada aplicação: de quem é, nome, tipo e valor. Atualize os valores pelo extrato quando quiser.</Empty>}
              {shown.map((p) => (
                <button key={p.id} className="list-item" style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--line2)', width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setEditing(p)}>
                  <span className="dot" style={{ background: color(p.asset_class) }} />
                  <span className="grow"><span className="strong">{p.name}</span><span className="small muted">{owner === 'Todos' ? `${p.owner || 'João Pedro'} · ` : ''}{label(p.asset_class)} · {p.broker}{p.rate ? ` · ${p.rate}` : ''}{p.maturity ? ` · vence ${fmtDate(p.maturity)}` : ''}</span></span>
                  <span className="strong"><Money v={Number(p.amount)} /></span>
                </button>
              ))}
            </div>
          </section>

          <section className="card stack">
            <h2>Perfil</h2>
            <Segmented value={risk} onChange={(r) => { setRisk(r); saveProfile(r, goals); }} options={[{ id: 'conservador', label: 'Conservador' }, { id: 'moderado', label: 'Moderado' }, { id: 'arrojado', label: 'Arrojado' }]} />
            <label className="field"><span>Objetivos</span><textarea value={goals} onChange={(e) => setGoals(e.target.value)} onBlur={() => saveProfile()} placeholder="Ex.: reserva de 6 meses, entrada de imóvel em 3 anos, faculdade da filha" /></label>
          </section>
        </div>

        <div className="stack">
          {watch.items && <StockPanel market="BR" items={watch.items} save={watch.save} owners={owners} />}
          <div className="row between">
            <h2>{status && !status.claude ? 'Mercado hoje' : 'Resumo da semana'}</h2>
            {status?.claude && <button className="btn small" disabled={busy} onClick={generate}>{busy ? 'Pesquisando…' : brief ? 'Refazer' : 'Gerar agora'}</button>}
          </div>
          {status && !status.claude && <FreeBrief risk={risk} />}
          {err && <p className="error">{err}</p>}
          {status?.claude && !brief && <Empty>O resumo sai automaticamente toda segunda de manhã.</Empty>}
          {brief && (
            <>
              <div className="card stack">
                <span className="small muted">Semana de {dayLabel(brief.week_start)}</span>
                <p>{brief.content.resumo}</p>
              </div>
              {brief.content.indicadores?.length > 0 && (
                <div className="grid2">
                  {brief.content.indicadores.slice(0, 6).map((i) => (
                    <div key={i.nome} className="card stack" style={{ padding: 12, gap: 2 }}>
                      <span className="small muted strong">{i.nome}</span>
                      <span className="mid">{i.valor}</span>
                      <span className="small muted">{i.comentario}</span>
                    </div>
                  ))}
                </div>
              )}
              {brief.content.carteira && <div className="card soft small">{brief.content.carteira}</div>}
              <div className="stack" style={{ gap: 8 }}>
                <span className="small strong muted">IDEIAS PARA ESTUDAR</span>
                <Segmented value={horizon} onChange={setHorizon} options={[{ id: 'curto', label: 'Curto prazo' }, { id: 'medio', label: 'Médio prazo' }, { id: 'longo', label: 'Longo prazo' }]} />
                <div className="list">
                  {(brief.content.ideias?.[horizon] ?? []).map((t, i) => <div key={i} className="list-item small">{t}</div>)}
                </div>
              </div>
              {brief.content.fontes?.length > 0 && (
                <div className="row wrap gap8">{brief.content.fontes.map((f) => <a key={f.url} className="pill" href={f.url} target="_blank" rel="noopener noreferrer">{f.titulo || f.url}</a>)}</div>
              )}
              <p className="small muted">Conteúdo educativo feito por IA a partir de fontes públicas. Não é recomendação de investimento: confirme com seu assessor antes de aplicar. O Claude recebe só os percentuais da carteira, nunca os valores.</p>
            </>
          )}
        </div>
      </div>

      {editing && <PositionSheet value={editing} owners={owners} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      </>)}
    </>
  );
}

function PositionSheet({ value, owners, onClose, onSaved }: { value: Partial<Position>; owners: string[]; onClose: () => void; onSaved: () => void }) {
  const { householdId } = useApp();
  const [v, setV] = useState(value);
  const [amount, setAmount] = useState(value.amount ? String(value.amount).replace('.', ',') : '');
  const [inv, setInv] = useState(value.invested ? String(value.invested).replace('.', ',') : '');
  const [newOwner, setNewOwner] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Position>) => setV((o) => ({ ...o, ...p }));
  async function save() {
    const a = parseMoney(amount);
    const i = inv.trim() ? parseMoney(inv) : null;
    if (!v.owner?.trim()) { setErr('Informe de quem é o investimento.'); return; }
    if (!v.name?.trim() || Number.isNaN(a) || (i !== null && Number.isNaN(i))) { setErr('Preencha nome e valor.'); return; }
    const row = { household_id: householdId, owner: v.owner.trim(), broker: v.broker || 'XP', name: v.name.trim(), asset_class: v.asset_class, amount: a, invested: i, rate: v.rate?.trim() || null, applied_at: v.applied_at || null, liquidity: v.liquidity || null, maturity: v.maturity || null, notes: v.notes?.trim() || null, updated_at: new Date().toISOString() };
    const sb = supabase();
    const { error } = v.id ? await sb.from('portfolio_positions').update(row).eq('id', v.id) : await sb.from('portfolio_positions').insert(row);
    if (error) { setErr(error.message); return; }
    onSaved();
  }
  async function remove() {
    if (!v.id || !confirm('Apagar este investimento?')) return;
    await supabase().from('portfolio_positions').delete().eq('id', v.id);
    onSaved();
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Posição" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{v.id ? 'Editar investimento' : 'Novo investimento'}</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <div className="field"><span>De quem é</span>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {owners.map((o) => <button key={o} type="button" className={!newOwner && v.owner === o ? 'chip on' : 'chip'} onClick={() => { setNewOwner(false); set({ owner: o }); }}>{o}</button>)}
            <button type="button" className={newOwner ? 'chip on' : 'chip'} onClick={() => { setNewOwner(true); set({ owner: '' }); }}>+ Outra pessoa</button>
          </div>
          {newOwner && <input autoFocus value={v.owner ?? ''} onChange={(e) => set({ owner: e.target.value })} placeholder="Nome (ex.: nome da filha, sogro)" />}
        </div>
        <label className="field"><span>Nome do investimento</span><input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="CDB Banco X 110% CDI, Tesouro IPCA+ 2035…" /></label>
        <div className="grid2">
          <label className="field"><span>Tipo</span><select value={v.asset_class} onChange={(e) => set({ asset_class: e.target.value })}>{ASSET_CLASSES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          <label className="field"><span>Corretora / banco</span><input value={v.broker ?? 'XP'} onChange={(e) => set({ broker: e.target.value })} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Valor aplicado</span><input inputMode="decimal" value={inv} onChange={(e) => setInv(e.target.value)} placeholder="Opcional" /></label>
          <label className="field"><span>Valor atual</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Rentabilidade</span><input value={v.rate ?? ''} onChange={(e) => set({ rate: e.target.value })} placeholder="110% CDI, IPCA+6%…" /></label>
          <label className="field"><span>Liquidez</span><select value={v.liquidity ?? ''} onChange={(e) => set({ liquidity: e.target.value })}><option value="">—</option>{LIQUIDITY.map((l) => <option key={l}>{l}</option>)}</select></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Data da aplicação</span><input type="date" value={v.applied_at ?? ''} onChange={(e) => set({ applied_at: e.target.value })} /></label>
          <label className="field"><span>Vencimento</span><input type="date" value={v.maturity ?? ''} onChange={(e) => set({ maturity: e.target.value })} /></label>
        </div>
        <label className="field"><span>Observações</span><textarea value={v.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="Ex.: reserva da faculdade, resgatar só em 2030" /></label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary" onClick={save}>Salvar</button>
        {v.id && <button className="btn danger" onClick={remove}><Icon name="trash" size={16} /> Apagar</button>}
      </div>
    </div>
  );
}

const IDEAS: Record<'curto' | 'medio' | 'longo', Record<'conservador' | 'moderado' | 'arrojado', string[]>> = {
  curto: {
    conservador: ['Reserva de emergência (6 meses de gastos) em Tesouro Selic ou CDB com liquidez diária de banco grande.', 'Para gastos de até 1 ano, CDB/LCI com vencimento antes da data de uso.'],
    moderado: ['Reserva de emergência em Tesouro Selic ou CDB com liquidez diária.', 'LCI/LCA (isentas de IR) para valores que não serão usados nos próximos meses.'],
    arrojado: ['Mesmo arrojado, a reserva de emergência fica em renda fixa com liquidez diária.', 'Compare a rentabilidade líquida de CDBs com o CDI atual antes de aplicar.'],
  },
  medio: {
    conservador: ['Tesouro Prefixado ou IPCA+ com vencimento alinhado à meta (ex.: carro, mudança).', 'CDBs de prazo médio cobertos pelo FGC, respeitando o limite por banco.'],
    moderado: ['Tesouro IPCA+ para proteger da inflação metas de 2 a 5 anos.', 'Uma parcela pequena em fundos imobiliários diversificados.'],
    arrojado: ['Combinação de títulos IPCA+ com fundos imobiliários e multimercados.', 'Rebalancear a carteira a cada 6 meses.'],
  },
  longo: {
    conservador: ['Tesouro IPCA+ longo (aposentadoria) e previdência com taxa baixa.', 'Avaliar PGBL x VGBL conforme a declaração de IR.'],
    moderado: ['Aportes mensais em ETFs de ações e fundos imobiliários, sem tentar acertar o momento.', 'Previdência privada se fizer sentido no IR de cada um.'],
    arrojado: ['Parcela maior em ações/ETFs (inclusive exterior), com aportes regulares.', 'Manter disciplina: não vender em quedas por impulso.'],
  },
};

function FreeBrief({ risk }: { risk: 'conservador' | 'moderado' | 'arrojado' }) {
  const [ind, setInd] = useState<Indicator[] | null>(null);
  const [news, setNews] = useState<Headline[]>([]);
  const [horizon, setHorizon] = useState<'curto' | 'medio' | 'longo'>('curto');
  useEffect(() => {
    let alive = true;
    fetch('/api/indicadores').then((r) => r.json()).then((j) => { if (alive) setInd(j.items ?? []); }).catch(() => { if (alive) setInd([]); });
    fetch('/api/noticias?cat=financas').then((r) => r.json()).then((j) => { if (alive) setNews((j.items ?? []).slice(0, 5)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const cdi = ind?.find((i) => i.nome === 'CDI')?.valor;
  const ipca = ind?.find((i) => i.nome.startsWith('IPCA'))?.valor;
  const fmt = (i: Indicator) => i.unidade === 'R$' ? `R$ ${i.valor.toFixed(2).replace('.', ',')}` : `${i.valor.toFixed(2).replace('.', ',')}%`;
  return (
    <>
      <div className="grid2">
        {ind === null && <span className="small muted">Carregando indicadores…</span>}
        {ind?.map((i) => (
          <div key={i.nome} className="card stack" style={{ padding: 12, gap: 2 }}>
            <span className="small muted strong">{i.nome}</span>
            <span className="mid">{fmt(i)}</span>
            <span className="small muted">{i.dica}</span>
          </div>
        ))}
      </div>
      {cdi !== undefined && ipca !== undefined && (
        <div className="card soft small">Uma aplicação a 100% do CDI rende hoje cerca de <strong>{realRate(cdi, ipca).toFixed(1).replace('.', ',')}% ao ano acima da inflação</strong> (antes do IR).</div>
      )}
      <div className="stack" style={{ gap: 8 }}>
        <span className="small strong muted">IDEIAS PARA ESTUDAR · PERFIL {risk.toUpperCase()}</span>
        <Segmented value={horizon} onChange={setHorizon} options={[{ id: 'curto', label: 'Curto prazo' }, { id: 'medio', label: 'Médio prazo' }, { id: 'longo', label: 'Longo prazo' }]} />
        <div className="list">{IDEAS[horizon][risk].map((t) => <div key={t} className="list-item small">{t}</div>)}</div>
      </div>
      {news.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small strong muted">NOTÍCIAS DE FINANÇAS</span>
          <div className="list">{news.map((h) => (
            <a key={h.link} href={h.link} target="_blank" rel="noopener noreferrer" className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="grow"><span className="small strong">{h.title}</span><span className="small muted">{h.source}</span></span>
            </a>
          ))}</div>
        </div>
      )}
      <p className="small muted">Indicadores oficiais do Banco Central. As ideias são educativas e gerais, não uma recomendação: confirme com seu assessor antes de aplicar.</p>
    </>
  );
}

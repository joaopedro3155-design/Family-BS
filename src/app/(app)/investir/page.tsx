'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Empty, EyeButton, Money, PageHeader, Segmented } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { api, useStatus } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { dayLabel, parseMoney } from '@/lib/format';
import { ASSET_CLASSES } from '@/lib/types';

interface Position { id: string; broker: string; name: string; asset_class: string; amount: number; maturity: string | null; notes: string | null }
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
  const [rev, setRev] = useState(0);
  const reload = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    const sb = supabase();
    Promise.all([
      sb.from('portfolio_positions').select('*').eq('household_id', householdId).order('amount', { ascending: false }),
      sb.from('investment_briefs').select('week_start,content').eq('household_id', householdId).order('week_start', { ascending: false }).limit(1),
      sb.from('investor_profile').select('*').eq('household_id', householdId).maybeSingle(),
    ]).then(([p, b, pr]) => {
      if (!alive) return;
      setPositions((p.data as Position[]) ?? []);
      setBrief(((b.data ?? [])[0] as Brief) ?? null);
      if (pr.data) { setRisk(pr.data.risk); setGoals(pr.data.goals ?? ''); }
    });
    return () => { alive = false; };
  }, [householdId, rev]);

  const total = positions.reduce((s, p) => s + Number(p.amount), 0);
  const byClass = ASSET_CLASSES.map((a) => ({ ...a, v: positions.filter((p) => p.asset_class === a.id).reduce((s, p) => s + Number(p.amount), 0) })).filter((a) => a.v > 0);

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
      <PageHeader title="Investimentos" subtitle="Carteira XP e resumo semanal">
        <EyeButton />
        <button className="icon-btn" aria-label="Adicionar posição" onClick={() => setEditing({ broker: 'XP', asset_class: 'renda_fixa', amount: 0 })}><Icon name="plus" /></button>
      </PageHeader>

      <div className="cols">
        <div className="stack">
          <div className="card dark stack">
            <span className="small strong muted">Patrimônio investido</span>
            <span className="big"><Money v={total} /></span>
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
            <h2>Posições</h2>
            <div className="list">
              {positions.length === 0 && <Empty>Cadastre suas aplicações da XP (nome, tipo e valor). Atualize os valores quando quiser, pelo extrato.</Empty>}
              {positions.map((p) => (
                <button key={p.id} className="list-item" style={{ background: 'none', border: 'none', borderBottom: '1px solid var(--line2)', width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setEditing(p)}>
                  <span className="dot" style={{ background: color(p.asset_class) }} />
                  <span className="grow"><span className="strong">{p.name}</span><span className="small muted">{label(p.asset_class)} · {p.broker}{p.maturity ? ` · vence ${p.maturity.split('-').reverse().join('/')}` : ''}</span></span>
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
          <div className="row between">
            <h2>Resumo da semana</h2>
            {status?.claude && <button className="btn small" disabled={busy} onClick={generate}>{busy ? 'Pesquisando…' : brief ? 'Refazer' : 'Gerar agora'}</button>}
          </div>
          {status && !status.claude && <div className="card warn small">O resumo semanal é pesquisado pelo Claude. Configure a chave da API para ativar.</div>}
          {err && <p className="error">{err}</p>}
          {!brief && <Empty>O resumo sai automaticamente toda segunda de manhã.</Empty>}
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

      {editing && <PositionSheet value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function PositionSheet({ value, onClose, onSaved }: { value: Partial<Position>; onClose: () => void; onSaved: () => void }) {
  const { householdId } = useApp();
  const [v, setV] = useState(value);
  const [amount, setAmount] = useState(value.amount ? String(value.amount).replace('.', ',') : '');
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Position>) => setV((o) => ({ ...o, ...p }));
  async function save() {
    const a = parseMoney(amount);
    if (!v.name?.trim() || Number.isNaN(a)) { setErr('Preencha nome e valor.'); return; }
    const row = { household_id: householdId, broker: v.broker || 'XP', name: v.name.trim(), asset_class: v.asset_class, amount: a, maturity: v.maturity || null, notes: v.notes || null, updated_at: new Date().toISOString() };
    const sb = supabase();
    const { error } = v.id ? await sb.from('portfolio_positions').update(row).eq('id', v.id) : await sb.from('portfolio_positions').insert(row);
    if (error) { setErr(error.message); return; }
    onSaved();
  }
  async function remove() {
    if (!v.id || !confirm('Apagar esta posição?')) return;
    await supabase().from('portfolio_positions').delete().eq('id', v.id);
    onSaved();
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Posição" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{v.id ? 'Editar posição' : 'Nova posição'}</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <label className="field"><span>Nome</span><input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="CDB Banco X 110% CDI, Tesouro IPCA+ 2035…" /></label>
        <div className="grid2">
          <label className="field"><span>Tipo</span><select value={v.asset_class} onChange={(e) => set({ asset_class: e.target.value })}>{ASSET_CLASSES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          <label className="field"><span>Valor atual</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Corretora</span><input value={v.broker ?? 'XP'} onChange={(e) => set({ broker: e.target.value })} /></label>
          <label className="field"><span>Vencimento</span><input type="date" value={v.maturity ?? ''} onChange={(e) => set({ maturity: e.target.value })} /></label>
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn primary" onClick={save}>Salvar</button>
        {v.id && <button className="btn danger" onClick={remove}><Icon name="trash" size={16} /> Apagar</button>}
      </div>
    </div>
  );
}

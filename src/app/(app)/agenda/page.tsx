'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Chips, Empty, PageHeader, LocationLink, Segmented } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { dayLabel, timeLabel, todayISO } from '@/lib/format';
import { EVENT_CATEGORIES, type EventItem } from '@/lib/types';
import { fetchOccurrences, setDone, type Occurrence } from '@/lib/events-db';
import { RECURRENCES, nextOccurrence, recurrenceLabel, type Recurrence } from '@/lib/recurrence';

const WD = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const REMINDERS = [
  { m: 1440, label: '1 dia antes' },
  { m: 60, label: '1 hora antes' },
  { m: 30, label: '30 min antes' },
  { m: 10, label: '10 min antes' },
];

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}
function localDay(ts: string) {
  return todayISO(new Date(ts));
}
const CBS = 'cbs';
const CBS_COLOR = '#9C6644';
function daysUntil(iso: string) {
  const n = Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${todayISO()}T12:00:00`).getTime()) / 86400000);
  return n === 0 ? 'hoje' : n === 1 ? 'amanhã' : n < 0 ? `há ${-n} dias` : `em ${n} dias`;
}

export default function Agenda() {
  const { householdId, members, memberName, accounts, me } = useApp();
  const cbsName = accounts.find((a) => a.kind === 'PJ')?.name ?? 'Empresa';
  const [mode, setMode] = useState<'semana' | 'lista'>('semana');
  const [view, setView] = useState<'agenda' | 'recorrentes'>('agenda');
  const [upcoming, setUpcoming] = useState<Occurrence[]>([]);
  const [series, setSeries] = useState<EventItem[]>([]);
  const [selected, setSelected] = useState(todayISO());
  const [weekStart, setWeekStart] = useState(() => {
    const t = todayISO();
    const wd = new Date(`${t}T12:00:00`).getDay();
    return addDays(t, -((wd + 6) % 7)); // segunda
  });
  const [who, setWho] = useState<string>('all');
  const [events, setEvents] = useState<Occurrence[]>([]);
  const [editing, setEditing] = useState<Partial<EventItem> | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const [rev, setRev] = useState(0);
  const load = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    const start = new Date(`${days[0]}T00:00:00`).toISOString();
    const end = new Date(`${days[6]}T23:59:59`).toISOString();
    fetchOccurrences(supabase(), householdId, start, end).then((data) => { if (alive) setEvents(data); });
    return () => { alive = false; };
  }, [householdId, days, rev]);

  // lista das próximas datas da empresa (a partir de hoje, sem depender da semana)
  useEffect(() => {
    if (!householdId || mode !== 'lista') return;
    let alive = true;
    const start = new Date(`${todayISO()}T00:00:00`).toISOString();
    const end = new Date(Date.now() + 365 * 86400000).toISOString();
    fetchOccurrences(supabase(), householdId, start, end, { company: who === CBS ? true : who === 'all' ? undefined : false, limit: 300 }).then((data) => { if (alive) setUpcoming(data); });
    return () => { alive = false; };
  }, [householdId, who, mode, rev]);

  // todas as séries que se repetem
  useEffect(() => {
    if (!householdId || view !== 'recorrentes') return;
    let alive = true;
    supabase().from('events').select('*').eq('household_id', householdId).neq('recurrence', 'none').order('title')
      .then(({ data }) => { if (alive) setSeries((data as EventItem[]) ?? []); });
    return () => { alive = false; };
  }, [householdId, view, rev]);

  async function toggleDone(e: Occurrence) {
    await setDone(supabase(), e.id, e.occ, !e.done);
    const flip = (l: Occurrence[]) => l.map((x) => (x.id === e.id && x.occ === e.occ ? { ...x, done: !e.done } : x));
    setEvents(flip); setUpcoming(flip);
  }

  const matchWho = (e: EventItem) => who === 'all' || (who === CBS ? e.company : !e.company && (e.owner_user === who || e.owner_user === null));
  const visible = events.filter(matchWho);
  const ofDay = visible.filter((e) => localDay(e.starts_at) === selected);
  const color = (e: Pick<EventItem, 'owner_user' | 'company'>) => (e.company ? CBS_COLOR : e.owner_user ? members.find((m) => m.user_id === e.owner_user)?.color ?? '#E8590C' : '#E8590C');
  const ownerLabel = (e: EventItem) => (e.company ? cbsName : memberName(e.owner_user));
  const showList = mode === 'lista';
  // repetição: abre a série original (a data de início é a primeira ocorrência)
  const openEvent = async (e: EventItem) => {
    let src = e;
    if (e.recurrence && e.recurrence !== 'none') {
      const { data } = await supabase().from('events').select('*').eq('id', e.id).single();
      if (data) src = data as EventItem;
    }
    setEditing({ ...src, starts_at: toLocalInput(src.starts_at), ends_at: src.ends_at ? toLocalInput(src.ends_at) : null });
  };
  const newItem = (extra: Partial<EventItem> = {}) => setEditing({
    ...(who === CBS
      ? { starts_at: `${showList ? todayISO() : selected}T09:00`, reminders: [1440, 60], category: 'entrega', owner_user: me?.user_id ?? null, company: true }
      : { starts_at: `${selected}T09:00`, reminders: [1440, 60], category: 'pessoal', owner_user: who !== 'all' ? who : null, company: false }),
    recurrence: 'none', recurrence_interval: 1, recurrence_until: null, is_task: false, ...extra,
  });
  const card = (e: Occurrence, timeText: string) => (
    <div key={`${e.id}-${e.occ}`} className="event" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => openEvent(e)}>
      <span className="time">{timeText}</span>
      <span className={e.done ? 'body done' : 'body'} style={{ background: `${color(e)}1A` }}>
        <span className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
          <span className="strong" style={{ color: color(e), ...(e.done ? { textDecoration: 'line-through', opacity: 0.6 } : {}) }}>{e.title}</span>
          <button className={e.done ? 'done-check on' : 'done-check'} aria-label={e.done ? 'Desfazer conclusão' : 'Concluir'} title={e.done ? 'Desfazer' : 'Concluir'} onClick={(ev) => { ev.stopPropagation(); toggleDone(e); }}>✓</button>
        </span>
        <span className="small">{ownerLabel(e)} · {e.is_task ? 'Tarefa' : EVENT_CATEGORIES.find((c) => c.id === e.category)?.label}{e.recurrence !== 'none' ? ' · ↻' : ''}{e.done ? ' · concluído' : ''}</span>
        {e.location && <LocationLink location={e.location} />}
      </span>
    </div>
  );
  const byDate = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    for (const e of upcoming.filter(matchWho)) { const d = localDay(e.starts_at); m.set(d, [...(m.get(d) ?? []), e]); }
    return Array.from(m.entries());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming, who]);

  return (
    <>
      <PageHeader title="Agenda">
        <button className="btn primary small" onClick={() => (view === 'recorrentes' ? newItem({ recurrence: 'weekly', is_task: true, starts_at: `${todayISO()}T09:00` }) : newItem())}>
          <Icon name="plus" size={16} /> {view === 'recorrentes' ? 'Recorrente' : 'Compromisso'}
        </button>
      </PageHeader>

      <Segmented value={view} onChange={setView} options={[{ id: 'agenda', label: 'Agenda' }, { id: 'recorrentes', label: 'Tarefas recorrentes' }]} />

      <Chips value={who} onChange={setWho} options={[{ id: 'all', label: 'Todos' }, ...members.map((m) => ({ id: m.user_id, label: m.display_name.split(' ')[0] })), { id: CBS, label: cbsName }]} />

      {view === 'recorrentes' ? (
        <div className="stack" style={{ gap: 8 }}>
          {series.filter(matchWho).length === 0 && <Empty>Nada se repetindo ainda. Toque em “+ Recorrente” para criar, por exemplo, “Trocar filtro da água · todo mês” ou “Pagar diarista · toda sexta”.</Empty>}
          {series.filter(matchWho).map((e) => {
            const next = nextOccurrence(e);
            const nd = next ? localDay(next) : null;
            return (
              <div key={e.id} className="event" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => openEvent(e)}>
                <span className="time" style={{ fontSize: 20 }}>↻</span>
                <span className="body" style={{ background: `${color(e)}1A` }}>
                  <span className="strong" style={{ color: color(e) }}>{e.title}</span>
                  <span className="small">{recurrenceLabel(e)} · {timeLabel(e.starts_at)}</span>
                  <span className="small muted">{ownerLabel(e)} · {e.is_task ? 'Tarefa' : EVENT_CATEGORIES.find((c) => c.id === e.category)?.label}{nd ? ` · próxima ${dayLabel(nd).toLowerCase()} (${daysUntil(nd)})` : ' · encerrada'}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : (<>
      <Segmented value={mode} onChange={setMode} options={[{ id: 'semana', label: 'Semana' }, { id: 'lista', label: 'Lista (próximas datas)' }]} />

      {showList ? (
        <div className="stack" style={{ gap: 14 }}>
          {byDate.length === 0 && <Empty>{who === CBS ? `Nenhuma entrega ou compromisso da ${cbsName} pela frente.` : 'Nenhum compromisso pela frente.'}</Empty>}
          {byDate.map(([d, list]) => (
            <div key={d} className="stack" style={{ gap: 8 }}>
              <div className="row between"><span className="small strong muted">{dayLabel(d).toUpperCase()}</span><span className="pill">{daysUntil(d)}</span></div>
              {list.map((e) => card(e, timeLabel(e.starts_at)))}
            </div>
          ))}
        </div>
      ) : (<>
      <div className="card stack" style={{ padding: '12px 8px' }}>
        <div className="row between" style={{ padding: '0 8px' }}>
          <button className="link-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Semana anterior</button>
          <button className="link-btn" onClick={() => { const t = todayISO(); setSelected(t); const wd = new Date(`${t}T12:00:00`).getDay(); setWeekStart(addDays(t, -((wd + 6) % 7))); }}>Hoje</button>
          <button className="link-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}>Próxima ›</button>
        </div>
        <div className="week">
          {days.map((d) => {
            const dayEvents = visible.filter((e) => localDay(e.starts_at) === d);
            const owners = Array.from(new Set(dayEvents.map((e) => color(e)))).slice(0, 3);
            return (
              <button key={d} className={d === selected ? 'day on' : 'day'} onClick={() => setSelected(d)} aria-pressed={d === selected}>
                <span className="wd">{WD[new Date(`${d}T12:00:00`).getDay()]}</span>
                <span className="n">{Number(d.slice(8))}</span>
                <span className="dots">{owners.map((o) => <span key={o} style={{ background: o }} />)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <span className="small strong muted">{dayLabel(selected).toUpperCase()}</span>
      <div className="stack" style={{ gap: 8 }}>
        {ofDay.length === 0 && <Empty>Nenhum compromisso neste dia.</Empty>}
        {ofDay.map((e) => card(e, timeLabel(e.starts_at)))}
      </div>
      </>)}
      </>)}

      {editing && <EventSheet value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function toLocalInput(ts: string) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function EventSheet({ value, onClose, onSaved }: { value: Partial<EventItem>; onClose: () => void; onSaved: () => void }) {
  const { householdId, members, accounts, me } = useApp();
  const cbsName = accounts.find((a) => a.kind === 'PJ')?.name ?? 'Empresa';
  const [v, setV] = useState<Partial<EventItem>>(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<EventItem>) => setV((o) => ({ ...o, ...patch }));

  async function save() {
    if (!v.title || !v.starts_at) { setErr('Preencha título e horário.'); return; }
    setBusy(true); setErr(null);
    const row = {
      household_id: householdId,
      title: v.title,
      notes: v.notes || null,
      location: v.location || null,
      starts_at: new Date(v.starts_at).toISOString(),
      ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null,
      owner_user: v.owner_user ?? null,
      company: v.company ?? false,
      category: v.category ?? 'pessoal',
      reminders: v.reminders ?? [],
      recurrence: v.recurrence ?? 'none',
      recurrence_interval: Math.max(1, Number(v.recurrence_interval) || 1),
      recurrence_until: v.recurrence && v.recurrence !== 'none' ? v.recurrence_until || null : null,
      is_task: v.is_task ?? false,
    };
    const sb = supabase();
    const { error } = v.id ? await sb.from('events').update(row).eq('id', v.id) : await sb.from('events').insert(row);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (v.id) await sb.from('event_notifications').delete().eq('event_id', v.id);
    onSaved();
  }

  async function remove() {
    if (!v.id || !confirm(v.recurrence && v.recurrence !== 'none' ? 'Apagar todas as repetições?' : 'Apagar este compromisso?')) return;
    await supabase().from('events').delete().eq('id', v.id);
    onSaved();
  }

  const toggleRem = (m: number) => {
    const r = new Set(v.reminders ?? []);
    if (r.has(m)) r.delete(m); else r.add(m);
    set({ reminders: Array.from(r).sort((a, b) => b - a) });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Compromisso" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{v.id ? 'Editar compromisso' : 'Novo compromisso'}</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <label className="field"><span>Título</span><input value={v.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder={v.company ? 'Entrega do projeto estrutural – Cliente X' : 'Reunião com cliente'} /></label>
        <div className="grid2">
          <label className="field"><span>Início</span><input type="datetime-local" value={v.starts_at ?? ''} onChange={(e) => set({ starts_at: e.target.value })} /></label>
          <label className="field"><span>Fim (opcional)</span><input type="datetime-local" value={v.ends_at ?? ''} onChange={(e) => set({ ends_at: e.target.value })} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>De quem</span>
            <select value={v.company ? CBS : v.owner_user ?? ''} onChange={(e) => {
              const x = e.target.value;
              if (x === CBS) set({ company: true, owner_user: me?.user_id ?? null, category: v.category === 'pessoal' ? 'entrega' : v.category });
              else set({ company: false, owner_user: x || null });
            }}>
              <option value="">Os dois</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
              <option value={CBS}>{cbsName}</option>
            </select>
          </label>
          <label className="field"><span>Tipo</span>
            <select value={v.category ?? 'pessoal'} onChange={(e) => set({ category: e.target.value as EventItem['category'] })}>
              {EVENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={v.is_task ?? false} onChange={(e) => set({ is_task: e.target.checked })} />É uma tarefa (marcar como feita)</label>
        <div className="grid2">
          <label className="field"><span>Repetir</span>
            <select value={v.recurrence ?? 'none'} onChange={(e) => set({ recurrence: e.target.value as Recurrence })}>
              {RECURRENCES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          {v.recurrence && v.recurrence !== 'none' ? (
            <label className="field"><span>A cada</span>
              <div className="row gap8"><input type="number" min={1} max={99} inputMode="numeric" style={{ width: 70 }} value={v.recurrence_interval ?? 1} onChange={(e) => set({ recurrence_interval: Number(e.target.value) || 1 })} /><span className="small">{(v.recurrence_interval ?? 1) > 1 ? RECURRENCES.find((r) => r.id === v.recurrence)?.plural : RECURRENCES.find((r) => r.id === v.recurrence)?.every}</span></div>
            </label>
          ) : <span />}
        </div>
        {v.recurrence && v.recurrence !== 'none' && (
          <>
            <label className="field"><span>Repetir até (opcional)</span><input type="date" value={v.recurrence_until ?? ''} onChange={(e) => set({ recurrence_until: e.target.value || null })} /></label>
            <p className="small muted">{v.starts_at ? recurrenceLabel({ starts_at: new Date(v.starts_at).toISOString(), recurrence: v.recurrence, recurrence_interval: v.recurrence_interval, recurrence_until: v.recurrence_until }) : ''}{v.id ? ' · alterar aqui muda todas as repetições' : ''}</p>
          </>
        )}
        <label className="field"><span>Local ou link</span><input value={v.location ?? ''} onChange={(e) => set({ location: e.target.value })} placeholder="Endereço (abre no Waze/Maps) ou link da reunião" /></label>
        <div className="field"><span>Lembretes</span>
          <div className="row wrap gap12">{REMINDERS.map((r) => <label key={r.m} className="check"><input type="checkbox" checked={(v.reminders ?? []).includes(r.m)} onChange={() => toggleRem(r.m)} />{r.label}</label>)}</div>
        </div>
        <label className="field"><span>Observações</span><textarea value={v.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
        {v.id && <button className="btn danger" onClick={remove}><Icon name="trash" size={16} /> Apagar</button>}
      </div>
    </div>
  );
}

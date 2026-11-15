'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Chips, Empty, PageHeader } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { dayLabel, timeLabel, todayISO } from '@/lib/format';
import { EVENT_CATEGORIES, type EventItem } from '@/lib/types';

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

export default function Agenda() {
  const { householdId, members, memberName } = useApp();
  const [selected, setSelected] = useState(todayISO());
  const [weekStart, setWeekStart] = useState(() => {
    const t = todayISO();
    const wd = new Date(`${t}T12:00:00`).getDay();
    return addDays(t, -((wd + 6) % 7)); // segunda
  });
  const [who, setWho] = useState<string>('all');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [editing, setEditing] = useState<Partial<EventItem> | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const [rev, setRev] = useState(0);
  const load = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    const start = new Date(`${days[0]}T00:00:00`).toISOString();
    const end = new Date(`${days[6]}T23:59:59`).toISOString();
    supabase().from('events').select('*').eq('household_id', householdId).gte('starts_at', start).lte('starts_at', end).order('starts_at')
      .then(({ data }) => { if (alive) setEvents((data as EventItem[]) ?? []); });
    return () => { alive = false; };
  }, [householdId, days, rev]);

  const visible = events.filter((e) => who === 'all' || e.owner_user === who || e.owner_user === null);
  const ofDay = visible.filter((e) => localDay(e.starts_at) === selected);
  const color = (uid: string | null) => (uid ? members.find((m) => m.user_id === uid)?.color ?? '#0F766E' : '#0F766E');

  return (
    <>
      <PageHeader title="Agenda">
        <button className="btn primary small" onClick={() => setEditing({ starts_at: `${selected}T09:00`, reminders: [1440, 60], category: 'pessoal', owner_user: null })}>
          <Icon name="plus" size={16} /> Compromisso
        </button>
      </PageHeader>

      <Chips value={who} onChange={setWho} options={[{ id: 'all', label: 'Todos' }, ...members.map((m) => ({ id: m.user_id, label: m.display_name.split(' ')[0] }))]} />

      <div className="card stack" style={{ padding: '12px 8px' }}>
        <div className="row between" style={{ padding: '0 8px' }}>
          <button className="link-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Semana anterior</button>
          <button className="link-btn" onClick={() => { const t = todayISO(); setSelected(t); const wd = new Date(`${t}T12:00:00`).getDay(); setWeekStart(addDays(t, -((wd + 6) % 7))); }}>Hoje</button>
          <button className="link-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}>Próxima ›</button>
        </div>
        <div className="week">
          {days.map((d) => {
            const dayEvents = visible.filter((e) => localDay(e.starts_at) === d);
            const owners = Array.from(new Set(dayEvents.map((e) => e.owner_user ?? 'both'))).slice(0, 3);
            return (
              <button key={d} className={d === selected ? 'day on' : 'day'} onClick={() => setSelected(d)} aria-pressed={d === selected}>
                <span className="wd">{WD[new Date(`${d}T12:00:00`).getDay()]}</span>
                <span className="n">{Number(d.slice(8))}</span>
                <span className="dots">{owners.map((o) => <span key={o} style={{ background: o === 'both' ? '#0F766E' : color(o) }} />)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <span className="small strong muted">{dayLabel(selected).toUpperCase()}</span>
      <div className="stack" style={{ gap: 8 }}>
        {ofDay.length === 0 && <Empty>Nenhum compromisso neste dia.</Empty>}
        {ofDay.map((e) => (
          <button key={e.id} className="event" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setEditing({ ...e, starts_at: toLocalInput(e.starts_at), ends_at: e.ends_at ? toLocalInput(e.ends_at) : null })}>
            <span className="time">{timeLabel(e.starts_at)}</span>
            <span className="body" style={{ background: `${color(e.owner_user)}1A` }}>
              <span className="strong" style={{ color: color(e.owner_user) }}>{e.title}</span>
              <span className="small">{memberName(e.owner_user)} · {EVENT_CATEGORIES.find((c) => c.id === e.category)?.label}{e.location ? ` · ${e.location}` : ''}</span>
            </span>
          </button>
        ))}
      </div>

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
  const { householdId, members } = useApp();
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
      category: v.category ?? 'pessoal',
      reminders: v.reminders ?? [],
    };
    const sb = supabase();
    const { error } = v.id ? await sb.from('events').update(row).eq('id', v.id) : await sb.from('events').insert(row);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (v.id) await sb.from('event_notifications').delete().eq('event_id', v.id);
    onSaved();
  }

  async function remove() {
    if (!v.id || !confirm('Apagar este compromisso?')) return;
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
        <label className="field"><span>Título</span><input value={v.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="Reunião com cliente" /></label>
        <div className="grid2">
          <label className="field"><span>Início</span><input type="datetime-local" value={v.starts_at ?? ''} onChange={(e) => set({ starts_at: e.target.value })} /></label>
          <label className="field"><span>Fim (opcional)</span><input type="datetime-local" value={v.ends_at ?? ''} onChange={(e) => set({ ends_at: e.target.value })} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>De quem</span>
            <select value={v.owner_user ?? ''} onChange={(e) => set({ owner_user: e.target.value || null })}>
              <option value="">Os dois</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
          </label>
          <label className="field"><span>Tipo</span>
            <select value={v.category ?? 'pessoal'} onChange={(e) => set({ category: e.target.value as EventItem['category'] })}>
              {EVENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>Local ou link</span><input value={v.location ?? ''} onChange={(e) => set({ location: e.target.value })} /></label>
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

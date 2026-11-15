'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp } from './AppProvider';
import { Icon } from './Icons';
import { money } from '@/lib/format';

export function EyeButton() {
  const { showValues, toggleValues } = useApp();
  return (
    <button className="icon-btn" onClick={toggleValues} aria-label={showValues ? 'Ocultar valores' : 'Mostrar valores'} aria-pressed={showValues}>
      <Icon name={showValues ? 'eye' : 'eyeOff'} />
    </button>
  );
}

export function Money({ v }: { v: number | null | undefined }) {
  const { showValues } = useApp();
  return <>{money(v, showValues)}</>;
}

export function PageHeader({ title, subtitle, back, children }: { title: string; subtitle?: string; back?: string; children?: React.ReactNode }) {
  return (
    <header className="page-header">
      {back && (
        <Link href={back} className="icon-btn" aria-label="Voltar"><Icon name="back" /></Link>
      )}
      <div className="page-title">
        {subtitle && <span className="muted small">{subtitle}</span>}
        <h1>{title}</h1>
      </div>
      <div className="row gap8">{children}</div>
    </header>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'chip on' : 'chip'} onClick={() => onChange(o.id)} aria-pressed={value === o.id}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ pct, warnAt = 90, warn }: { pct: number; warnAt?: number; warn?: boolean }) {
  const cls = (warn ?? pct >= warnAt) ? 'bar-fill warn' : 'bar-fill';
  return <div className="bar"><div className={cls} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function SoonPage({ title, phase, items }: { title: string; phase: string; items: string[] }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="card stack">
        <span className="pill">{phase}</span>
        <p>Esta aba entra numa próxima fase. O que ela vai ter:</p>
        <ul className="list-plain">{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </div>
    </>
  );
}

/** Endereço vira atalho para Waze/Maps; link abre direto no navegador. */
export function asUrl(loc: string): string | null {
  const t = loc.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t) || /^(meet\.google|zoom\.us|teams\.microsoft|teams\.live)\S*$/i.test(t)) return `https://${t}`;
  return null;
}

export function LocationLink({ location }: { location: string }) {
  const [open, setOpen] = useState(false);
  const url = asUrl(location);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="loc-link" onClick={stop}>
        <Icon name="link" size={15} /><span>{url.replace(/^https?:\/\//, '').slice(0, 40)}</span>
      </a>
    );
  }
  const q = encodeURIComponent(location.trim());
  return (
    <span className="loc-wrap" onClick={stop}>
      <button type="button" className="loc-link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="pin" size={15} /><span>{location}</span>
      </button>
      {open && (
        <span className="loc-menu">
          <a href={`https://waze.com/ul?q=${q}&navigate=yes`} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Waze</a>
          <a href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Google Maps</a>
          <a href={`https://maps.apple.com/?q=${q}`} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Apple Mapas</a>
        </span>
      )}
    </span>
  );
}

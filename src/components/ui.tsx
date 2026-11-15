'use client';
import Link from 'next/link';
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

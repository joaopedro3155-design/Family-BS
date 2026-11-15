'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { Icon, type IconName } from './Icons';
import { supabase } from '@/lib/supabase';

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Hoje', icon: 'home' },
  { href: '/agenda', label: 'Agenda', icon: 'calendar' },
  { href: '/financas', label: 'Finanças', icon: 'wallet' },
  { href: '/estoque', label: 'Estoque', icon: 'box' },
  { href: '/investir', label: 'Investir', icon: 'trend' },
  { href: '/noticias', label: 'Notícias', icon: 'news' },
];

// No celular cabem 4 abas + "Mais"; o resto fica no menu Mais.
const MOBILE_TABS = TABS.slice(0, 4);
const MORE: { href: string; label: string; icon: IconName }[] = [
  { href: '/investir', label: 'Investir', icon: 'trend' },
  { href: '/noticias', label: 'Notícias', icon: 'news' },
  { href: '/ajustes', label: 'Ajustes', icon: 'gear' },
];

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path.startsWith(href);
}

export function AppGate({ children }: { children: React.ReactNode }) {
  const { status, error } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed-out') router.replace('/entrar');
  }, [status, router]);

  if (status === 'loading' || status === 'signed-out') return <div className="center-screen"><div className="spinner" aria-label="Carregando" /></div>;
  if (status === 'error') return <div className="center-screen"><div className="card stack" style={{ maxWidth: 420 }}><h2>Não consegui conectar</h2><p className="muted">{error}</p></div></div>;
  if (status === 'onboarding') return <Onboarding />;
  return <Shell>{children}</Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { householdName } = useApp();
  const [more, setMore] = useState(false);
  const moreOn = MORE.some((m) => path.startsWith(m.href));
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="logo">BS</span><span>Family BS</span></div>
        <nav aria-label="Menu">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={isActive(path, t.href) ? 'side-link on' : 'side-link'}>
              <Icon name={t.icon} /> {t.label}
            </Link>
          ))}
          <Link href="/ajustes" className={path.startsWith('/ajustes') ? 'side-link on' : 'side-link'}><Icon name="gear" /> Ajustes</Link>
        </nav>
        <span className="muted small side-foot">{householdName}</span>
      </aside>
      <main className="content">{children}</main>
      {!path.startsWith('/lancar') && (
        <Link href="/lancar" className="fab" aria-label="Lançar gasto"><Icon name="plus" size={26} /></Link>
      )}
      <nav className="tabbar" aria-label="Abas">
        {MOBILE_TABS.map((t) => (
          <Link key={t.href} href={t.href} className={isActive(path, t.href) ? 'tab on' : 'tab'}>
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </Link>
        ))}
        <button type="button" className={moreOn ? 'tab on' : 'tab'} onClick={() => setMore(true)} aria-label="Mais opções">
          <Icon name="more" size={22} />
          <span>Mais</span>
        </button>
      </nav>
      {more && (
        <div className="sheet-backdrop" onClick={() => setMore(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Mais" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><h2>Mais</h2><button className="link-btn" onClick={() => setMore(false)}>Fechar</button></div>
            <div className="list">
              {MORE.map((m) => (
                <Link key={m.href} href={m.href} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }} onClick={() => setMore(false)}>
                  <Icon name={m.icon} /> <span className="grow strong">{m.label}</span>
                </Link>
              ))}
            </div>
            <span className="small muted">{householdName}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Onboarding() {
  const { reload, session } = useApp();
  const [family, setFamily] = useState('Família BS');
  const [name, setName] = useState('João Pedro');
  const [pj, setPj] = useState('CBS Engenharia');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    const { error } = await supabase().rpc('create_household', { p_family_name: family, p_display_name: name, p_pj_name: pj });
    if (error) { setErr(error.message); setBusy(false); return; }
    await reload();
  }

  return (
    <div className="center-screen">
      <div className="card stack" style={{ maxWidth: 440, width: '100%' }}>
        <div className="brand"><span className="logo">BS</span><span>Family BS</span></div>
        <h2>Criar a família</h2>
        <p className="muted small">Você entrou como {session?.user.email}. Se a Kamila já criou a família e convidou este e-mail, peça o convite em Ajustes e entre de novo.</p>
        <label className="field"><span>Nome da família</span><input value={family} onChange={(e) => setFamily(e.target.value)} /></label>
        <label className="field"><span>Seu nome</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Empresa (conta PJ)</span><input value={pj} onChange={(e) => setPj(e.target.value)} /></label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary" disabled={busy} onClick={create}>{busy ? 'Criando…' : 'Criar família'}</button>
      </div>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { EyeButton, Money, PageHeader, Segmented } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { supabase } from '@/lib/supabase';
import { parseMoney } from '@/lib/format';
import { sortGroups, type Category, type Kind } from '@/lib/types';

export default function Categorias() {
  const { accounts, categories, householdId, reloadCategories } = useApp();
  const [kind, setKind] = useState<Kind>('PF');
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const account = accounts.find((a) => a.kind === kind);
  const list = categories.filter((c) => c.account_id === account?.id);
  const groups = sortGroups(list.map((c) => (c.tipo === 'receita' ? 'Receitas' : c.grupo || 'Outros')));
  const inGroup = (g: string) => list.filter((c) => (c.tipo === 'receita' ? 'Receitas' : c.grupo || 'Outros') === g).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  async function renameGroup(g: string) {
    const n = prompt(`Novo nome para a categoria “${g}”:`, g)?.trim();
    if (!n || n === g || !account) return;
    await supabase().from('categories').update({ grupo: n }).eq('account_id', account.id).eq('grupo', g);
    await reloadCategories();
  }

  return (
    <>
      <PageHeader title="Categorias e limites" back="/financas">
        <EyeButton />
      </PageHeader>
      <Segmented value={kind} onChange={setKind} options={[{ id: 'PF', label: 'Família (PF)' }, { id: 'PJ', label: 'Empresa (PJ)' }]} />
      <p className="muted small">Como na planilha: cada <strong>categoria</strong> (Moradia, Alimentação, Pet…) tem suas <strong>subcategorias</strong> (Aluguel, Luz, Água…). Os gastos de João e Kamila usam as mesmas da família. Coloque um limite mensal na subcategoria para receber aviso em 80% e 100%.</p>
      <button className="btn primary" onClick={() => setEditing({ account_id: account?.id, tipo: 'despesa', grupo: '', name: '' })}><Icon name="plus" size={16} /> Nova categoria</button>

      {groups.map((g) => (
        <section key={g} className="stack" style={{ gap: 6 }}>
          <div className="row between">
            <span className="strong">{g}</span>
            <span className="row gap8">
              {g !== 'Receitas' && <button className="link-btn small" onClick={() => renameGroup(g)}>Renomear</button>}
              <button className="link-btn small" onClick={() => setEditing({ account_id: account?.id, tipo: g === 'Receitas' ? 'receita' : 'despesa', grupo: g === 'Receitas' ? 'Receitas' : g, name: '' })}>+ subcategoria</button>
            </span>
          </div>
          <div className="list">
            {inGroup(g).map((c) => (
              <div key={c.id} className="list-item" style={{ opacity: c.archived ? 0.5 : 1 }}>
                <div className="grow">
                  <span className="strong">{c.name}</span>
                  <span className="small muted">{c.tipo === 'receita' ? 'Receita' : 'Despesa'}{c.monthly_limit ? <> · limite <Money v={c.monthly_limit} /></> : ''}{c.archived ? ' · arquivada' : ''}</span>
                </div>
                <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label={`Editar ${c.name}`} onClick={() => setEditing(c)}><Icon name="edit" size={16} /></button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {editing && (
        <CategorySheet
          value={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSave={async (c) => {
            const sb = supabase();
            const row = { household_id: householdId, account_id: c.account_id, name: c.name, grupo: c.grupo || 'Outros', tipo: c.tipo, monthly_limit: c.monthly_limit, archived: c.archived ?? false };
            const { error } = c.id ? await sb.from('categories').update(row).eq('id', c.id) : await sb.from('categories').insert(row);
            if (error) return error.message;
            await reloadCategories();
            setEditing(null);
            return null;
          }}
        />
      )}
    </>
  );
}

function CategorySheet({ value, groups, onClose, onSave }: { value: Partial<Category>; groups: string[]; onClose: () => void; onSave: (c: Partial<Category>) => Promise<string | null> }) {
  const [v, setV] = useState(value);
  const [limit, setLimit] = useState(value.monthly_limit ? String(value.monthly_limit).replace('.', ',') : '');
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<Category>) => setV((o) => ({ ...o, ...p }));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Categoria" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{v.id ? 'Editar subcategoria' : v.grupo ? `Nova subcategoria em ${v.grupo}` : 'Nova categoria'}</h2><button className="link-btn" onClick={onClose}>Fechar</button></div>
        <label className="field"><span>Categoria</span><input list="grupos" value={v.grupo ?? ''} onChange={(e) => set({ grupo: e.target.value })} placeholder="Ex.: Moradia, Pet, Viagem" /></label>
        <label className="field"><span>Subcategoria</span><input value={v.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Aluguel, Banho, Hotel" /></label>
        <datalist id="grupos">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <Segmented value={v.tipo ?? 'despesa'} onChange={(t) => set({ tipo: t })} options={[{ id: 'despesa', label: 'Despesa' }, { id: 'receita', label: 'Receita' }]} />
        {v.tipo !== 'receita' && <label className="field"><span>Limite mensal (opcional)</span><input inputMode="decimal" placeholder="Ex.: 600,00" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>}
        {v.id && <label className="check"><input type="checkbox" checked={!!v.archived} onChange={(e) => set({ archived: e.target.checked })} />Arquivar (esconde dos lançamentos novos)</label>}
        {err && <p className="error">{err}</p>}
        <button className="btn primary" onClick={async () => {
          if (!v.grupo?.trim()) { setErr('Informe a categoria.'); return; }
          if (!v.name?.trim()) { setErr('Informe a subcategoria.'); return; }
          const l = limit.trim() ? parseMoney(limit) : null;
          if (l !== null && Number.isNaN(l)) { setErr('Limite inválido.'); return; }
          const e = await onSave({ ...v, grupo: v.tipo === 'receita' ? 'Receitas' : v.grupo.trim(), name: v.name.trim(), monthly_limit: v.tipo === 'receita' ? null : l });
          if (e) setErr(e);
        }}>Salvar</button>
      </div>
    </div>
  );
}

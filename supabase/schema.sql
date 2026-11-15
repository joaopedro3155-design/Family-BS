-- =====================================================================
-- Family BS — banco de dados (Supabase / Postgres)
-- Rode este arquivo inteiro no Supabase: SQL Editor → New query → Run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Família e membros ----------
create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Família',
  created_at timestamptz not null default now()
);

create table if not exists members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  color text not null default '#1D4ED8',
  role text not null default 'membro' check (role in ('admin', 'membro')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  email text not null,
  display_name text not null,
  color text not null default '#C2410C',
  created_at timestamptz not null default now(),
  unique (household_id, email)
);

-- ---------- Finanças ----------
-- kind PF = conta da família (João + Kamila juntos); PJ = empresa (CBS Engenharia)
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('PF', 'PJ')),
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  grupo text not null default 'Outros',
  name text not null,
  tipo text not null default 'despesa' check (tipo in ('receita', 'despesa')),
  monthly_limit numeric(12,2),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, tipo, name)
);

create table if not exists recurring_bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  tipo text not null default 'despesa' check (tipo in ('receita', 'despesa')),
  amount numeric(12,2),
  variable boolean not null default false,
  frequency text not null default 'mensal' check (frequency in ('mensal', 'anual')),
  due_day int check (due_day between 1 and 31),
  due_month int check (due_month between 1 and 12),
  remind_days_before int not null default 3,
  active boolean not null default true,
  last_notified_on date,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  tipo text not null check (tipo in ('receita', 'despesa')),
  amount numeric(12,2) not null check (amount > 0),
  occurred_on date not null,
  description text,
  payment_method text check (payment_method in ('credito', 'debito', 'pix', 'dinheiro', 'boleto', 'transferencia')),
  installments int not null default 1 check (installments >= 1),
  installment_no int not null default 1,
  installment_group uuid,
  spent_by uuid references auth.users(id) on delete set null,
  recurring_id uuid references recurring_bills(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'importacao', 'recorrente', 'mensagem', 'nota_fiscal', 'open_finance')),
  is_profit_transfer boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists transactions_month_idx on transactions (household_id, occurred_on);

-- ---------- Agenda ----------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  notes text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  owner_user uuid references auth.users(id) on delete set null, -- null = os dois
  category text not null default 'pessoal' check (category in ('cliente', 'escritorio', 'casa', 'pessoal', 'familia')),
  reminders int[] not null default '{1440,60}', -- minutos antes
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists events_start_idx on events (household_id, starts_at);

create table if not exists event_notifications (
  event_id uuid not null references events(id) on delete cascade,
  minutes_before int not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, minutes_before)
);

-- ---------- Notificações ----------
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists limit_alerts (
  category_id uuid not null references categories(id) on delete cascade,
  month date not null,
  threshold int not null,
  sent_at timestamptz not null default now(),
  primary key (category_id, month, threshold)
);

-- ---------- Integrações (pausadas) ----------
create table if not exists integrations (
  household_id uuid primary key references households(id) on delete cascade,
  open_finance_enabled boolean not null default false, -- Pluggy/Belvo: PAUSADO
  claude_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- Segurança: cada família só enxerga os próprios dados
-- =====================================================================
create or replace function is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','recurring_bills','transactions','events','push_subscriptions','invites','integrations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists family_all on %I', t);
    execute format('create policy family_all on %I for all using (is_member(household_id)) with check (is_member(household_id))', t);
  end loop;
end $$;

alter table households enable row level security;
drop policy if exists family_read on households;
create policy family_read on households for select using (is_member(id));
drop policy if exists family_update on households;
create policy family_update on households for update using (is_member(id));

alter table members enable row level security;
drop policy if exists family_read on members;
create policy family_read on members for select using (is_member(household_id));
drop policy if exists self_update on members;
create policy self_update on members for update using (user_id = auth.uid());

alter table event_notifications enable row level security;
alter table limit_alerts enable row level security;
-- (só o servidor, com a chave de serviço, mexe nessas duas)

-- =====================================================================
-- Funções de cadastro
-- =====================================================================

-- Cria a família, as contas PF e PJ e as categorias iniciais
create or replace function create_household(
  p_family_name text, p_display_name text, p_pj_name text default 'CBS Engenharia'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid; pf uuid; pj uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    select household_id into h from members where user_id = auth.uid() limit 1;
    return h;
  end if;
  insert into households(name) values (p_family_name) returning id into h;
  insert into members(household_id, user_id, display_name, color, role)
    values (h, auth.uid(), p_display_name, '#1D4ED8', 'admin');
  insert into accounts(household_id, name, kind) values (h, 'Família', 'PF') returning id into pf;
  insert into accounts(household_id, name, kind) values (h, p_pj_name, 'PJ') returning id into pj;
  insert into integrations(household_id) values (h);

  insert into categories(household_id, account_id, grupo, name, tipo, monthly_limit) values
    (h, pf, 'Receitas', 'Salário Fixo João', 'receita', null),
    (h, pf, 'Receitas', 'Salário Fixo Kamila', 'receita', null),
    (h, pf, 'Receitas', 'Lucro ' || p_pj_name, 'receita', null),
    (h, pf, 'Moradia', 'Aluguel', 'despesa', null),
    (h, pf, 'Moradia', 'Luz', 'despesa', null),
    (h, pf, 'Moradia', 'Água', 'despesa', null),
    (h, pf, 'Moradia', 'Gás', 'despesa', null),
    (h, pf, 'Alimentação', 'Supermercado', 'despesa', null),
    (h, pf, 'Alimentação', 'Feira / Padaria', 'despesa', null),
    (h, pf, 'Alimentação', 'Açougue', 'despesa', null),
    (h, pf, 'Lazer', 'Restaurantes', 'despesa', 600),
    (h, pf, 'Alimentação', 'Ifood/app', 'despesa', null),
    (h, pf, 'Transporte', 'Combustível', 'despesa', null),
    (h, pf, 'Transporte', 'Estacionamento/Sem Parar', 'despesa', null),
    (h, pf, 'Transporte', 'Táxi / Uber', 'despesa', null),
    (h, pf, 'Saúde', 'Exames / farmácia', 'despesa', null),
    (h, pf, 'Outros', 'Presentes', 'despesa', null),
    (h, pj, 'Receitas', 'Projetos de Concreto Armado', 'receita', null),
    (h, pj, 'Receitas', 'Projetos de Estrutura Metálica', 'receita', null),
    (h, pj, 'Receitas', 'Laudos Técnicos / ATP', 'receita', null),
    (h, pj, 'Receitas', 'Projeto Hidrossanitário', 'receita', null),
    (h, pj, 'Despesas gerais', 'Contador', 'despesa', null),
    (h, pj, 'Despesas gerais', 'Pró-labore', 'despesa', null),
    (h, pj, 'Despesas gerais', 'Simples Nacional', 'despesa', null),
    (h, pj, 'Despesas gerais', 'Distribuição de lucro', 'despesa', null)
  on conflict do nothing;
  return h;
end $$;

-- Convidado (ex.: Kamila) entra na família ao fazer login com o e-mail convidado
create or replace function accept_invite() returns uuid
language plpgsql security definer set search_path = public as $$
declare inv invites; em text;
begin
  select email into em from auth.users where id = auth.uid();
  select * into inv from invites where lower(email) = lower(em) limit 1;
  if inv.id is null then return null; end if;
  insert into members(household_id, user_id, display_name, color, role)
    values (inv.household_id, auth.uid(), inv.display_name, inv.color, 'membro')
    on conflict do nothing;
  delete from invites where id = inv.id;
  return inv.household_id;
end $$;

grant execute on function create_household(text, text, text) to authenticated;
grant execute on function accept_invite() to authenticated;

-- =====================================================================
-- Family BS — Fase 2 (rode DEPOIS do schema.sql)
-- Estoque, lista de compras, notas fiscais, notícias, investimentos,
-- Telegram e agenda no calendário do iPhone.
-- =====================================================================

-- ---------- Estoque ----------
create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  category text not null default 'alimentos' check (category in ('alimentos', 'higiene', 'casa', 'bebe', 'pet', 'outros')),
  unit text not null default 'un',
  quantity numeric(10,2) not null default 0,         -- quantidade na última atualização
  quantity_updated_at timestamptz not null default now(),
  daily_usage numeric(10,4),                         -- consumo estimado por dia (calculado)
  min_days int not null default 5,                   -- avisar quando faltar isso de dias
  aliases text[] not null default '{}',              -- nomes como aparecem na nota (ex.: "CAFE PILAO 500G")
  last_price numeric(10,2),
  last_store text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  item_id uuid not null references stock_items(id) on delete cascade,
  delta numeric(10,2) not null,
  kind text not null check (kind in ('compra', 'consumo', 'ajuste', 'acabou')),
  unit_price numeric(10,2),
  store text,
  receipt_id uuid,
  occurred_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists stock_movements_item_idx on stock_movements (item_id, occurred_at);

-- ---------- Notas fiscais / comprovantes ----------
create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  source text not null check (source in ('nfce', 'foto', 'telegram')),
  access_key text,                 -- chave da NFC-e (44 dígitos)
  store_name text,
  store_cnpj text,
  city text,
  issued_on date,
  total numeric(12,2),
  payment_method text,
  items jsonb not null default '[]', -- [{name, qty, unit, unit_price, total}]
  transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, access_key)
);

-- histórico de preços (vem das notas): base para "onde está mais barato"
create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  item_key text not null,          -- nome normalizado
  item_name text not null,
  store text not null,
  unit_price numeric(10,2) not null,
  observed_on date not null,
  receipt_id uuid references receipts(id) on delete cascade
);
create index if not exists price_history_key_idx on price_history (household_id, item_key, observed_on);

-- ---------- Lista de compras ----------
create table if not exists shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  quantity text,
  stock_item_id uuid references stock_items(id) on delete set null,
  checked boolean not null default false,
  urgent boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'estoque')),
  created_at timestamptz not null default now()
);

-- ---------- Notícias (pesquisadas pelo Claude) ----------
create table if not exists news_digests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  category text not null,
  digest_date date not null,
  items jsonb not null default '[]', -- [{titulo, resumo, fontes:[{titulo,url}]}]
  created_at timestamptz not null default now(),
  unique (household_id, category, digest_date)
);

create table if not exists news_preferences (
  household_id uuid primary key references households(id) on delete cascade,
  categories text[] not null default '{principais,financas,descontos,engenharia,direito,politica,esportes}',
  city text not null default 'Jundiaí',
  region text not null default 'São Paulo',
  extra_topics text
);

-- ---------- Investimentos ----------
create table if not exists portfolio_positions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  broker text not null default 'XP',
  name text not null,
  asset_class text not null default 'renda_fixa' check (asset_class in ('reserva', 'renda_fixa', 'fii', 'acoes', 'previdencia', 'cripto', 'outros')),
  amount numeric(14,2) not null default 0,
  maturity date,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists investment_briefs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  week_start date not null,
  content jsonb not null,           -- {resumo, indicadores, ideias:{curto,medio,longo}, fontes}
  created_at timestamptz not null default now(),
  unique (household_id, week_start)
);

create table if not exists investor_profile (
  household_id uuid primary key references households(id) on delete cascade,
  risk text not null default 'moderado' check (risk in ('conservador', 'moderado', 'arrojado')),
  goals text
);

-- ---------- Telegram ----------
create table if not exists telegram_links (
  chat_id bigint primary key,
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now()
);

create table if not exists telegram_codes (
  code text primary key,
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

-- ---------- Agenda no calendário do iPhone / resumo diário ----------
alter table households add column if not exists ics_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
alter table households add column if not exists last_digest_on date;

-- ---------- Segurança ----------
do $$
declare t text;
begin
  foreach t in array array['stock_items','stock_movements','receipts','price_history','shopping_items','news_digests','news_preferences','portfolio_positions','investment_briefs','investor_profile','telegram_links','telegram_codes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists family_all on %I', t);
    execute format('create policy family_all on %I for all using (is_member(household_id)) with check (is_member(household_id))', t);
  end loop;
end $$;

-- preferências padrão para famílias já criadas
insert into news_preferences (household_id) select id from households on conflict do nothing;
insert into investor_profile (household_id) select id from households on conflict do nothing;

-- famílias novas já nascem com as preferências
create or replace function household_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into news_preferences (household_id) values (new.id) on conflict do nothing;
  insert into investor_profile (household_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists household_defaults_trg on households;
create trigger household_defaults_trg after insert on households for each row execute function household_defaults();

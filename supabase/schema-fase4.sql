-- Fase 4: agenda da empresa (CBS Engenharia) e tipo "Entrega de projeto"
alter table events add column if not exists company boolean not null default false;
alter table events drop constraint if exists events_category_check;
alter table events add constraint events_category_check check (category in ('cliente', 'escritorio', 'casa', 'pessoal', 'familia', 'entrega'));
create index if not exists events_company_idx on events (household_id, company, starts_at);

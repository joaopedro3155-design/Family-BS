-- Fase 5: compromissos e tarefas recorrentes (dia, semana, mês, ano)
alter table events add column if not exists recurrence text not null default 'none';
alter table events drop constraint if exists events_recurrence_check;
alter table events add constraint events_recurrence_check check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly'));
alter table events add column if not exists recurrence_interval int not null default 1;
alter table events add column if not exists recurrence_until date;
alter table events add column if not exists is_task boolean not null default false;
create index if not exists events_recurring_idx on events (household_id, recurrence) where recurrence <> 'none';

-- tarefa feita em uma data (cada ocorrência é marcada separadamente)
create table if not exists event_done (
  event_id uuid not null references events(id) on delete cascade,
  occurs_on date not null,
  done_by uuid default auth.uid(),
  done_at timestamptz not null default now(),
  primary key (event_id, occurs_on)
);
alter table event_done enable row level security;
drop policy if exists event_done_member on event_done;
create policy event_done_member on event_done for all
  using (exists (select 1 from events e where e.id = event_id and is_member(e.household_id)))
  with check (exists (select 1 from events e where e.id = event_id and is_member(e.household_id)));

-- lembretes: um aviso por ocorrência
alter table event_notifications add column if not exists occurs_at timestamptz;
update event_notifications n set occurs_at = e.starts_at from events e where e.id = n.event_id and n.occurs_at is null;
delete from event_notifications where occurs_at is null;
alter table event_notifications alter column occurs_at set not null;
alter table event_notifications drop constraint if exists event_notifications_pkey;
alter table event_notifications add primary key (event_id, minutes_before, occurs_at);

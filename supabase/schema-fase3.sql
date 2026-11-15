-- Fase 3: dono (titular) e mais detalhes de cada investimento
alter table portfolio_positions add column if not exists owner text not null default 'João Pedro';
alter table portfolio_positions add column if not exists invested numeric(14,2);
alter table portfolio_positions add column if not exists rate text;
alter table portfolio_positions add column if not exists applied_at date;
alter table portfolio_positions add column if not exists liquidity text;
create index if not exists portfolio_positions_owner on portfolio_positions (household_id, owner);

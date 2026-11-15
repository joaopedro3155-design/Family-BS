-- Ajuste das categorias (igual à planilha): junta duplicadas, separa Feira/Padaria e Banho/Remédios, grupo Pet
do $$
declare
  g record; keeper uuid; lim numeric;
begin
  -- 1) junta categorias repetidas (mesmo nome com acento gravado diferente)
  for g in
    select account_id, tipo, lower(btrim(normalize(name, NFC))) as k, array_agg(id) as ids
    from categories group by 1, 2, 3 having count(*) > 1
  loop
    select c.id into keeper from categories c
      where c.id = any(g.ids)
      order by (select count(*) from transactions t where t.category_id = c.id) desc, (c.monthly_limit is not null) desc, c.created_at
      limit 1;
    select max(monthly_limit) into lim from categories where id = any(g.ids);
    update transactions set category_id = keeper where category_id = any(g.ids) and category_id <> keeper;
    update recurring_bills set category_id = keeper where category_id = any(g.ids) and category_id <> keeper;
    delete from limit_alerts where category_id = any(g.ids) and category_id <> keeper;
    delete from categories where id = any(g.ids) and id <> keeper;
    update categories set monthly_limit = coalesce(monthly_limit, lim) where id = keeper;
  end loop;

  -- 2) nomes e grupos sem acento "quebrado"
  update categories set name = btrim(normalize(name, NFC)), grupo = btrim(normalize(grupo, NFC));

  -- 3) Pet como categoria; Banho e Remédios separados
  update categories set grupo = 'Pet' where grupo = 'Animal Estimação';
  update categories set name = 'Banho' where name = 'Banho / remédios';
  insert into categories (household_id, account_id, name, grupo, tipo)
    select household_id, account_id, 'Remédios', 'Pet', 'despesa' from categories where name = 'Banho' and grupo = 'Pet'
    on conflict do nothing;

  -- 4) Feira e Padaria separadas (o histórico fica em Feira)
  update categories set name = 'Feira' where name = 'Feira / Padaria';
  insert into categories (household_id, account_id, name, grupo, tipo)
    select household_id, account_id, 'Padaria', 'Alimentação', 'despesa' from categories where name = 'Feira' and grupo = 'Alimentação'
    on conflict do nothing;
end $$;

select c.grupo as categoria, string_agg(c.name, ' | ' order by c.name) as subcategorias, count(*) as qtd
from categories c join accounts a on a.id = c.account_id where a.kind = 'PF' and c.tipo = 'despesa'
group by c.grupo order by c.grupo;

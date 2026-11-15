-- =====================================================================
-- Family BS — agendador dos lembretes (rode DEPOIS que o app estiver
-- publicado na Vercel). Troque os dois valores marcados com <<< >>>.
--
-- Antes: Supabase → Database → Extensions → ative "pg_cron" e "pg_net".
-- =====================================================================

select cron.unschedule('family-bs-lembretes')
where exists (select 1 from cron.job where jobname = 'family-bs-lembretes');

select cron.schedule(
  'family-bs-lembretes',
  '*/5 * * * *', -- a cada 5 minutos
  $$
  select net.http_post(
    url := 'https://<<<SEU-APP>>>.vercel.app/api/cron/lembretes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<<<MESMO CRON_SECRET DA VERCEL>>>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Fase 2: notícias e resumo de investimentos (uma tarefa a cada 10 minutos, das 6h às 22h)
select cron.unschedule('family-bs-conteudo')
where exists (select 1 from cron.job where jobname = 'family-bs-conteudo');

select cron.schedule(
  'family-bs-conteudo',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://<<<SEU-APP>>>.vercel.app/api/cron/conteudo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<<<MESMO CRON_SECRET DA VERCEL>>>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Moitié-Moitié : envoi des notifications push toutes les 5 minutes.
-- À exécuter UNE FOIS, après le déploiement, en remplaçant les deux valeurs :
--   https://TON-SITE         → l'adresse du site (Vercel ou Netlify)
--   REMPLACER_PAR_CRON_SECRET → la même valeur que la variable CRON_SECRET du déploiement

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('moitie-push') where exists (select 1 from cron.job where jobname = 'moitie-push');

select cron.schedule(
  'moitie-push',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://TON-SITE/api/push/send',
    headers := jsonb_build_object('Authorization', 'Bearer REMPLACER_PAR_CRON_SECRET', 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- Vérifier les derniers appels :
--   select status_code, created from net._http_response order by created desc limit 5;

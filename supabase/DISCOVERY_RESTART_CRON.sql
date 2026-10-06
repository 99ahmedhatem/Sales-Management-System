-- شغّل ده بعد نجاح 044 (يرجّع الجدولة)
select cron.schedule('discovery-send', '* * * * *', $$select public.discovery_send()$$);
select cron.schedule('discovery-collect', '* * * * *', $$select public.discovery_collect()$$);

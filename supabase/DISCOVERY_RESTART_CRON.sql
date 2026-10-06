-- شغّل ده بعد نجاح 044 (يرجّع الجدولة)
select cron.schedule('discovery-send', '* * * * *', $$select public.discovery_send()$$);
select cron.schedule('discovery-collect', '* * * * *', $$select public.discovery_collect()$$);
-- خطوة 2 بتقفل الجدولة بـ active = false؛ نرجّعها شغالة صراحةً
update cron.job set active = true where jobname in ('discovery-send','discovery-collect');

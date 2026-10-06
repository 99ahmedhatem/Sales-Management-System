-- شغّل ده الأول لوحده (بيوقف البحث الجاري ويفك القفل) — قبل 044
do $$ begin
  begin perform cron.unschedule('discovery-send'); exception when others then null; end;
  begin perform cron.unschedule('discovery-collect'); exception when others then null; end;
end $$;
update public.discovery_runs set status = 'stopped' where status = 'running';
select pg_terminate_backend(pid) from pg_stat_activity
 where pid <> pg_backend_pid() and datname = current_database()
   and (query ilike '%discovery_%' or query ilike '%net._http_response%') and state <> 'idle';

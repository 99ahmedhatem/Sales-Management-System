-- 3) لوحده
set statement_timeout = 0;
update public.discovery_runs set status = 'stopped' where status = 'running';

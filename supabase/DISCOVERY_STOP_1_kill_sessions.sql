-- 1) لوحده: يقتل أي استعلام عالق (خفيف جداً) — قبل 044
-- تنبيه: بيقفل أي استعلام شغال أكتر من 20 ثانية في الداتابيز كلها (مش بس الاكتشاف).
select pg_terminate_backend(pid) from pg_stat_activity
 where pid <> pg_backend_pid() and state <> 'idle' and query_start < now() - interval '20 seconds';

-- 050: نوع الإشعار 'comment' غير مسموح -> 'system' (كان بيفشّل دوال الاكتشاف وفحص المواقع)
-- ملاحظة في الريبو: الملف وصل لحد السطر الأخير بس (تعليق "collect أسرع" من غير كود بعده)،
-- و public.sql_check_progress() وجدولة site-check-* مش موجودين في أي ملف هنا (048/049 ناقصين من الريبو).
create or replace function public._site_check_finish_watch()
returns void language plpgsql security definer set search_path = public as $$
declare p record; msg text;
begin
  if coalesce((select value from public.app_settings where key='site_check_finished'),'') = 'true' then return; end if;
  select * into p from public.sql_check_progress();
  if not coalesce(p.finished,false) then return; end if;
  msg := format('انتهى فحص المواقع: %s موقع — يعمل %s، لا يعمل %s.', p.total_with_site, p.working, p.not_working);
  insert into public.notifications(user_id, type, title, message)
    select u.id, 'system', 'انتهى فحص المواقع', msg from public.users u where u.role='admin' and u.status='active';
  insert into public.app_settings(key,value) values ('site_check_finished','true')
    on conflict (key) do update set value='true';
  begin perform cron.unschedule('site-check-send'); perform cron.unschedule('site-check-collect'); exception when others then null; end;
end $$;
revoke all on function public._site_check_finish_watch() from public, anon, authenticated;

-- collect أسرع: يعالج حتى 2000 رد، ويحذف الردود بعد قراءتها (لتوفير المساحة)، ثم يشغّل مراقب الانتهاء

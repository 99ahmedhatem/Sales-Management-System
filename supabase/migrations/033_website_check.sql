-- 033: فحص المواقع تلقائياً (يعمل / لا يعمل + سبب المشكلة كملاحظة وكومنت)
-- الـ Edge Function check-websites هي اللي بتفحص فعلياً وتنادي الدوال دي (service_role فقط).
alter table public.leads add column if not exists website_checked_at   timestamptz;
alter table public.leads add column if not exists website_claimed_at   timestamptz;
alter table public.leads add column if not exists website_check_category text;
alter table public.leads add column if not exists website_check_note   text;
alter table public.leads add column if not exists website_http_status  int;
create index if not exists leads_website_check_idx on public.leads (website_checked_at) where website is not null;

-- ---------- 1) حجز دفعة للفحص (service_role فقط) ----------
create or replace function public.claim_websites_to_check(p_limit int default 40, p_recheck_days int default 30)
returns table (id uuid, website text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select l.id from public.leads l
    where l.website is not null and btrim(l.website) <> ''
      and (l.website_status_source is distinct from 'manual' or l.website_status is null)
      and (l.website_checked_at is null or l.website_checked_at < now() - make_interval(days => p_recheck_days))
      and (l.website_claimed_at is null or l.website_claimed_at < now() - interval '15 minutes')
    order by l.website_checked_at nulls first, l.id
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.leads l set website_claimed_at = now()
  from c where l.id = c.id
  returning l.id, l.website;
end $$;

-- ---------- 2) حفظ النتائج (service_role فقط) ----------
-- p_results: [{ id, status:'working'|'not_working', category, note, http_status, is_salla }]
create or replace function public.save_website_checks(p_results jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; v_admin uuid; v_prev text; v_prev_cat text; v_saved int := 0; v_text text;
begin
  select u.id into v_admin from public.users u where u.role = 'admin' and u.status = 'active' order by u.id limit 1;
  for r in
    select (e->>'id')::uuid as id, e->>'status' as status, e->>'category' as category, e->>'note' as note,
           nullif(e->>'http_status','')::int as http_status, coalesce((e->>'is_salla')::boolean, false) as is_salla
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e
  loop
    if r.status not in ('working','not_working') then continue; end if;
    select l.website_status, l.website_check_category into v_prev, v_prev_cat from public.leads l where l.id = r.id;
    if not found then continue; end if;

    update public.leads l set
      website_status = case when l.website_status_source = 'manual' and l.website_status is not null then l.website_status else r.status end,
      website_status_source = case when l.website_status_source = 'manual' and l.website_status is not null then 'manual' else 'auto_checked' end,
      website_checked_at = now(), website_claimed_at = null,
      website_check_category = r.category, website_check_note = r.note, website_http_status = r.http_status,
      is_salla_store = l.is_salla_store or r.is_salla
    where l.id = r.id;
    v_saved := v_saved + 1;

    -- كومنت مرئي للفريق: فقط لما تتغير المشكلة (من غير تكرار) أو لما الموقع يرجع يشتغل
    v_text := null;
    if r.status = 'not_working' or r.category = 'ok_protected' then
      if v_prev_cat is distinct from r.category then v_text := '🔴 فحص تلقائي للموقع: ' || r.note; end if;
    elsif v_prev = 'not_working' then
      v_text := '🟢 فحص تلقائي: الموقع يعمل الآن.';
    end if;
    if v_text is not null and v_admin is not null then
      insert into public.client_comments (lead_id, author_id, author_name, text)
      values (r.id, v_admin, 'فحص المواقع (تلقائي)', v_text);
    end if;
  end loop;
  return v_saved;
end $$;

-- ---------- 3) إحصائيات + إعادة فحص (للواجهة) ----------
create or replace function public.get_website_check_stats()
returns table (bucket text, total bigint)
language sql stable security definer set search_path = public as $$
  select x.bucket, x.total from (
    select 'working' as bucket, count(*) as total from public.leads where website_status = 'working'
    union all select 'not_working', count(*) from public.leads where website_status = 'not_working'
    union all select 'unchecked', count(*) from public.leads where website is not null and btrim(website) <> '' and website_checked_at is null
    union all select 'no_website', count(*) from public.leads where website is null or btrim(website) = ''
    union all select 'cat:' || website_check_category, count(*) from public.leads where website_check_category is not null group by website_check_category
  ) x
  where public.my_role() in ('admin','manager')
$$;

create or replace function public.recheck_website(p_lead_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() not in ('admin','manager') then raise exception 'Only admin or manager can request a re-check'; end if;
  update public.leads set website_checked_at = null, website_claimed_at = null where id = p_lead_id;
  return 'queued';
end $$;

revoke all on function public.claim_websites_to_check(int, int) from public, anon, authenticated;
revoke all on function public.save_website_checks(jsonb) from public, anon, authenticated;
revoke all on function public.get_website_check_stats() from public, anon;
revoke all on function public.recheck_website(uuid) from public, anon;
grant execute on function public.get_website_check_stats() to authenticated;
grant execute on function public.recheck_website(uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_websites_to_check(int, int) to service_role;
    grant execute on function public.save_website_checks(jsonb) to service_role;
  end if;
end $$;

-- ---------- 4) جدولة (اختياري) بعد تفعيل pg_cron و pg_net ----------
-- ضع CRON_SECRET في Edge Function secrets، ثم:
-- select cron.schedule('check-websites', '*/5 * * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/check-websites',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--     body := '{"batch":40}'::jsonb) $$);

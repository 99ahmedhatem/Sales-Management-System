-- 036: إشعارات خارج الموقع — Push (PWA) + إيميل. الإرسال الفعلي من Edge Function اسمها send-notifications.
alter table public.notifications add column if not exists delivered_at timestamptz;
create index if not exists notifications_undelivered_idx on public.notifications (created_at) where delivered_at is null;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create table if not exists public.notification_prefs (
  user_id uuid primary key references public.users(id) on delete cascade,
  push boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
drop policy if exists "own subs read" on public.push_subscriptions;
create policy "own subs read" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "own prefs read" on public.notification_prefs;
create policy "own prefs read" on public.notification_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists "admin full access" on public.push_subscriptions;
create policy "admin full access" on public.push_subscriptions for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "admin full access" on public.notification_prefs;
create policy "admin full access" on public.notification_prefs for all to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
revoke all on public.push_subscriptions, public.notification_prefs from anon;
-- الكتابة تتم عبر الدوال فقط
revoke insert, update, delete on public.push_subscriptions, public.notification_prefs from authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then raise exception 'Invalid subscription'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
  insert into public.notification_prefs (user_id) values (auth.uid()) on conflict do nothing;
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

create or replace function public.get_notification_prefs()
returns table (push boolean, email boolean, devices bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(p.push, true), coalesce(p.email, false), (select count(*) from public.push_subscriptions s where s.user_id = auth.uid())
  from (select 1) x left join public.notification_prefs p on p.user_id = auth.uid()
  where auth.uid() is not null
$$;

create or replace function public.set_notification_prefs(p_push boolean, p_email boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.notification_prefs (user_id, push, email) values (auth.uid(), p_push, p_email)
  on conflict (user_id) do update set push = excluded.push, email = excluded.email, updated_at = now();
end $$;

-- service_role فقط: حجز إشعارات لم تُرسل (آخر 24 ساعة) مع بيانات الإرسال
create or replace function public.claim_notifications_to_send(p_limit int default 100)
returns table (notification_id uuid, user_id uuid, type text, title text, message text, email text, push_enabled boolean, email_enabled boolean, subscriptions jsonb)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select n.id from public.notifications n
    where n.delivered_at is null and n.created_at > now() - interval '24 hours'
    order by n.created_at limit greatest(p_limit, 1)
    for update skip locked
  ), u as (
    update public.notifications n set delivered_at = now() from c where n.id = c.id returning n.*
  )
  select u.id, u.user_id, u.type, u.title, u.message, usr.email,
         coalesce(p.push, true), coalesce(p.email, false),
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                   from public.push_subscriptions s where s.user_id = u.user_id), '[]'::jsonb)
  from u join public.users usr on usr.id = u.user_id and usr.status = 'active'
  left join public.notification_prefs p on p.user_id = u.user_id;
end $$;

create or replace function public.drop_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint
$$;

revoke all on function public.save_push_subscription(text,text,text,text), public.remove_push_subscription(text),
  public.get_notification_prefs(), public.set_notification_prefs(boolean,boolean),
  public.claim_notifications_to_send(int), public.drop_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text,text,text,text), public.remove_push_subscription(text),
  public.get_notification_prefs(), public.set_notification_prefs(boolean,boolean) to authenticated;
revoke execute on function public.claim_notifications_to_send(int), public.drop_push_subscription(text) from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_notifications_to_send(int), public.drop_push_subscription(text) to service_role;
  end if;
end $$;

-- جدولة (بعد تفعيل pg_cron و pg_net): كل دقيقة
-- select cron.schedule('send-notifications', '* * * * *', $$
--   select net.http_post(url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-notifications',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'), body := '{}'::jsonb) $$);

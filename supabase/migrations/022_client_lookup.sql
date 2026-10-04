-- =====================================================================
-- 022 — البحث عن عميل بالكود في نافذة "صفقة جديدة":
--   lookup_client_for_deal(p_code) بتقبل client_code أو customer_number أو الموبايل
--   (آخر 9 أرقام: 05xxxxxxxx = +9665xxxxxxxx).
-- للعرض والتحقق المبكر بس؛ create_deal هي اللي بتفرض الصلاحية الفعلية.
-- الصلاحية زي create_deal: التيلي سيلز = العميل بتاعه، السيلز = له اجتماع على العميل،
-- المانجر = العميل عند حد من فريقه (أو اجتماع لسيلز من فريقه)، الأدمن = الكل.
-- قراءة بس، آمن لو اتشغّل تاني. مش محتاج 019.
-- =====================================================================

-- آخر 9 أرقام من الموبايل (نفس قاعدة المكرر). immutable عشان تنفع في index.
create or replace function public.phone_last9(p_phone text)
returns text language sql immutable parallel safe as $$
  select nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9), '')
$$;

create index if not exists leads_phone_last9_idx on public.leads (public.phone_last9(phone));
create index if not exists leads_client_code_upper_idx on public.leads (upper(client_code));
create index if not exists leads_customer_number_idx on public.leads (customer_number);

create or replace function public.lookup_client_for_deal(p_code text)
returns table (
  lead_id uuid, name text, phone text, client_code text, customer_number bigint,
  status text, owner_name text, open_deal_status text, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_digits text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  -- رقم قصير = customer_number؛ 9 أرقام أو أكتر = موبايل
  v_number bigint := case when btrim(coalesce(p_code, '')) ~ '^\d{1,8}$' then btrim(p_code)::bigint end;
  v_role text := public.my_role();
  v_found boolean := false;
  l record;
begin
  if v_code = '' then
    raise exception 'Enter a client code, customer number or phone';
  end if;
  if v_role is null then
    raise exception 'Not allowed';
  end if;

  for l in
    select x.id, x.name, x.phone, x.client_code, x.customer_number, x.status::text as status, x.assigned_to, x.updated_at
    from public.leads x
    where upper(x.client_code) = upper(v_code)
       or x.customer_number = v_number
       or public.phone_last9(x.phone) = case when length(v_digits) >= 9 then right(v_digits, 9) end
    order by (upper(x.client_code) = upper(v_code)) desc, x.updated_at desc nulls last
    limit 20
  loop
    v_found := true;
    if v_role = 'admin'
       or (v_role = 'telesales' and l.assigned_to = auth.uid())
       or (v_role = 'sales' and exists (
             select 1 from public.meetings m where m.lead_id = l.id and m.assigned_sales_id = auth.uid()))
       or (v_role = 'manager' and (
             l.assigned_to = auth.uid()
             or exists (select 1 from public.users u where u.id = l.assigned_to and u.manager_id = auth.uid())
             or exists (select 1 from public.meetings m join public.users u on u.id = m.assigned_sales_id
                        where m.lead_id = l.id and u.manager_id = auth.uid())))
    then
      lead_id := l.id;
      name := l.name;
      phone := l.phone;
      client_code := l.client_code;
      customer_number := l.customer_number;
      status := l.status;
      owner_name := (select u.full_name from public.users u where u.id = l.assigned_to);
      open_deal_status := (select d.status from public.deals d
                           where d.lead_id = l.id and d.status <> 'cancelled'
                           order by d.created_at desc limit 1);
      reason := case when open_deal_status is not null then 'This client already has a deal in progress' end;
      return next;
      return;
    end if;
  end loop;

  if not v_found then
    raise exception 'No client found with this code';
  end if;
  if v_role = 'sales' then
    raise exception 'You can only close a deal for a lead assigned to you through a meeting';
  end if;
  raise exception 'This client is not assigned to you or your team';
end $$;

revoke execute on function public.lookup_client_for_deal(text) from public, anon;
grant execute on function public.lookup_client_for_deal(text) to authenticated;

notify pgrst, 'reload schema';

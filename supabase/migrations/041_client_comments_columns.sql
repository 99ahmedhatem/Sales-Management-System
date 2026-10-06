-- 041 (اتبعت باسم "039" بس 039 متاخد في الريبو لـ 039_admin_full_access):
-- إصلاح 'column cc.author_name does not exist' — يتأقلم مع أعمدة client_comments الفعلية.
-- الواجهة (src/data/clientComments.ts) بقت بتضيف الكومنت عن طريق add_lead_comment بدل الكتابة المباشرة.


create or replace function public._cc_col(cands text[]) returns text language sql stable as $f$
  select c from unnest(cands) with ordinality t(c,o)
  where exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_comments' and column_name=c)
  order by o limit 1 $f$;

create or replace function public._add_comment(p_lead uuid, p_author uuid, p_name text, p_text text)
returns uuid language plpgsql security definer set search_path=public as $f$
declare tc text := public._cc_col(array['text','comment','content','body','message','note']);
        ac text := public._cc_col(array['author_id','user_id','created_by']);
        nc text := public._cc_col(array['author_name','user_name','created_by_name']);
        cols text[] := array['lead_id']; vals text[] := array['$1']; id uuid; q text;
begin
  if tc is null then raise exception 'client_comments has no text column'; end if;
  cols := cols || tc::text; vals := vals || '$4'::text;
  if ac is not null then cols := cols || ac::text; vals := vals || '$2'::text; end if;
  if nc is not null then cols := cols || nc::text; vals := vals || '$3'::text; end if;
  q := format('insert into public.client_comments(%s) values(%s) returning id', array_to_string(cols,','), array_to_string(vals,','));
  execute q into id using p_lead, p_author, p_name, p_text;
  return id;
end $f$;
revoke all on function public._add_comment(uuid,uuid,text,text) from public, anon, authenticated;

create or replace function public._lead_comments(p_lead uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $f$
declare tc text := public._cc_col(array['text','comment','content','body','message','note']);
        ac text := public._cc_col(array['author_id','user_id','created_by']);
        nc text := public._cc_col(array['author_name','user_name','created_by_name']);
        q text; res jsonb;
begin
  if tc is null then return '[]'::jsonb; end if;
  q := format($q$ select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) from (
        select cc.id, %s as author_name, cc.%I as text, cc.created_at
        from public.client_comments cc %s
        where cc.lead_id=$1 order by cc.created_at desc limit 100) x $q$,
     case when nc is not null then format('coalesce(cc.%I, u.full_name)',nc) else 'u.full_name' end, tc,
     case when ac is not null then format('left join public.users u on u.id=cc.%I',ac) else 'left join public.users u on false' end);
  execute q into res using p_lead;
  return res;
end $f$;
revoke all on function public._lead_comments(uuid) from public, anon, authenticated;

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
      perform public._add_comment(r.id, v_admin, 'فحص المواقع (تلقائي)', v_text);
    end if;
  end loop;
  return v_saved;
end $$;

create or replace function public.get_lead_card(p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.leads; owner text; res jsonb;
begin
  if not public.can_view_lead(p_lead_id) then raise exception 'You are not allowed to view this client'; end if;
  select * into l from public.leads where id = p_lead_id;
  select u.full_name into owner from public.users u where u.id = l.assigned_to;
  res := jsonb_build_object(
    'lead', jsonb_build_object(
      'id', l.id, 'client_code', l.client_code, 'customer_number', l.customer_number, 'name', l.name, 'phone', l.phone,
      'company', l.company, 'region', l.region, 'website', l.website, 'website_status', l.website_status,
      'website_status_source', l.website_status_source, 'website_check_category', l.website_check_category,
      'website_check_note', l.website_check_note, 'website_checked_at', l.website_checked_at,
      'is_salla_store', l.is_salla_store, 'status', l.status, 'source', l.source, 'data_quality', l.data_quality,
      'callback_date', l.callback_date, 'quantity', l.quantity, 'assigned_to', l.assigned_to, 'owner_name', owner,
      'created_at', l.created_at, 'updated_at', l.updated_at),
    'can_edit', public.can_edit_lead(p_lead_id),
    'comments', public._lead_comments(p_lead_id),
    'deals', coalesce((select jsonb_agg(d order by d.created_at desc) from (
        select dd.id, dd.status, dd.package_name, dd.price_sar, dd.created_at from public.deals dd
        where dd.lead_id = p_lead_id) d), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(m order by m.proposed_date desc) from (
        select mm.id, mm.proposed_date, mm.outcome from public.meetings mm where mm.lead_id = p_lead_id) m), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(h order by h.created_at desc) from (
        select a.created_at, coalesce(u.full_name, '—') as who, a.action, a.old_data, a.new_data
        from public.audit_log a left join public.users u on u.id = a.changed_by
        where a.table_name = 'leads' and a.row_id = p_lead_id::text
        order by a.created_at desc limit 30) h), '[]'::jsonb));
  return res;
end $$;

create or replace function public.add_lead_comment(p_lead_id uuid, p_text text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text := btrim(coalesce(p_text,'')); nm text; owner uuid; cid uuid;
begin
  if not public.can_view_lead(p_lead_id) then raise exception 'You are not allowed to comment on this client'; end if;
  if t = '' then raise exception 'Comment cannot be empty'; end if;
  if length(t) > 2000 then raise exception 'Comment is too long (max 2000 characters)'; end if;
  select full_name into nm from public.users where id = me;
  cid := public._add_comment(p_lead_id, me, coalesce(nm, '-'), t);
  select assigned_to into owner from public.leads where id = p_lead_id;
  if owner is not null and owner <> me then
    insert into public.notifications (user_id, type, title, message)
    values (owner, 'comment', 'تعليق جديد على عميل', coalesce(nm,'-') || ': ' || left(t, 120));
  end if;
  return cid;
end $$;

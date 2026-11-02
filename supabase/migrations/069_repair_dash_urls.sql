-- 069: repair website links whose "-" was turned into "/"  (that is why so many sites "don't work")
--
-- Thousands of links look like this:          the real site is:
--   https://www.enjoy/driving.com.sa/blogs     →  https://www.enjoy-driving.com.sa/
--   https://www.el/seif.com.sa/ar              →  https://www.el-seif.com.sa/        (checked: this site opens)
--   https://www.al/jawhara/1.com/              →  https://www.al-jawhara-1.com/
--   https://www.international/schools/database.com/in/dammam  →  https://www.international-schools-database.com/
-- A domain name can't contain "/", so a link whose first part has no dot (enjoy/…) is broken: the parts before the
-- first part that has a dot are joined back with "-". The rest of the link (inner page) is dropped → home page (068).
--
-- Also:
--   · the next website check of every repaired client is cleared (the old result was for the broken link)
--   · if a repaired link turns out to be a client that already exists, the two are merged like 067 (one client per site)
--   · from now on a broken link like this is repaired automatically when saved (Excel import, Add lead, discovery …)
--
-- Needs 067 + 068. Run PART 1 first (no changes), then the whole file. Safe to run more than once.

-- ============================== PART 1: function + preview (no data changes) ==============================

create or replace function public.repair_dash_url(p_url text) returns text language plpgsql immutable as $f$
declare s text; scheme text := 'https://'; www text := ''; parts text[]; k int; host text;
begin
  s := btrim(coalesce(p_url, ''));
  if s = '' then return null; end if;
  if s ~* '^https?://' then scheme := case when s ~* '^http://' then 'http://' else 'https://' end; s := regexp_replace(s, '^[hH][tT][tT][pP][sS]?://', ''); end if;
  s := regexp_replace(s, '[?#].*$', '');
  parts := string_to_array(s, '/');
  if parts[1] ~* '^www[0-9]*\.' then www := lower(substring(lower(parts[1]) from '^(www[0-9]*\.)')); parts[1] := regexp_replace(lower(parts[1]), '^www[0-9]*\.', ''); end if;
  if parts[1] like '%.%' or parts[1] = '' then return null; end if;          -- first part already has a dot: not broken
  for k in 2 .. least(coalesce(array_length(parts, 1), 0), 6) loop
    if parts[k] like '%.%' then
      host := lower(array_to_string(parts[1:k], '-'));
      if host ~ '^[a-z0-9؀-ۿ]([a-z0-9؀-ۿ-]*[a-z0-9؀-ۿ])?(\.[a-z0-9؀-ۿ-]+)+$' then
        return scheme || www || host || '/';
      end if;
      return null;
    end if;
    if parts[k] !~* '^[a-z0-9؀-ۿ]+$' then return null; end if;   -- only plain words can be joined
  end loop;
  return null;
end $f$;

-- Preview: how many links are broken this way
select count(*) as broken_links
from public.leads where website is not null and public.repair_dash_url(website) is not null;

-- (optional) 30 examples: broken → repaired
-- select client_code, website as broken, public.repair_dash_url(website) as repaired
-- from public.leads where website is not null and public.repair_dash_url(website) is not null limit 30;

-- ============================== PART 2: repair (changes data) ==============================
set statement_timeout = 0;

-- merge one duplicate client into another (same rules as 067)
create or replace function public._merge_lead_into(p_dup uuid, p_keeper uuid) returns void
language plpgsql security definer set search_path = public as $f$
declare t record; r public.leads;
begin
  if p_dup = p_keeper then return; end if;
  select * into r from public.leads where id = p_dup;
  if not found then return; end if;
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'lead_id' and c.table_name not like 'leads_backup%'
  loop
    execute format('update public.%I set lead_id = $1 where lead_id = $2', t.table_name) using p_keeper, p_dup;
  end loop;
  delete from public.leads where id = p_dup;
  update public.leads k set notes = concat_ws(E'\n', nullif(k.notes, ''), 'رقم إضافي: ' || r.phone)
   where k.id = p_keeper and coalesce(k.phone, '') <> '' and coalesce(r.phone, '') <> ''
     and public.phone_key(k.phone) is distinct from public.phone_key(r.phone);
  update public.leads k set
    name     = coalesce(nullif(k.name, ''), r.name),
    company  = coalesce(nullif(k.company, ''), r.company),
    region   = coalesce(nullif(k.region, ''), r.region),
    quantity = greatest(coalesce(k.quantity, 0), coalesce(r.quantity, 0)),
    phone    = case when coalesce(k.phone, '') = '' and coalesce(r.phone, '') <> ''
                     and not exists (select 1 from public.leads z where z.id <> k.id and z.phone_key = public.phone_key(r.phone))
                    then r.phone else k.phone end,
    updated_at = now()
  where k.id = p_keeper;
end $f$;
revoke all on function public._merge_lead_into(uuid, uuid) from public, anon, authenticated;

do $$
declare l record; fixed text; key text; keeper uuid; n_fixed int := 0; n_merged int := 0; n_failed int := 0; err text;
begin
  for l in select id, website from public.leads where website is not null and public.repair_dash_url(website) is not null loop
    begin
      fixed := public.repair_dash_url(l.website);
      key := public.site_key(fixed);
      select x.id into keeper from public.leads x where x.website_key = key and x.id <> l.id limit 1;
      if keeper is not null then
        -- the repaired site is already a client: keep the one with more history, merge the other into it
        if exists (select 1 from public.deals d where d.lead_id = l.id) and not exists (select 1 from public.deals d where d.lead_id = keeper) then
          perform public._merge_lead_into(keeper, l.id);
          update public.leads set website = fixed where id = l.id;
        else
          perform public._merge_lead_into(l.id, keeper);
        end if;
        n_merged := n_merged + 1;
      else
        update public.leads set
          website = fixed,                       -- the trigger (068) stores the home page + website_key
          website_checked_at = null,
          website_status = case when website_status_source = 'manual' then website_status end,
          website_status_source = case when website_status_source = 'manual' then 'manual' end,
          website_check_category = null, website_check_note = null, website_http_status = null
        where id = l.id;
        n_fixed := n_fixed + 1;
      end if;
    exception when others then
      n_failed := n_failed + 1; err := left(l.website || ': ' || sqlerrm, 300);
    end;
  end loop;
  raise notice 'Repaired % links, merged % duplicates, % failed (%)', n_fixed, n_merged, n_failed, coalesce(err, '-');
end $$;

-- from now on: a broken link is repaired when saved, then stored as the home page
create or replace function public._leads_site_key() returns trigger language plpgsql as $f$
begin
  new.website := coalesce(public.repair_dash_url(new.website), new.website);
  new.website := coalesce(public.site_home(new.website), new.website);
  new.website_key := public.site_key(new.website);
  return new;
end $f$;

-- ============================== check ==============================
select
  (select count(*) from public.leads where website is not null and public.repair_dash_url(website) is not null) as broken_links_left,  -- 0
  public.repair_dash_url('https://www.enjoy/driving.com.sa/blogs')  as test_1,   -- https://www.enjoy-driving.com.sa/
  public.repair_dash_url('https://www.al/jawhara/1.com/')           as test_2,   -- https://www.al-jawhara-1.com/
  public.repair_dash_url('https://www.example.com/blog/post')       as test_3;   -- NULL (not broken)

-- 067: one client per website — the same site written differently counts as a duplicate.
--
-- Before: website_key was built in the browser (host + path), so these were 3 different clients:
--           https://www.Example.com/   ·   example.com/ar   ·   http://example.com/index.html?x=1
--         and leads added from other screens sometimes had no website_key at all.
-- Now:    public.site_key(website) builds ONE key on the server:
--           · the site's domain, without http(s), www., port, path, ?query or #hash  → example.com
--           · for shared platforms the first part of the path is kept, because it is the store/page itself:
--             salla.sa/mystore, zid.store/shop, instagram.com/brand, linktr.ee/x, wa.me/9665…, t.me/x …
--           · a bare platform page (salla.sa, instagram.com …) is NOT a website → no key (never merged)
--         A trigger writes website_key = site_key(website) on every insert / edit, and a unique index blocks
--         a second client with the same key. Excel import (import_leads) and Lead discovery then skip it.
--
-- HOW TO RUN (SQL Editor):
--   1) Run PART 1 only (until the line "PART 2"). It changes no data: it shows how many duplicates exist.
--   2) Take a backup (Database → Backups).
--   3) Run PART 2. It merges each group of duplicates into one client, then turns the protection on.
-- Merging keeps the best client of each group (has a deal > a meeting > assigned > worked > has phone > oldest),
-- moves everything linked to the others (meetings, deals, comments, logs, calls …) to it, fills its empty fields
-- from them, then deletes the others. Safe to run more than once.

-- ============================== PART 1: key + preview (no data changes) ==============================

create or replace function public.site_key(p_url text) returns text language plpgsql immutable as $f$
declare s text; host text; seg text; seg2 text; parts text[];
begin
  s := lower(btrim(coalesce(p_url, '')));
  if s = '' or s in ('-', '—', '–', 'n/a', 'na', 'none', 'null') then return null; end if;
  s := regexp_replace(s, '^[a-z][a-z0-9+.-]*://', '');        -- protocol
  s := regexp_replace(s, '^[^/@]*@', '');                     -- user:pass@
  s := regexp_replace(s, '[?#].*$', '');                      -- ?query #hash
  parts := string_to_array(s, '/');
  host := regexp_replace(parts[1], ':[0-9]+$', '');           -- port
  host := regexp_replace(host, '^www[0-9]*\.', '');
  host := rtrim(host, '.');
  if host !~ '^[a-z0-9؀-ۿ-]+(\.[a-z0-9؀-ۿ-]+)+$' then return null; end if;
  seg  := nullif(parts[2], '');
  seg2 := nullif(parts[3], '');
  host := case host
            when 'm.facebook.com' then 'facebook.com' when 'fb.com' then 'facebook.com' when 'twitter.com' then 'x.com'
            when 'm.youtube.com' then 'youtube.com' when 'mobile.twitter.com' then 'x.com' else host end;
  -- shared platforms: the store / page is in the path
  if host in ('salla.sa', 'salla.com', 'zid.store', 'zid.sa', 'linktr.ee', 'instagram.com', 'facebook.com', 'x.com',
              'tiktok.com', 'wa.me', 't.me', 'youtube.com', 'linkedin.com', 'sites.google.com', 'snapchat.com',
              'threads.net', 'behance.net', 'pinterest.com', 'beacons.ai', 'bio.link', 'taplink.cc')
     or host like '%.wixsite.com' or host like '%.github.io' then
    if seg is null then return null; end if;                  -- bare platform page = not a website
    if seg in ('add', 'company', 'in', 'channel', 'c', 'user', 'view', 'p', 'pages') and seg2 is not null then
      return host || '/' || seg || '/' || seg2;
    end if;
    return host || '/' || seg;
  end if;
  return host;
end $f$;

-- Preview: groups of clients that are the same website
with k as (
  select id, public.site_key(website) as key from public.leads where website is not null
), g as (
  select key, count(*) as n from k where key is not null group by key having count(*) > 1
)
select count(*) as duplicate_groups, coalesce(sum(n), 0) as clients_in_groups,
       coalesce(sum(n) - count(*), 0) as clients_that_will_be_merged
from g;

-- (optional) see 50 examples
-- with k as (select id, client_code, name, website, public.site_key(website) as key from public.leads where website is not null)
-- select key, count(*) as n, string_agg(client_code || ' ' || coalesce(website, ''), '  |  ') as clients
-- from k where key is not null group by key having count(*) > 1 order by n desc limit 50;

-- ============================== PART 2: merge + protection (changes data) ==============================
set statement_timeout = 0;
set lock_timeout = '30s';

create or replace function public.merge_duplicate_sites(p_groups integer default 300)
returns table(groups_merged integer, clients_removed integer, groups_failed integer, last_error text)
language plpgsql security definer set search_path = public as $f$
declare
  g record; keeper uuid; dups uuid[]; r public.leads; t record;
  n_groups int := 0; n_removed int := 0; n_failed int := 0; err text;
begin
  if auth.uid() is not null and public.my_role() <> 'admin' then raise exception 'Only admin can merge leads'; end if;

  -- keys computed once per call (fast on tens of thousands of clients)
  drop table if exists _site_keys;
  create temp table _site_keys as
    select l.id, public.site_key(l.website) as key from public.leads l where l.website is not null;
  delete from _site_keys where key is null;
  create index on _site_keys (key);

  for g in
    select s.key from _site_keys s group by s.key having count(*) > 1 limit greatest(p_groups, 1)
  loop
    begin  -- each group on its own: one bad group never stops the rest
      select l.id into keeper from public.leads l join _site_keys s on s.id = l.id where s.key = g.key
      order by (exists (select 1 from public.deals d where d.lead_id = l.id)) desc,
               (exists (select 1 from public.meetings m where m.lead_id = l.id)) desc,
               (l.assigned_to is not null) desc,
               (coalesce(l.status, 'New') <> 'New') desc,
               (l.phone is not null and l.phone <> '') desc,
               l.created_at asc nulls last, l.id
      limit 1;
      select array_agg(s.id) into dups from _site_keys s where s.key = g.key and s.id <> keeper;

      -- move everything that points to the duplicates (every table with a lead_id column, except backups)
      for t in
        select c.table_name from information_schema.columns c
        join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
        where c.table_schema = 'public' and c.column_name = 'lead_id' and c.table_name not like 'leads_backup%'
      loop
        execute format('update public.%I set lead_id = $1 where lead_id = any($2)', t.table_name) using keeper, dups;
      end loop;

      for r in select * from public.leads where id = any(dups) order by created_at nulls last loop
        delete from public.leads where id = r.id;   -- delete first, so its phone / website become free
        -- a second, different phone is kept in the notes so it is not lost
        update public.leads k set notes = concat_ws(E'\n', nullif(k.notes, ''), 'رقم إضافي: ' || r.phone)
         where k.id = keeper and coalesce(k.phone, '') <> '' and coalesce(r.phone, '') <> ''
           and public.phone_key(k.phone) is distinct from public.phone_key(r.phone);
        update public.leads k set
          name     = coalesce(nullif(k.name, ''), r.name),
          company  = coalesce(nullif(k.company, ''), r.company),
          region   = coalesce(nullif(k.region, ''), r.region),
          notes    = case when coalesce(r.notes, '') = '' or coalesce(k.notes, '') like '%' || r.notes || '%' then k.notes
                          when coalesce(k.notes, '') = '' then r.notes else k.notes || E'\n' || r.notes end,
          quantity = greatest(coalesce(k.quantity, 0), coalesce(r.quantity, 0)),
          phone    = case when coalesce(k.phone, '') = '' and coalesce(r.phone, '') <> ''
                           and not exists (select 1 from public.leads z where z.id <> k.id and z.phone_key = public.phone_key(r.phone))
                          then r.phone else k.phone end,
          updated_at = now()
        where k.id = keeper;
      end loop;

      n_groups := n_groups + 1;
      n_removed := n_removed + coalesce(array_length(dups, 1), 0);
    exception when others then
      n_failed := n_failed + 1; err := left(g.key || ': ' || sqlerrm, 300);
    end;
  end loop;
  return query select n_groups, n_removed, n_failed, err;
end $f$;
revoke all on function public.merge_duplicate_sites(integer) from public, anon;
grant execute on function public.merge_duplicate_sites(integer) to authenticated;

-- website_key is always built by the server from the website
create or replace function public._leads_site_key() returns trigger language plpgsql as $f$
begin
  new.website_key := public.site_key(new.website);
  return new;
end $f$;

do $$
declare res record; total_groups int := 0; total_removed int := 0; total_failed int := 0; last_err text; guard int := 0;
begin
  -- 1) merge all duplicate groups
  loop
    select * into res from public.merge_duplicate_sites(300);
    total_groups := total_groups + res.groups_merged; total_removed := total_removed + res.clients_removed;
    total_failed := res.groups_failed; last_err := coalesce(res.last_error, last_err); guard := guard + 1;
    exit when res.groups_merged = 0 or guard > 300;
  end loop;
  raise notice 'Merged % groups, removed % duplicate clients, % groups could not be merged (%)', total_groups, total_removed, total_failed, coalesce(last_err, '-');

  -- 2) rebuild website_key with the new rule, then the protection
  drop trigger if exists leads_site_key on public.leads;
  drop index if exists public.leads_website_key_unique;
  -- a group that could not be merged keeps the key on its oldest client only (no crash; listed in the notice)
  update public.leads l set website_key = x.key
    from (select id, case when row_number() over (partition by public.site_key(website) order by created_at nulls last, id) = 1
                          then public.site_key(website) end as key
          from public.leads) x
   where x.id = l.id and l.website_key is distinct from x.key;
  create unique index leads_website_key_unique on public.leads (website_key);   -- NULLs (no website) are allowed many times
  create trigger leads_site_key before insert or update of website, website_key on public.leads
    for each row execute function public._leads_site_key();
end $$;

notify pgrst, 'reload schema';

-- ============================== check ==============================
with k as (select public.site_key(website) as key from public.leads where website is not null)
select
  (select count(*) from (select key from k where key is not null group by key having count(*) > 1) x) as duplicate_groups_left,  -- 0
  (select count(*) from pg_trigger where tgname = 'leads_site_key') as trigger_on,                                             -- 1
  (select count(*) from pg_indexes where indexname = 'leads_website_key_unique') as unique_index_on,                            -- 1
  public.site_key('https://www.Example.com/ar/index.html?x=1') as test_site,                                                    -- example.com
  public.site_key('salla.sa/mystore/products') as test_salla_store,                                                             -- salla.sa/mystore
  public.site_key('https://salla.sa/') as test_bare_platform;                                                                   -- NULL

-- 064: Lead discovery — search notes + tags (علامات)
--
-- 1) Search note (ملاحظة للبحث). The page turns the note into three config keys before saving / starting:
--      extra_searches : text[]  — each normal line = one more search on its own (+ the country word)
--      add_terms      : text[]  — lines starting with "+" = added to the end of EVERY search
--      exclude_words  : text[]  — lines starting with "-" = results whose name / domain / link contain the word are skipped
--    The raw note is also kept as config.search_note and in discovery_configs.instructions.
-- 2) Tags:
--      config.run_tag (optional) = every result found by that run gets this tag automatically.
--      discovery_results.tag      = can be set / changed for selected results from the page.
--      leads.tag                  = copied from the result when it is added as a client, shown and filterable on Clients.
--
-- Safe to run more than once. discovery_collect / discovery_send are NOT changed: the note and tag are applied
-- by _disc_build_queries and by insert triggers.

set lock_timeout = '10s';

-- ---------- columns ----------
alter table public.discovery_results add column if not exists tag text;
alter table public.leads add column if not exists tag text;
create index if not exists discovery_results_tag_idx on public.discovery_results(tag) where tag is not null;
create index if not exists leads_tag_idx on public.leads(tag) where tag is not null;

-- ---------- helpers ----------
create or replace function public._disc_text_list(v jsonb) returns text[] language sql immutable as $f$
  select coalesce(array_agg(btrim(e)) filter (where btrim(e) <> ''), '{}'::text[])
  from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) e
$f$;

/** true when any exclude word appears in the text (case-insensitive). */
create or replace function public._disc_excluded(cfg jsonb, txt text) returns boolean language sql immutable as $f$
  select exists (
    select 1 from unnest(public._disc_text_list(cfg->'exclude_words')) w
    where position(lower(w) in lower(coalesce(txt, ''))) > 0
  )
$f$;

-- ---------- queries: same as 045 + add_terms + extra_searches ----------
create or replace function public._disc_build_queries(cfg jsonb) returns jsonb language plpgsql immutable as $f$
declare out jsonb := '[]'::jsonb; seen text[] := '{}'; c text; d jsonb; s text; city text; q text; word text; qs text[]; cf jsonb; kw text;
        feats jsonb := coalesce(cfg->'features','{}'::jsonb); cust jsonb := coalesce(cfg->'custom_features','[]'::jsonb);
        a boolean := coalesce((feats->>'app')::boolean,false); b boolean := coalesce((feats->>'dashboard')::boolean,false); w boolean := coalesce((feats->>'wordpress')::boolean,false);
        inc boolean := coalesce((cfg->>'include_cities')::boolean,false);
        suffix text := array_to_string(public._disc_text_list(cfg->'add_terms'), ' ');
        extra text[] := public._disc_text_list(cfg->'extra_searches');
begin
  for c in select jsonb_array_elements_text(coalesce(cfg->'countries','[]'::jsonb)) loop
    d := cfg->'country_defs'->c; if d is null then continue; end if;
    word := d->>'query_word';
    for s in select jsonb_array_elements_text(coalesce(cfg->'sectors','[]'::jsonb)) loop
      qs := array[s || ' ' || word, s || ' ' || word || ' شركة'];
      if a then qs := qs || (s || ' ' || word || ' تطبيق'); end if;
      if b then qs := qs || (s || ' ' || word || ' لوحة تحكم العملاء'); end if;
      if w then qs := qs || (s || ' ' || word || ' wordpress'); end if;
      for cf in select jsonb_array_elements(cust) loop
        kw := cf->'keywords'->>0; if kw is not null and kw <> '' then qs := qs || (s || ' ' || word || ' ' || kw); end if;
      end loop;
      if inc then
        for city in select jsonb_array_elements_text(coalesce(d->'cities','[]'::jsonb)) loop
          qs := qs || (s || ' ' || city || ' ' || word);
          if a then qs := qs || (s || ' ' || city || ' تطبيق جوال'); end if;
        end loop;
      end if;
      foreach q in array qs loop
        if suffix <> '' then q := q || ' ' || suffix; end if;
        if not (c || '|' || q) = any(seen) then seen := seen || (c || '|' || q); out := out || jsonb_build_object('q', q, 'cc', c); end if;
      end loop;
    end loop;
    for q in select e from jsonb_array_elements_text(case when a and b and w then coalesce(d->'extra_queries','[]'::jsonb) else '[]'::jsonb end) e where e !~* '(site:|inurl:|intitle:|filetype:)' loop
      if suffix <> '' then q := q || ' ' || suffix; end if;
      if not (c || '|' || q) = any(seen) then seen := seen || (c || '|' || q); out := out || jsonb_build_object('q', q, 'cc', c); end if;
    end loop;
    -- Note lines: one search each, in this country (country word added unless the line already has it)
    foreach q in array extra loop
      q := regexp_replace(q, '(site:|inurl:|intitle:|filetype:)\S*', '', 'gi');
      q := btrim(q); if q = '' then continue; end if;
      if word is not null and position(word in q) = 0 then q := q || ' ' || word; end if;
      if suffix <> '' then q := q || ' ' || suffix; end if;
      if not (c || '|' || q) = any(seen) then seen := seen || (c || '|' || q); out := out || jsonb_build_object('q', q, 'cc', c); end if;
    end loop;
  end loop;
  return out;
end $f$;

-- ---------- triggers: exclude words + run tag ----------
create or replace function public._disc_pages_filter() returns trigger language plpgsql security definer set search_path = public as $f$
declare cfg jsonb;
begin
  if new.kind is distinct from 'home' then return new; end if;
  select config into cfg from public.discovery_runs where id = new.run_id;
  if cfg is not null and public._disc_excluded(cfg, concat_ws(' ', new.domain, new.name, new.url)) then
    return null;  -- skipped: never fetched
  end if;
  return new;
end $f$;

drop trigger if exists disc_pages_filter on public.discovery_pages;
create trigger disc_pages_filter before insert on public.discovery_pages
  for each row execute function public._disc_pages_filter();

create or replace function public._disc_results_tag() returns trigger language plpgsql security definer set search_path = public as $f$
declare cfg jsonb;
begin
  select config into cfg from public.discovery_runs where id = new.run_id;
  if cfg is not null and public._disc_excluded(cfg, concat_ws(' ', new.domain, new.name, new.url)) then
    return null;
  end if;
  if new.tag is null and cfg is not null then new.tag := nullif(btrim(cfg->>'run_tag'), ''); end if;
  return new;
end $f$;

drop trigger if exists disc_results_tag on public.discovery_results;
create trigger disc_results_tag before insert on public.discovery_results
  for each row execute function public._disc_results_tag();

-- ---------- tag RPCs ----------
/** Sets (or clears, with null / '') the tag of the given results. Returns how many rows changed. */
create or replace function public.set_discovery_results_tag(p_ids uuid[], p_tag text)
returns int language plpgsql security definer set search_path = public as $f$
declare n int;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  update public.discovery_results set tag = nullif(btrim(p_tag), '') where id = any(p_ids);
  get diagnostics n = row_count;
  -- Results already added as clients: keep the client's tag in step
  update public.leads l set tag = nullif(btrim(p_tag), '')
    from public.discovery_results x where x.id = any(p_ids) and x.status = 'added' and x.lead_id = l.id;
  return n;
end $f$;

/** Every tag in use (results + clients), for suggestions and filters. */
create or replace function public.discovery_tags()
returns table(tag text, results int, leads int) language sql stable security definer set search_path = public as $f$
  with r as (select x.tag, count(*)::int n from public.discovery_results x where x.tag is not null group by x.tag),
       l as (select y.tag, count(*)::int n from public.leads y where y.tag is not null group by y.tag)
  select coalesce(r.tag, l.tag), coalesce(r.n, 0), coalesce(l.n, 0)
  from r full join l on l.tag = r.tag
  where public.my_role() in ('admin', 'manager')
  order by 1
$f$;

revoke all on function public.set_discovery_results_tag(uuid[], text), public.discovery_tags() from public, anon;
grant execute on function public.set_discovery_results_tag(uuid[], text), public.discovery_tags() to authenticated;
revoke execute on function public._disc_pages_filter(), public._disc_results_tag() from public, anon, authenticated;

-- ---------- approve: same as 054 + copies the tag to the client ----------
create or replace function public.approve_discovery_results(p_ids uuid[] default null, p_data_quality text default 'normal', p_is_salla boolean default null)
returns table(received int, added int, duplicates int) language plpgsql security definer set search_path = public as $f$
declare rows jsonb; n_in int; r record; lid uuid; v_salla boolean;
begin
  if public.my_role() <> 'admin' then raise exception 'admin only'; end if;
  if coalesce(p_data_quality, '') not in ('normal', 'medium', 'high') then raise exception 'invalid data quality: %', p_data_quality; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'phone', x.phone, 'company', x.name, 'region', coalesce(x.country, 'Saudi Arabia'), 'source', 'Google Search',
          'notes', x.notes, 'website', x.url, 'website_key', x.domain)), '[]'::jsonb), count(*)
    into rows, n_in from public.discovery_results x where x.status = 'new' and (p_ids is null or x.id = any(p_ids));
  if n_in = 0 then return query select 0, 0, 0; return; end if;
  perform * from public.import_leads(rows, false, p_data_quality);
  added := 0; duplicates := 0;
  for r in select * from public.discovery_results x where x.status = 'new' and (p_ids is null or x.id = any(p_ids)) loop
    select l.id into lid from public.leads l where l.website_key = r.domain limit 1;
    if lid is not null then
      update public.discovery_results set status = 'added', lead_id = lid where id = r.id; added := added + 1;
      v_salla := coalesce(p_is_salla, exists (select 1 from unnest(coalesce(r.features, '{}'::text[])) f where f ilike '%salla%' or f like '%سلة%'));
      -- created_at = now() only for leads inserted in this transaction
      update public.leads l set is_salla_store = v_salla where l.id = lid and l.created_at >= now();
      if r.tag is not null then
        update public.leads l set tag = r.tag where l.id = lid and (l.tag is null or l.created_at >= now());
      end if;
    else
      update public.discovery_results set status = 'duplicate' where id = r.id; duplicates := duplicates + 1;
    end if;
  end loop;
  return query select n_in, added, duplicates;
end $f$;

revoke all on function public.approve_discovery_results(uuid[], text, boolean) from public, anon;
grant execute on function public.approve_discovery_results(uuid[], text, boolean) to authenticated;

-- ---------- check ----------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'tag') as leads_tag_column,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'discovery_results' and column_name = 'tag') as results_tag_column,
  (select count(*) from pg_trigger where tgname in ('disc_pages_filter', 'disc_results_tag')) as triggers,   -- expect 1, 1, 2
  jsonb_array_length(public._disc_build_queries(jsonb_build_object(
    'countries', '["sa"]'::jsonb, 'sectors', '["عيادات"]'::jsonb,
    'country_defs', jsonb_build_object('sa', jsonb_build_object('query_word', 'السعودية')),
    'features', '{}'::jsonb, 'extra_searches', '["متاجر عطور"]'::jsonb, 'add_terms', '["اونلاين"]'::jsonb))) as test_queries;  -- expect 3

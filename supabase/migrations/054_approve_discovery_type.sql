-- 054: Discovery → add as clients with a chosen type (Salla store / software) and quality.
-- (The request referred to "supabase-057-approve-discovery-type.sql"; that file was not provided, so this is written
--  from 043's approve_discovery_results. If you already ran a 057 with the same signature, this one replaces it.)
--
-- approve_discovery_results(p_ids, p_data_quality, p_is_salla):
--   p_data_quality: 'normal' | 'medium' | 'high'
--   p_is_salla: null = auto (Salla if the result's features mention Salla / سلة), true = Salla store, false = software.
-- Only leads created by this call get is_salla_store; existing leads (duplicates) are not touched.

drop function if exists public.approve_discovery_results(uuid[], text);

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
    else
      update public.discovery_results set status = 'duplicate' where id = r.id; duplicates := duplicates + 1;
    end if;
  end loop;
  return query select n_in, added, duplicates;
end $f$;

revoke all on function public.approve_discovery_results(uuid[], text, boolean) from public, anon;
grant execute on function public.approve_discovery_results(uuid[], text, boolean) to authenticated;

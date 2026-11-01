-- 066: Excel import — filling the phone of stores that already exist must never hit the unique phone rule.
-- Before: if the phone in the file already belonged to another client, fill_missing_phones failed with
--         "duplicate key value violates unique constraint leads_phone_key_unique" and the import showed an error.
-- Now:    a phone that is already used by any client (or repeated in the same file) is skipped, the rest are filled.
-- Same signature and permissions as before. Safe to run more than once.

create or replace function public.fill_missing_phones(rows jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  if coalesce(public.my_role(), '') not in ('admin','manager') then
    raise exception 'Only admin or manager can import phones';
  end if;
  with raw as (
    select r ->> 'website_key' as website_key,
           nullif(regexp_replace(coalesce(r ->> 'phone', ''), '[^0-9+]', '', 'g'), '') as phone
    from jsonb_array_elements(rows) r
  ), src as (
    -- one row per phone: the same number on two stores in the file is filled only once
    select distinct on (public.phone_key(phone)) website_key, phone
    from raw
    where website_key is not null and phone is not null and public.phone_key(phone) is not null
    order by public.phone_key(phone), website_key
  ), upd as (
    update public.leads l
       set phone = s.phone, phone_source = 'manual', updated_at = now()
      from src s
     where l.website_key = s.website_key
       and (l.phone is null or l.phone = '')
       and not exists (select 1 from public.leads x where x.phone_key = public.phone_key(s.phone))
    returning 1
  ) select count(*) into n from upd;
  return n;
end $function$;

-- check: the function exists and still returns integer
select pg_get_function_result('public.fill_missing_phones(jsonb)'::regprocedure) as returns;  -- integer

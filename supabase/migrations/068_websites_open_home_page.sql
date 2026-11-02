-- 068: every client's website opens on the site's HOME page, not on an inner page (blog post, product, /contact …).
--
--   https://www.example.com/blog/post-1?utm=x   →  https://www.example.com/
--   http://shop.com/ar/products/12              →  http://shop.com/
--   salla.sa/mystore/products/abc               →  https://salla.sa/mystore/      (shared platform: the store page)
--   instagram.com/brand/reels                   →  https://instagram.com/brand/
--   a bare platform page (salla.sa, instagram.com …) or text that is not a link → left as it is
-- www. and http:// are kept when the original had them (some sites only answer that way).
-- The site key (067) does not change, so no new duplicates can appear.
--
-- Also: from now on every website saved (Add lead, Excel import, Lead discovery, client card) is stored as the home page,
-- and the website check of every changed client is cleared so the next "Website checks" run checks the home page.
--
-- Needs 067 (public.site_key). Run PART 1 to see how many change, then the whole file. Safe to run more than once.

-- ============================== PART 1: function + preview (no data changes) ==============================

create or replace function public.site_home(p_url text) returns text language plpgsql immutable as $f$
declare k text := public.site_key(p_url); s text; h text; scheme text; www text;
begin
  if k is null then return null; end if;
  s := lower(btrim(p_url));
  scheme := case when s ~ '^http://' then 'http://' else 'https://' end;
  s := regexp_replace(regexp_replace(s, '^[a-z][a-z0-9+.-]*://', ''), '^[^/@]*@', '');
  h := rtrim(regexp_replace(split_part(split_part(split_part(s, '/', 1), '?', 1), '#', 1), ':[0-9]+$', ''), '.');
  www := substring(h from '^(www[0-9]*\.)');
  -- keep www. only when it is the same host as the key (not an alias such as www.twitter.com → x.com)
  if www is not null and regexp_replace(h, '^www[0-9]*\.', '') <> split_part(k, '/', 1) then www := null; end if;
  return scheme || coalesce(www, '') || k || '/';
end $f$;

-- Preview
select count(*) as clients_whose_link_changes
from public.leads
where website is not null and public.site_home(website) is not null and website is distinct from public.site_home(website);

-- (optional) 30 examples: before → after
-- select client_code, website as before, public.site_home(website) as after from public.leads
-- where website is not null and public.site_home(website) is not null and website is distinct from public.site_home(website) limit 30;

-- ============================== PART 2: apply (changes data) ==============================
set statement_timeout = 0;

-- website saved as the home page + website_key from it (replaces 067's trigger function; same trigger)
create or replace function public._leads_site_key() returns trigger language plpgsql as $f$
begin
  new.website := coalesce(public.site_home(new.website), new.website);
  new.website_key := public.site_key(new.website);
  return new;
end $f$;

-- existing clients: link → home page; the old automatic check is cleared (a manual status is kept)
update public.leads l set
  website = public.site_home(l.website),
  website_checked_at     = null,
  website_status         = case when l.website_status_source = 'manual' then l.website_status end,
  website_status_source  = case when l.website_status_source = 'manual' then 'manual' end,
  website_check_category = null,
  website_check_note     = null,
  website_http_status    = null
where l.website is not null
  and public.site_home(l.website) is not null
  and l.website is distinct from public.site_home(l.website);

-- Salla stores that were closed / expired redirect to salla.com; the old check called them "working".
update public.leads set
  website_status = 'not_working', website_status_source = 'auto_checked', website_check_category = 'store_closed',
  website_check_note = 'المتجر مقفول أو اشتراكه في سلة انتهى — الرابط بيحوّل على صفحة سلة الرئيسية بدل المتجر.',
  is_salla_store = true
where website_status_source is distinct from 'manual'
  and website_check_note ~* 'تم تحويله إلى (www\.)?(salla\.com|salla\.sa|s\.salla\.sa)\)';

-- ============================== check ==============================
select
  (select count(*) from public.leads where website is not null and public.site_home(website) is not null
     and website is distinct from public.site_home(website)) as links_not_home_left,                       -- 0
  public.site_home('https://www.example.com/blog/post-1?utm=x') as test_1,                                  -- https://www.example.com/
  public.site_home('salla.sa/mystore/products/abc') as test_2,                                              -- https://salla.sa/mystore/
  public.site_home('https://salla.sa/') as test_3;                                                          -- NULL (left as it is)

-- 052: leads RLS — evaluate the role/team helpers once per query instead of once per row
-- Already applied to production (kept for history). Do not re-run unless rebuilding the DB.
-- Fixes manager pages timing out: RLS on leads called is_admin()/get_my_team_ids() per row (31k rows).
-- Wrapping each call in (select ...) lets Postgres run it once (InitPlan).
-- Depends on: is_admin(), get_my_team_ids(), get_my_role() (base DB, not in the repo) · my_role() · "admin full access" (024/039)

alter policy leads_select on public.leads using ((select public.is_admin()) or assigned_to = (select auth.uid()) or assigned_to in (select unnest(public.get_my_team_ids())));
alter policy leads_update on public.leads using ((select public.is_admin()) or assigned_to = (select auth.uid()) or assigned_to in (select unnest(public.get_my_team_ids())))
  with check ((select public.is_admin()) or assigned_to = (select auth.uid()) or assigned_to in (select unnest(public.get_my_team_ids())));
alter policy leads_insert on public.leads with check ((select public.is_admin()) or (select public.get_my_role()) = 'manager');
alter policy "admin full access" on public.leads using ((select public.my_role()) = 'admin') with check ((select public.my_role()) = 'admin');

-- 027: أي FK بيشاور على الجدول القديم profiles يتحول لـ public.users
-- بيحافظ على نفس ON DELETE، وبيتخطى أي FK فيه صفوف يتيمة (بيطبعها في NOTICE)
do $$
declare r record; v_def text; v_orphans bigint;
begin
  if to_regclass('public.profiles') is null then
    raise notice 'profiles table not found - nothing to do'; return;
  end if;

  for r in
    select c.oid, c.conname, c.conrelid::regclass as tbl,
           (select a.attname from pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) as col,
           pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
  loop
    -- صفوف قيمتها مش موجودة في users؟
    execute format(
      'select count(*) from %s t where t.%I is not null and not exists (select 1 from public.users u where u.id = t.%I)',
      r.tbl, r.col, r.col) into v_orphans;

    if v_orphans > 0 then
      raise notice 'SKIP % on % (%): % orphan rows', r.conname, r.tbl, r.col, v_orphans;
      continue;
    end if;

    v_def := regexp_replace(r.def, 'REFERENCES\s+(public\.)?profiles\s*\(', 'REFERENCES public.users(');
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, v_def);
    raise notice 'FIXED % on % (%)', r.conname, r.tbl, r.col;
  end loop;
end $$;

-- تحقق: المفروض مفيش أي FK لسه بيشاور على profiles
select c.conname, c.conrelid::regclass as on_table, c.confrelid::regclass as references_table
from pg_constraint c
where c.contype = 'f' and c.confrelid in ('public.profiles'::regclass, 'public.users'::regclass)
order by 3, 2;

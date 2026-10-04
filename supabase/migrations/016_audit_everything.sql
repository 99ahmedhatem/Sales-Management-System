-- =====================================================================
-- 016 — تسجيل كل حاجة مهمة بتحصل في السستم (audit_log) + دالة لعرضها بأسماء الموظفين.
-- بيكمّل اللي موجود من 009 (الإعدادات، الصفقات، المدفوعات، أدوار المستخدمين).
-- مفيش تعديل في أي بيانات موجودة. آمن لو اتشغّل تاني.
-- =====================================================================

-- نسخة خفيفة من التسجيل: بتخزّن الحقول المهمة بس (مش الصف كله) عشان التوزيع/الاستيراد الكبير ما يتقلش.
create or replace function public.trg_audit_lean()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_keys text[] := tg_argv;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into public.audit_log (table_name, row_id, action, changed_by, old_data, new_data)
  values (
    tg_table_name, v_row ->> 'id', tg_op, auth.uid(),
    (select jsonb_object_agg(k, v_old -> k) from unnest(v_keys) k where v_old is not null),
    (select jsonb_object_agg(k, v_new -> k) from unnest(v_keys) k where v_new is not null)
  );
  return null;
end $$;

do $$
begin
  -- العملاء: تغيّر الحالة / التوزيع / التليفون / الحذف / الإضافة اليدوية
  drop trigger if exists audit_leads_upd on public.leads;
  create trigger audit_leads_upd after update on public.leads for each row
    when (old.status is distinct from new.status or old.assigned_to is distinct from new.assigned_to
          or old.phone is distinct from new.phone or old.loss_reason is distinct from new.loss_reason)
    execute function public.trg_audit_lean('name','status','assigned_to','phone','loss_reason');
  drop trigger if exists audit_leads_del on public.leads;
  create trigger audit_leads_del after delete on public.leads for each row
    execute function public.trg_audit_lean('name','customer_number','status','assigned_to','phone');

  -- الميتنجز وطلبات الميتنج
  drop trigger if exists audit_meetings on public.meetings;
  create trigger audit_meetings after insert or update or delete on public.meetings for each row
    execute function public.trg_audit_lean('lead_id','booked_by','assigned_sales_id','proposed_date','outcome','loss_reason');
  drop trigger if exists audit_meeting_requests on public.meeting_requests;
  create trigger audit_meeting_requests after insert or update or delete on public.meeting_requests for each row
    execute function public.trg_audit_lean('lead_id','requested_by','assigned_sales_id','status','preferred_date');

  -- الصفقات: الإنشاء والحذف كمان (التعديل على الحالة/السعر متسجّل من 009)
  drop trigger if exists audit_deals_ins on public.deals;
  create trigger audit_deals_ins after insert or delete on public.deals for each row
    execute function public.trg_audit_lean('lead_id','package_id','closed_by_user_id','price_sar','status');

  -- مراجعات العقود
  if to_regclass('public.contract_reviews') is not null then
    drop trigger if exists audit_contract_reviews on public.contract_reviews;
    create trigger audit_contract_reviews after insert or update of status on public.contract_reviews for each row
      execute function public.trg_audit_lean('deal_id','status');
  end if;

  -- المستخدمين: إضافة / حذف / تغيير نسبة العمولة (تغيير الدور والحالة متسجّل من 009)
  drop trigger if exists audit_users_ins on public.users;
  create trigger audit_users_ins after insert or delete on public.users for each row
    execute function public.trg_audit_lean('full_name','email','role','manager_id','status');
  drop trigger if exists audit_users_commission on public.users;
  create trigger audit_users_commission after update of commission_percent on public.users for each row
    when (old.commission_percent is distinct from new.commission_percent)
    execute function public.trg_audit_lean('full_name','commission_percent');
end $$;

create index if not exists audit_log_user_idx on public.audit_log (changed_by, created_at desc);

-- عرض السجل للأدمن بأسماء الموظفين، مع فلاتر وصفحات
create or replace function public.get_audit_feed(
  p_limit int default 100, p_offset int default 0,
  p_table text default null, p_user uuid default null,
  p_from timestamptz default null, p_to timestamptz default null)
returns table (id bigint, created_at timestamptz, table_name text, action text, row_id text,
               changed_by uuid, changed_by_name text, old_data jsonb, new_data jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Only admin can read the audit log';
  end if;
  return query
    select a.id, a.created_at, a.table_name, a.action, a.row_id, a.changed_by,
           coalesce(u.full_name, case when a.changed_by is null then 'System / SQL' end), a.old_data, a.new_data
    from public.audit_log a left join public.users u on u.id = a.changed_by
    where (p_table is null or a.table_name = p_table)
      and (p_user is null or a.changed_by = p_user)
      and (p_from is null or a.created_at >= p_from)
      and (p_to is null or a.created_at < p_to)
    order by a.created_at desc, a.id desc
    limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0);
end $$;
revoke execute on function public.get_audit_feed(int,int,text,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_audit_feed(int,int,text,uuid,timestamptz,timestamptz) to authenticated;

-- ملخص لكل جدول (للفلتر)
create or replace function public.get_audit_tables()
returns table (table_name text, events bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'admin' then raise exception 'Only admin'; end if;
  return query select a.table_name, count(*) from public.audit_log a group by 1 order by 2 desc;
end $$;
revoke execute on function public.get_audit_tables() from public, anon;
grant execute on function public.get_audit_tables() to authenticated;

notify pgrst, 'reload schema';

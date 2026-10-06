-- 051: إصلاح الكومنتات — add_lead_comment (034 / 041) كان بيبعت إشعار بنوع 'comment'،
-- والنوع ده مش مسموح في notifications.type على الداتابيز الحقيقية (زي ما 050 بيقول)،
-- فأي كومنت على عميل صاحبه حد تاني كان بيفشل كله.
-- الحل: نوع 'system'، والإشعار جوه begin/exception عشان فشله ما يوقفش حفظ الكومنت.
-- نفس نسخة 041 (بتتعامل مع أعمدة client_comments الفعلية عن طريق _add_comment). آمن للتكرار.
set lock_timeout = 0;

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
    begin
      insert into public.notifications (user_id, type, title, message)
      values (owner, 'system', 'تعليق جديد على عميل', coalesce(nm,'-') || ': ' || left(t, 120));
    exception when others then null;
    end;
  end if;
  return cid;
end $$;

revoke all on function public.add_lead_comment(uuid, text) from public, anon;
grant execute on function public.add_lead_comment(uuid, text) to authenticated;

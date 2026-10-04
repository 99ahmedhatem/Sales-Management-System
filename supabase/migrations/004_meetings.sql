-- جدول الاجتماعات (migrations الـ AI بتفترض إنه موجود)
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  booked_by uuid not null references public.users(id),
  assigned_sales_id uuid not null references public.users(id),
  proposed_date timestamptz not null,
  telesales_notes text,
  outcome text not null default 'Scheduled'
    check (outcome in ('Scheduled','Deal Closed – Won','Deal Lost','Rescheduled','No-Show')),
  created_at timestamptz not null default now()
);
create index if not exists meetings_sales_idx on public.meetings (assigned_sales_id, proposed_date);
alter table public.meetings enable row level security;
do $$ begin
  begin alter publication supabase_realtime add table public.meetings; exception when duplicate_object then null; end;
end $$;

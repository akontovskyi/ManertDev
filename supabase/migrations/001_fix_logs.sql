-- SentinelDev fix_logs table (Supabase PostgreSQL)
-- Paste into: https://supabase.com/dashboard/project/qxdzxathzywokwcxobtg/sql/new

create extension if not exists "pgcrypto";

create table if not exists public.fix_logs (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz not null default now(),
  severity text not null check (severity in ('Critical', 'High', 'Medium', 'Low', 'Info')),
  description text not null,
  evidence_snippet text not null,
  proposed_remediation text not null,
  category text,
  file_path text,
  line_number integer,
  status text not null default 'proposed'
    check (status in ('open', 'proposed', 'applied', 'dismissed')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fix_logs_timestamp_idx on public.fix_logs (timestamp desc);
create index if not exists fix_logs_severity_idx on public.fix_logs (severity);

alter table public.fix_logs enable row level security;

drop policy if exists "Allow read fix_logs" on public.fix_logs;
drop policy if exists "Allow insert fix_logs" on public.fix_logs;
drop policy if exists "Allow update fix_logs" on public.fix_logs;

-- Dev-friendly policies: tighten for production (auth.uid() checks).
create policy "Allow read fix_logs"
  on public.fix_logs for select
  using (true);

create policy "Allow insert fix_logs"
  on public.fix_logs for insert
  with check (true);

create policy "Allow update fix_logs"
  on public.fix_logs for update
  using (true);

-- SentinelDev fix_logs table (Supabase PostgreSQL)
-- Prefer running 002_fix_logs_projects.sql (includes project fields).
-- Paste into: https://supabase.com/dashboard/project/qxdzxathzywokwcxobtg/sql/new

create extension if not exists "pgcrypto";

create table if not exists public.fix_logs (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz not null default now(),
  detected_at timestamptz not null default now(),
  fixed_at timestamptz,
  severity text not null check (severity in ('Critical', 'High', 'Medium', 'Low', 'Info')),
  problem_type text not null default 'general',
  description text not null,
  evidence_snippet text not null,
  proposed_remediation text not null,
  project_name text,
  project_details text,
  category text,
  file_path text,
  line_number integer,
  status text not null default 'proposed'
    check (status in ('open', 'proposed', 'applied', 'fixed', 'dismissed')),
  fixed boolean not null default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fix_logs_timestamp_idx on public.fix_logs (timestamp desc);
create index if not exists fix_logs_severity_idx on public.fix_logs (severity);
create index if not exists fix_logs_project_idx on public.fix_logs (project_name);
create index if not exists fix_logs_fixed_idx on public.fix_logs (fixed);

alter table public.fix_logs enable row level security;

drop policy if exists "Allow read fix_logs" on public.fix_logs;
drop policy if exists "Allow insert fix_logs" on public.fix_logs;
drop policy if exists "Allow update fix_logs" on public.fix_logs;

create policy "Allow read fix_logs"
  on public.fix_logs for select
  using (true);

create policy "Allow insert fix_logs"
  on public.fix_logs for insert
  with check (true);

create policy "Allow update fix_logs"
  on public.fix_logs for update
  using (true);

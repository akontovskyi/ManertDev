-- SentinelDev fix_logs — full schema with project + problem tracking
-- Run in: https://supabase.com/dashboard/project/qxdzxathzywokwcxobtg/sql/new
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

create extension if not exists "pgcrypto";

create table if not exists public.fix_logs (
  id uuid primary key default gen_random_uuid(),
  -- When the issue was detected
  timestamp timestamptz not null default now(),
  detected_at timestamptz not null default now(),
  -- When it was marked fixed (null = not fixed yet)
  fixed_at timestamptz,
  -- Problem classification
  severity text not null check (severity in ('Critical', 'High', 'Medium', 'Low', 'Info')),
  problem_type text not null default 'general',
  description text not null,
  evidence_snippet text not null,
  proposed_remediation text not null,
  -- Project context
  project_name text,
  project_details text,
  -- Location
  category text,
  file_path text,
  line_number integer,
  -- Workflow: open → proposed → fixed/applied/dismissed
  status text not null default 'proposed'
    check (status in ('open', 'proposed', 'applied', 'fixed', 'dismissed')),
  fixed boolean not null default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Upgrade path if table already existed from 001
alter table public.fix_logs add column if not exists detected_at timestamptz default now();
alter table public.fix_logs add column if not exists fixed_at timestamptz;
alter table public.fix_logs add column if not exists problem_type text default 'general';
alter table public.fix_logs add column if not exists project_name text;
alter table public.fix_logs add column if not exists project_details text;
alter table public.fix_logs add column if not exists fixed boolean default false;

-- Relax status check to allow 'fixed' (drop + recreate if needed)
do $$
begin
  alter table public.fix_logs drop constraint if exists fix_logs_status_check;
exception when undefined_object then null;
end $$;

alter table public.fix_logs
  drop constraint if exists fix_logs_status_check;

alter table public.fix_logs
  add constraint fix_logs_status_check
  check (status in ('open', 'proposed', 'applied', 'fixed', 'dismissed'));

create index if not exists fix_logs_timestamp_idx on public.fix_logs (timestamp desc);
create index if not exists fix_logs_severity_idx on public.fix_logs (severity);
create index if not exists fix_logs_project_idx on public.fix_logs (project_name);
create index if not exists fix_logs_fixed_idx on public.fix_logs (fixed);
create index if not exists fix_logs_problem_type_idx on public.fix_logs (problem_type);

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

-- Example insert (manual):
-- insert into public.fix_logs (
--   timestamp, detected_at, severity, problem_type, description,
--   evidence_snippet, proposed_remediation, project_name, project_details,
--   file_path, line_number, status, fixed
-- ) values (
--   now(), now(), 'High', 'exposed_endpoint',
--   'Admin route without auth',
--   'app.get(''/admin/users'')',
--   'Add requireSession middleware',
--   'SentinelDev',
--   'In-dev security helper CLI',
--   'fixtures/vulnerable-sample.ts', 7,
--   'proposed', false
-- );

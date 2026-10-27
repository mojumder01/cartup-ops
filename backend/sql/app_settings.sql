-- Team settings: data and rules the team edits from the frontend (Settings
-- page): category attributes, Daraz → CartUp categories, CartUp categories,
-- rules & defaults. Run once in Supabase → SQL Editor. Safe to run again.

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Every change (and every reset to the built-in copy), so it can be seen and restored.
create table if not exists public.app_settings_history (
  id          bigserial primary key,
  key         text not null,
  value       jsonb,               -- null: reset to the copy built into the app
  version     integer not null,
  changed_at  timestamptz not null default now(),
  changed_by  text,
  note        text
);
create index if not exists app_settings_history_key on public.app_settings_history (key, id desc);

-- Signed-in users read and change them (the backend acts as the user).
alter table public.app_settings enable row level security;
alter table public.app_settings_history enable row level security;

drop policy if exists "signed in read settings" on public.app_settings;
create policy "signed in read settings" on public.app_settings for select to authenticated using (true);
drop policy if exists "signed in write settings" on public.app_settings;
create policy "signed in write settings" on public.app_settings for all to authenticated using (true) with check (true);

drop policy if exists "signed in read history" on public.app_settings_history;
create policy "signed in read history" on public.app_settings_history for select to authenticated using (true);
drop policy if exists "signed in add history" on public.app_settings_history;
create policy "signed in add history" on public.app_settings_history for insert to authenticated with check (true);

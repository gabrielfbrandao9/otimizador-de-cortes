-- Otimizador de Cortes — banco de dados no Supabase
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Sem nome',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- evita abusos: um projeto não pode passar de ~1 MB
  constraint projects_data_size check (pg_column_size(data) < 1000000)
);

create index if not exists projects_user_updated_idx on public.projects (user_id, updated_at desc);

-- Segurança: cada pessoa só enxerga e altera os próprios projetos
alter table public.projects enable row level security;

drop policy if exists "Ver os próprios projetos" on public.projects;
create policy "Ver os próprios projetos" on public.projects
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Criar os próprios projetos" on public.projects;
create policy "Criar os próprios projetos" on public.projects
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Alterar os próprios projetos" on public.projects;
create policy "Alterar os próprios projetos" on public.projects
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Excluir os próprios projetos" on public.projects;
create policy "Excluir os próprios projetos" on public.projects
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.projects to authenticated;

-- Atualiza updated_at automaticamente
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ============================================================
-- ClipFactory / WaveCombat Hub — Tabelas e Políticas RLS (v0.031)
-- Execute este script no SQL Editor do Supabase se necessário
-- ============================================================

create table if not exists public.usuarios (
  id_jogador text primary key,
  nick text not null,
  senha text,
  created_at timestamptz not null default now()
);

create table if not exists public.carteira_diamantes (
  id_jogador text primary key references public.usuarios(id_jogador) on delete cascade,
  diamantes integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.assinaturas (
  id_jogador text primary key,
  inicio timestamptz not null default now(),
  fim timestamptz not null,
  limite_diario integer not null default 20,
  clipes_hoje integer not null default 0,
  dia_uso date not null default current_date,
  updated_at timestamptz not null default now()
);

create table if not exists public.creditos_videos (
  id_jogador text primary key,
  videos_restantes integer not null default 0,
  videos_comprados_total integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.conexoes_sociais (
  id uuid primary key default gen_random_uuid(),
  id_jogador text not null references public.usuarios(id_jogador) on delete cascade,
  provedor text not null check (provedor in ('youtube', 'tiktok', 'instagram', 'facebook', 'kwai')),
  status text not null default 'desconectado' check (status in ('conectado', 'desconectado', 'expirado')),
  conta_nome text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id_jogador, provedor)
);

alter table public.usuarios enable row level security;
alter table public.assinaturas enable row level security;
alter table public.creditos_videos enable row level security;
alter table public.carteira_diamantes enable row level security;
alter table public.conexoes_sociais enable row level security;

drop policy if exists "usuarios_select_all" on public.usuarios;
create policy "usuarios_select_all" on public.usuarios for select using (true);

drop policy if exists "assinaturas_select_all" on public.assinaturas;
drop policy if exists "assinaturas_insert_all" on public.assinaturas;
drop policy if exists "assinaturas_update_all" on public.assinaturas;
create policy "assinaturas_select_all" on public.assinaturas for select using (true);
create policy "assinaturas_insert_all" on public.assinaturas for insert with check (true);
create policy "assinaturas_update_all" on public.assinaturas for update using (true) with check (true);

drop policy if exists "creditos_videos_select_all" on public.creditos_videos;
drop policy if exists "creditos_videos_insert_all" on public.creditos_videos;
drop policy if exists "creditos_videos_update_all" on public.creditos_videos;
create policy "creditos_videos_select_all" on public.creditos_videos for select using (true);
create policy "creditos_videos_insert_all" on public.creditos_videos for insert with check (true);
create policy "creditos_videos_update_all" on public.creditos_videos for update using (true) with check (true);

drop policy if exists "carteira_diamantes_select_all" on public.carteira_diamantes;
drop policy if exists "carteira_diamantes_insert_all" on public.carteira_diamantes;
drop policy if exists "carteira_diamantes_update_all" on public.carteira_diamantes;
create policy "carteira_diamantes_select_all" on public.carteira_diamantes for select using (true);
create policy "carteira_diamantes_insert_all" on public.carteira_diamantes for insert with check (true);
create policy "carteira_diamantes_update_all" on public.carteira_diamantes for update using (true) with check (true);

drop policy if exists "conexoes_sociais_select_all" on public.conexoes_sociais;
drop policy if exists "conexoes_sociais_insert_all" on public.conexoes_sociais;
drop policy if exists "conexoes_sociais_update_all" on public.conexoes_sociais;
create policy "conexoes_sociais_select_all" on public.conexoes_sociais for select using (true);
create policy "conexoes_sociais_insert_all" on public.conexoes_sociais for insert with check (true);
create policy "conexoes_sociais_update_all" on public.conexoes_sociais for update using (true) with check (true);

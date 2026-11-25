-- ============================================================
-- ClipFactory / WaveCombat Hub — Tabelas e Políticas RLS (v0.030)
-- Execute este script no SQL Editor do Supabase se necessário
-- ============================================================

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

alter table public.assinaturas enable row level security;
alter table public.creditos_videos enable row level security;
alter table public.carteira_diamantes enable row level security;

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

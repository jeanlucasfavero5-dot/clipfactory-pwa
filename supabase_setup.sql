-- ============================================================
-- ClipFactory / WaveCombat Hub — Tabelas, RLS e RPC Atômica (v0.017)
-- Execute este script no SQL Editor do Supabase
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

alter table public.assinaturas
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.creditos_videos (
  id_jogador text primary key,
  videos_restantes integer not null default 0,
  videos_comprados_total integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.creditos_videos
  add column if not exists updated_at timestamptz not null default now();

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

-- Função atômica para descontar 1 vídeo disponível (prioriza cota diária da assinatura, depois avulso)
create or replace function public.consumir_video_download(p_id_jogador text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_hoje date := (now() at time zone 'UTC')::date;
  v_sub record;
  v_usados integer := 0;
  v_limite integer := 20;
  v_avulso integer := 0;
begin
  select * into v_sub
  from public.assinaturas
  where id_jogador = p_id_jogador
  for update;

  if found and v_sub.fim > now() then
    v_limite := coalesce(v_sub.limite_diario, 20);
    if v_sub.dia_uso = v_hoje then
      v_usados := coalesce(v_sub.clipes_hoje, 0);
    else
      v_usados := 0;
    end if;

    if v_usados < v_limite then
      v_usados := v_usados + 1;
      update public.assinaturas
      set clipes_hoje = v_usados,
          dia_uso = v_hoje
      where id_jogador = p_id_jogador;

      return jsonb_build_object(
        'ok', true,
        'origem', 'assinatura',
        'clipes_hoje', v_usados,
        'limite_diario', v_limite,
        'dia_uso', v_hoje::text
      );
    end if;
  end if;

  select coalesce(videos_restantes, 0) into v_avulso
  from public.creditos_videos
  where id_jogador = p_id_jogador
  for update;

  if found and v_avulso > 0 then
    v_avulso := v_avulso - 1;
    update public.creditos_videos
    set videos_restantes = v_avulso
    where id_jogador = p_id_jogador;

    return jsonb_build_object(
      'ok', true,
      'origem', 'avulso',
      'videos_restantes', v_avulso
    );
  end if;

  return jsonb_build_object('ok', false, 'motivo', 'sem_saldo_videos');
end;
$$;

-- Função de estorno automático caso o download falhe após o desconto
create or replace function public.estornar_video_download(p_id_jogador text, p_origem text)
returns void
language plpgsql
security definer
as $$
declare
  v_hoje date := (now() at time zone 'UTC')::date;
begin
  if p_origem = 'assinatura' then
    update public.assinaturas
    set clipes_hoje = greatest(0, coalesce(clipes_hoje, 0) - 1)
    where id_jogador = p_id_jogador
      and dia_uso = v_hoje;
  elsif p_origem = 'avulso' then
    update public.creditos_videos
    set videos_restantes = coalesce(videos_restantes, 0) + 1
    where id_jogador = p_id_jogador;
  end if;
end;
$$;

grant execute on function public.consumir_video_download(text) to anon, authenticated;
grant execute on function public.estornar_video_download(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

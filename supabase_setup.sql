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

alter table public.conexoes_sociais enable row level security;

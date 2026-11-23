# ClipFactory PWA × Hub WaveCombat (v0.015)

## Arquivos incluídos neste pacote
- `index.html`: Splash screen de 2s e redirecionamento para `login.html`.
- `login.html`: Tela de login integrada ao Supabase (`usuarios`, `carteira_diamantes` e Auth) + checagem de versão.
- `editor.html`: Editor vertical 9:16 com enquadramento câmera + jogo, análise heurística, legendas, gancho e exportação.
- `presets.js`: Paletas e 50+ presets de estilo para legenda e gancho.
- `app.js`: Motor de renderização 9:16, remux WebM (ts-ebml), conversor MP4 (`ffmpeg.wasm` single-thread) e AVI MJPEG.
- `wallet.js`: Integração com carteira de diamantes, assinatura semanal (7 dias · 20/dia), pacotes adicionais (+5 / +10) e consumo atômico sem desconto em caso de erro.
- `supabase_setup.sql`: Tabelas, políticas RLS e funções RPC (`consumir_video_download` e `estornar_video_download`).
- `manifest.json`, `sw.js`, `version.json`: Configuração do PWA e cache offline.

## Como implantar
1. Rode o arquivo `supabase_setup.sql` no SQL Editor do Supabase.
2. Copie os arquivos de imagem existentes (`splash-bg.jpg`, `icon-192.png`, `icon-512.png`) para a mesma pasta destes arquivos.
3. Publique a pasta completa na hospedagem (GitHub Pages / Render / Vercel).

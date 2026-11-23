# ClipFactory PWA (v0.002)

Pacote completo unificado na paleta escura/verde neon (`#030705`, `#07140e`, `#22c55e`) com as funções do editor de cortes verticais 9:16 e integração com o Hub WaveCombat e Supabase.

## Arquivos incluídos neste pacote
- `login.html` — Tela de login com Supabase Auth / `usuarios` + leitura de `carteira_diamantes`, instalação PWA e verificação de versão.
- `editor.html` — Editor completo com upload/arraste de vídeo, enquadramento de câmera e jogo, timeline com janela de análise, análise heurística de melhores momentos, prévia 9:16 em canvas, presets de legenda e gancho, legendas manuais/Whisper/.SRT, exportação e integração com a carteira/planos.
- `app.js` — Lógica completa do editor, análise, prévia em canvas e exportação.
- `presets.js` — Presets de estilos de legenda e gancho, paletas de cores, títulos e hashtags.
- `wallet.js` — Integração com Supabase (`usuarios` e `carteira_diamantes`), planos (`pack5`, `pack10`, `weekly`), durações (`30s` e `60s`), jobs e assinatura.
- `manifest.json` — Manifesto PWA (`start_url: ./login.html`, `display: standalone`).
- `sw.js` — Service Worker (`clipfactory-pwa-v0.002`).
- `version.json` — Controle de versão (`0.002`).

> Lembre-se de manter na pasta os arquivos de imagem `icon-192.png` e `icon-512.png` que você já possui.

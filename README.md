# ClipFactory PWA × Hub WaveCombat (v0.018)

## Correções desta versão (v0.018)
1. **Duração exata em todos os formatos e resoluções (WebM, MP4 30/60fps e AVI 30/60fps):**
   - WebM e MP4 agora utilizam relógio mestre baseado em tempo real decorrido (`performance.now()`) durante toda a janela selecionada (`30s` ou `60s`), impedindo cortes prematuros na metade do tempo (como `15s` em vez de `30s`) quando há oscilação de renderização no navegador.
   - Remux EBML (`fixWebmBlobDuration`) e `ffmpeg.wasm` (`-vsync cfr -r <fps> -t <duracao_exata>`) gravam a duração total cravada.
   - AVI MJPEG renderiza exatamente `Math.round(durationSec * fps)` frames determinísticos.
2. **Áudio garantido em todos os formatos (WebM, MP4 e AVI):**
   - `setupReliableAudioStream()` prioriza `captureStream()` direto do `<video>` quando disponível e utiliza `WebAudio API` (`MediaElementAudioSourceNode`) com oscilador keep-alive inaudível (`-90dB`) para evitar suspensão/perda da faixa de áudio no `MediaRecorder`.
   - MP4 converte áudio com AAC `44100Hz` estéreo e `aresample=async=1:first_pts=0`.
   - AVI decodifica a faixa de áudio real do arquivo original e empacota chunks PCM (`01wb`) sincronizados frame a frame com o vídeo (`00dc`).
3. **Título predefinido e Hashtags (`#`) gravados no vídeo e no nome do arquivo:**
   - O título viral do corte (ou texto do gancho) e as `#` hashtags do clipe são renderizados diretamente no canvas vertical 9:16 (na prévia e no vídeo exportado) e aplicados no nome do arquivo baixado e nos metadados MP4.
4. **Seleção de vídeo pós-login (`#drop` -> `#fileInput`) mantida blindada.**

## Como instalar
- Copie também os arquivos estáticos de imagem da sua pasta anterior (`splash-bg.jpg`, `icon-192.png`, `icon-512.png`) para a mesma pasta junto com todos os arquivos deste `.zip` e suba para o GitHub.

====================================================================
CONTEXTO COMPLETO DO PROJETO — CLIPFACTORY PWA × HUB WAVECOMBAT
Versão atual: v0.017 | Data: 2026-11-23
====================================================================

1. IDENTIDADE DO CRIADOR & ECOSSISTEMA
- Criador: Jean Lucas Favero (alias dev: "capudo oficial" / "CAPUDO OFC", handle gamer: "capudo7", marca esports: "LASTIMA SQUAD" / "lastimável").
- Hub integrado: WaveCombat Hub (https://wavecombat-hub.onrender.com/#inicio), onde os jogadores criam conta e compram diamantes.
- Backend / Banco de Dados: Supabase (URL: https://ipqjeacdfiomcxfuixdj.supabase.co).
- Estética padrão: Fundo escuro (#030705 / #07140e) com imagem splash-bg.jpg, cartões verde-escuros translúcidos (rgba(8,22,15,.94)), destaques em verde (#22c55e / #4ade80 / #86efac), detalhes dourados (#ffd166 / #f5c518), banner de atualização em vermelho escuro (#1a0608 / #991b1b) e selo de versão no canto inferior direito.

2. ESTRUTURA DA PASTA (clipfactory-pwa-v0.017/)
- index.html: Tela de splash/carregamento de 2s (CLIPFACTORY v0.017 · INICIANDO), registra sw.js e redireciona para login.html preservando querystring (?id=...).
- login.html: Autenticação via Supabase Auth (e-mail) ou tabela usuarios (id_jogador / nick + senha), leitura inicial de carteira_diamantes, lembrar usuário, checagem de versão via version.json e botão de instalação PWA.
- editor.html: Editor completo 9:16 em 7 seções recolhíveis:
  1) Envio de vídeo local (MP4, MOV, WEBM, MKV) com área #drop e #fileInput (.fileInputHidden).
  2) Enquadramento com caixas arrastáveis/redimensionáveis para Câmera e Jogo, barra divisória ajustável (splitRatio), modos Dividido / Só câmera / Só jogo, troca cima/baixo e janela de análise em minutos.
  3) Análise heurística de melhores momentos (nota 0–100: 50*PicoDeAudio + 30*Movimento + 20*Intensidade) com miniaturas, prévia modal 9:16 e download individual ou em lote.
  4) Prévia vertical 9:16 ao vivo no <canvas> com arraste direto da divisória, gancho e legenda.
  5) Legendas estilo CapCut (50+ presets em presets.js, fontes, cores, fundos, animações, transcrição opcional OpenAI Whisper e exportação .SRT).
  6) Gancho visual estilo CapCut (texto, 50+ presets, fontes, cores, fundos, animações e toggle).
  7) Exportação vertical (WebM com remux EBML/ts-ebml, MP4 H.264/AAC via ffmpeg.wasm single-thread e AVI MJPEG 30/60 fps).
- presets.js: Paletas de cores, 52 presets de legenda, 52 presets de gancho, títulos virais e hashtags.
- app.js: Motor de canvas 9:16, bindDropZone() blindado para abertura do seletor de vídeo, captura de áudio via WebAudio reutilizando MediaElementAudioSourceNode, remux EBML/WebM (fixWebmBlobDuration), transcodificação MP4 (transcodeWebmToMp4), empacotador AVI (buildAviFromJpegFrames) e fluxo seguro de exportação sem desconto em erro.
- wallet.js: Integração completa com Supabase (usuarios, carteira_diamantes, assinaturas, creditos_videos), planos pack5 (5 clipes = 100 diamantes), pack10 (10 clipes = 200 diamantes) e weekly (Assinatura 7 dias = 1000 diamantes, 20 clipes/dia), escolha de duração 30s ou 60s e sincronização do saldo de vídeos disponíveis.
- supabase_setup.sql: Criação das tabelas assinaturas e creditos_videos, políticas RLS e funções RPC atômicas consumir_video_download(p_id_jogador) e estornar_video_download(p_id_jogador, p_origem).
- manifest.json, sw.js, version.json, splash-bg.jpg, icon-192.png, icon-512.png: Ativos e configuração do PWA.

3. REGRAS DE NEGÓCIO & CORREÇÕES ATÉ A v0.017
- Clique em #drop para selecionar vídeo (v0.017): bindDropZone() usa addEventListener("click", ...) com e.preventDefault() e e.stopPropagation(), reseta inputEl.value = "" antes de inputEl.click(), escuta change no #fileInput e evita o bloqueio de .hidden (display: none !important) usando .fileInputHidden.
- Saldo de vídeos disponíveis na nuvem: Soma a cota diária restante da assinatura semanal ativa (ex.: 20/20) com os vídeos avulsos comprados em creditos_videos (ex.: +10/10 = 30/30 disponíveis). Ao baixar 1 vídeo com sucesso, passa para 29/30 e persiste no Supabase ao recarregar o app.
- Zero desconto em caso de erro:
  1) checkCanDownloadVideos(qtd) verifica antes de renderizar se há saldo suficiente, sem descontar nada.
  2) exportVerticalCut() renderiza e valida o arquivo final (WebM, MP4 ou AVI) com tamanho > 1024 bytes. Se falhar (ex.: erro no ffmpeg.wasm, rede ou gravação), retorna null e nada é descontado.
  3) Somente após o arquivo estar pronto, authorizeClipDownload() consome 1 vídeo via RPC atômica no Supabase (consumir_video_download) e atualiza a UI. Se o disparo do download falhar no navegador, refundOneVideoToCloud() estorna automaticamente.
- Exportação MP4 corrigida: Usa o WebM já remuxado com duração integral do trecho como entrada para o @ffmpeg/ffmpeg (core-st 0.11.1), gerando MP4 H.264/AAC com -movflags +faststart e duração completa (sem cortar nos primeiros segundos).

4. REGRAS DE COLABORAÇÃO NESTA CONVERSA
- Não gerar códigos, textos nem novas versões sem comando explícito do usuário.
- Ao gerar nova versão, entregar os arquivos atualizados e o arquivo de contexto atualizado para retomada segura.

5. COMO RETOMAR EM NOVAS CONVERSAS
- Cole o arquivo CONTEXTO_CLIPFACTORY_v0.017.md (ou os arquivos atualizados) e informe qual arquivo deseja modificar ou qual nova funcionalidade deseja implementar.
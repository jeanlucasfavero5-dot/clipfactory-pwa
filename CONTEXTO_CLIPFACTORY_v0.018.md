====================================================================
CONTEXTO COMPLETO DO PROJETO — CLIPFACTORY PWA × HUB WAVECOMBAT
Versão atual: v0.018 | Data: 2026-11-23
====================================================================

1. IDENTIDADE DO CRIADOR & ECOSSISTEMA
- Criador: Jean Lucas Favero (alias dev: "capudo oficial" / "CAPUDO OFC", handle gamer: "capudo7", marca esports: "LASTIMA SQUAD" / "lastimável").
- Hub integrado: WaveCombat Hub (https://wavecombat-hub.onrender.com/#inicio), onde os jogadores criam conta e compram diamantes.
- Backend / Banco de Dados: Supabase (URL: https://ipqjeacdfiomcxfuixdj.supabase.co).
- Estética padrão: Fundo escuro (#030705 / #07140e) com imagem splash-bg.jpg, cartões verde-escuros translúcidos (rgba(8,22,15,.94)), destaques em verde (#22c55e / #4ade80 / #86efac), detalhes dourados (#ffd166 / #f5c518), banner de atualização em vermelho escuro (#1a0608 / #991b1b) e selo de versão no canto inferior direito.

2. ESTRUTURA DA PASTA (clipfactory-pwa/)
- index.html: Tela de splash/carregamento de 2s (CLIPFACTORY v0.018 · INICIANDO), registra sw.js e redireciona para login.html preservando querystring (?id=...).
- login.html: Autenticação via Supabase Auth (e-mail) ou tabela usuarios (id_jogador / nick + senha), leitura inicial de carteira_diamantes, lembrar usuário, checagem de versão via version.json e botão de instalação PWA.
- editor.html: Editor completo 9:16 em 7 seções recolhíveis:
  1) Envio de vídeo local (MP4, MOV, WEBM, MKV) com bindDropZone() blindado.
  2) Enquadramento com caixas arrastáveis/redimensionáveis para Câmera e Jogo, barra divisória ajustável (splitRatio), modos Dividido / Só câmera / Só jogo, troca cima/baixo e janela de análise em minutos.
  3) Análise heurística de melhores momentos (nota 0–100: 50*PicoDeAudio + 30*Movimento + 20*Intensidade) com miniaturas, prévia modal 9:16 e download individual ou em lote.
  4) Prévia vertical 9:16 ao vivo no <canvas> com arraste direto da divisória, gancho/título e legenda, exibindo também o banner inferior com as # hashtags.
  5) Legendas estilo CapCut (52 presets em presets.js, fontes, cores, fundos, animações, transcrição opcional OpenAI Whisper e exportação .SRT).
  6) Gancho / Título visual estilo CapCut (texto predefinido pelo título viral do corte, 52 presets, fontes, cores, fundos, animações e toggle).
  7) Exportação vertical (WebM, MP4 H.264/AAC via ffmpeg.wasm e AVI MJPEG+PCM 30/60 fps) com duração exata (30s ou 60s), áudio garantido e título + # gravados no vídeo e no nome do arquivo.
- presets.js: Paletas de cores, 52 presets de legenda, 52 presets de gancho, títulos virais e hashtags.
- app.js: Motor de canvas 9:16 com quebra automática de linha, renderização de título e # hashtags no vídeo, captura de áudio confiável (captureStream + WebAudio keep-alive), relógio mestre de duração exata na gravação, remux EBML/WebM, transcodificação MP4 CFR + AAC, empacotador AVI MJPEG+PCM e fluxo seguro de exportação sem desconto em erro.
- wallet.js: Integração completa com Supabase (usuarios, carteira_diamantes, assinaturas, creditos_videos), planos pack5 (5 clipes = 100 diamantes), pack10 (10 clipes = 200 diamantes) e weekly (Assinatura 7 dias = 1000 diamantes, 20 clipes/dia), escolha de duração 30s ou 60s e sincronização do saldo de vídeos disponíveis.
- supabase_setup.sql: Criação das tabelas assinaturas e creditos_videos (com updated_at), políticas RLS e funções RPC atômicas consumir_video_download(p_id_jogador) e estornar_video_download(p_id_jogador, p_origem).
- manifest.json, sw.js, version.json, README.md: Configuração do PWA (v0.018). (Ativos visuais externos: splash-bg.jpg, icon-192.png, icon-512.png).

3. REGRAS DE NEGÓCIO & GARANTIAS ATÉ A v0.018
- Saldo de vídeos disponíveis na nuvem: Soma a cota diária restante da assinatura semanal ativa (ex.: 20/20) com os vídeos avulsos comprados em creditos_videos (ex.: +10/10 = 30/30 disponíveis). Ao baixar 1 vídeo com sucesso, passa para 29/30 e persiste no Supabase ao recarregar o app.
- Zero desconto em caso de erro:
  1) checkCanDownloadVideos(qtd) verifica antes de renderizar se há saldo suficiente, sem descontar nada.
  2) exportVerticalCut() renderiza e valida o arquivo final (WebM, MP4 ou AVI) com tamanho > 1024 bytes. Se falhar, retorna null e nada é descontado.
  3) Somente após o arquivo estar pronto, authorizeClipDownload() consome 1 vídeo via RPC atômica no Supabase (consumir_video_download) e atualiza a UI. Se o disparo do download falhar no navegador, refundOneVideoToCloud() estorna automaticamente.
- Exportação com tempo exato, áudio e identidade visual do corte (v0.018):
  - Duração exata de 30s ou 60s (conforme escolha do usuário) em WebM, MP4 (720p/1080p/2K, 30/60fps) e AVI (30/60fps).
  - Áudio sempre incluído (WebM Opus, MP4 AAC 44.1kHz estéreo, AVI PCM 16-bit sincronizado).
  - Título predefinido do corte e # hashtags queimados no vídeo e incluídos no nome do arquivo exportado.

4. REGRAS DE TRABALHO COM O CRIADOR
- Sempre entregar todos os arquivos atualizados dentro de uma ÚNICA pasta .zip com os nomes originais prontos para upload direto, acompanhados do arquivo de contexto atualizado.
- Só gerar códigos ou novas versões quando o usuário autorizar explicitamente.

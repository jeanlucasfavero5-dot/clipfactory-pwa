# CONTEXTO DO PROJETO — CLIPFORGE STUDIO (VERSÃO WEB -> PROGRAMA DE COMPUTADOR DESKTOP)

## 1. Visão Geral do Projeto
O **ClipForge Studio** é um estúdio de edição rápida focado em criadores de conteúdo, streamers e canais de clipadas (gameplay, reacts, cortes verticais 9:16). O objetivo desta etapa é migrar a base funcional já validada na versão Web (`index.html`) para um **Programa de Computador Desktop nativo (Windows .exe)** com renderização acelerada por hardware (FFmpeg) e sem limitações de memória do navegador.

## 2. Tudo o que já foi construído e validado (Base v2.0)
- **Identidade Própria (Livre de Copyright)**: Nomenclatura 100% proprietária (`ClipForge Studio`), sem menção a softwares ou marcas registradas de terceiros.
- **Motor de Layout Split Clipada (9:16 - 1080x1920)**:
  - Modo Tela Cheia e Modo Split (Câmera/Reação no topo + Gameplay na base com divisor ajustável).
  - Reposicionamento interativo via drag-and-drop direto no canvas de preview.
- **Sistema de Legendas Dinâmicas (56 Presets)**:
  - Presets inspirados em clipadas virais: caixas vermelhas/amarelas ajustadas por linha, efeito papel rasgado com borda branca, folha de caderno pautada, neon duplo, aura carmim, 3D, adesivo e cromado.
  - Sistema de destaque automático por palavras-chave (ex.: palavras selecionadas ficam em amarelo ou vermelho).
- **Painel de Cores Personalizável (Color Studio)**:
  - Seletor visual HSV (quadrado de saturação/brilho + barra de matiz + swatches rápidos) aplicável separadamente à Letra, Palavra Destaque, Fundo/Faixa e Contorno/Brilho.
- **Faixa de Gancho / Título Visual**:
  - Banner estilo papel rasgado (vermelho, amarelo, preto grunge, caderno) com duas linhas de impacto.
- **Barrinha de Rede Social**:
  - Faixa metálica 3D / neon / pílula com ícones vetoriais (YouTube, Instagram, TikTok, Kwai, Twitch, Kick) e campo de `@` personalizável.

## 3. Arquitetura Recomendada para o Programa de Computador (Próximo Passo)
Para transformar este projeto em um programa instalável para Windows (`.exe`) mantendo exatamente a mesma interface e presets já criados:
1. **Wrapper Desktop**: **Electron** ou **Tauri** empacotando a UI HTML/CSS/JS atual.
2. **Motor de Vídeo & Áudio Real**: Integrar **FFmpeg** (`fluent-ffmpeg` / `ffmpeg-static`) no processo principal para:
   - Exportar em **MP4 (H.264 + AAC 60fps)** com áudio original preservado e mixado (o navegador exporta apenas `.webm`).
   - Suportar vídeos longos (1h+ de live) com corte rápido de trechos (In/Out) antes da renderização.
3. **Transcrição Automática Offline (Legenda por Voz)**: Integrar **Whisper.cpp** local para gerar as legendas sincronizadas palavra por palavra automaticamente a partir do áudio do vídeo, sem depender de APIs pagas.
4. **Gerenciador de Templates Salvos**: Salvar presets customizados do usuário em arquivo local (`presets.json` na pasta AppData).

## 4. Prompt Inicial Sugerido para Iniciar o Programa de Computador
> "Com base no arquivo de contexto e no `index.html` do ClipForge Studio v2.0, vamos estruturar a versão Desktop para Windows usando Electron + FFmpeg para exportar em MP4 60fps com áudio e adicionar linha do tempo de corte (In/Out) e transcrição automática."

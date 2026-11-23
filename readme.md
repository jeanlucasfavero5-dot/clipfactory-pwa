# ClipFactory PWA × Hub WaveCombat (v0.017)

## Correções desta versão (v0.017)
- **Seleção de vídeo na área `#drop` (`1. Envie seu vídeo`):** `bindDropZone()` em `app.js` agora previne propagação/padrão com `e.preventDefault()` e `e.stopPropagation()`, limpa o `value` do `#fileInput` antes de chamar `.click()`, rebinda ao voltar para a etapa 1 (`resetToStep1()`) e remove `.hidden` (`display: none !important`) de `#fileInput` em `editor.html` (substituído por `.fileInputHidden` fora do fluxo visual, com `z-index` limpo em `#step1` e `#drop`).
- **Versão sincronizada `0.017`:** `index.html`, `login.html`, `editor.html`, `sw.js` e `version.json` atualizados para `v0.017`.

## Arquivos binários/ativos da pasta original
Lembre-se de manter ou copiar para a pasta `clipfactory-pwa-v0.017/` os arquivos de mídia/ícones do seu pacote original (`splash-bg.jpg`, `icon-192.png`, `icon-512.png`).

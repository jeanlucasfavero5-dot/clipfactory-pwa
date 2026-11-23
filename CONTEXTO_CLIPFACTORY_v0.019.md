# Contexto Técnico — ClipFactory PWA (v0.019)

## Estado Atual
- **Versão:** `0.019` (Service Worker cache `clipfactory-pwa-v0.019`).
- **Arquivos principais:** `index.html`, `login.html`, `editor.html`, `app.js`, `presets.js`, `wallet.js`, `manifest.json`, `sw.js`, `version.json`, `supabase_setup.sql`.
- **Correções aplicadas na v0.019:**
  1. `drawFrame()` em `app.js`: renderiza o gancho visual somente quando `state.hook.enabled === true` e `state.hook.text.trim().length > 0` (removido o fallback que forçava `refClip.viral_title` no vídeo).
  2. `selectClip()` em `app.js`: removida a repopulação automática que reativava `state.hook.enabled = true` e preenchia `hookText` ao selecionar/baixar um clipe.
  3. `buildClipExportFileName()` em `app.js`: prioriza texto digitado pelo usuário no campo do gancho quando preenchido e usa `clip.viral_title` como padrão automático no nome do arquivo exportado.

# Contexto Técnico — ClipFactory PWA (v0.020)

## Estado Atual
- **Versão:** `0.020` (`version.json` em `"0.020"`, Service Worker em `clipfactory-pwa-v0.020`).
- **Arquivos incluídos:** `index.html`, `login.html`, `editor.html`, `app.js`, `presets.js`, `wallet.js`, `manifest.json`, `sw.js`, `version.json`, `supabase_setup.sql`, `CONTEXTO_CLIPFACTORY_v0.020.md`.

## Ajustes realizados até a v0.020
1. **Versão `0.020` unificada:** `login.html`, `editor.html`, `index.html`, `version.json` e `sw.js` alinhados na `0.020`.
2. **Lista expansível na coluna direita (`editor.html`):** Seções da coluna direita organizadas em lista expansível ao clicar com rolagem interna e botões de expandir/recolher tudo.
3. **Correção em `state.hook` (`app.js`):** Removida a declaração duplicada de `bgColor` e mapeada a cor da faixa em `bannerBgColor`.
4. **Gancho / Título e Downloads:** Gancho exibido apenas quando ativo e com texto preenchido, sem repopulação automática ao trocar de clipe, mantendo título automático no nome do arquivo e sincronização com Supabase (`wallet.js` e `supabase_setup.sql`).

# Contexto Técnico — ClipFactory PWA (v0.021)

## Estado Atual
- **Versão:** `0.021` (`version.json` em `"0.021"`, Service Worker em `clipfactory-pwa-v0.021`).
- **Arquivos incluídos:** `index.html`, `login.html`, `editor.html`, `app.js`, `presets.js`, `wallet.js`, `manifest.json`, `sw.js`, `version.json`, `supabase_setup.sql`, `CONTEXTO_CLIPFACTORY_v0.021.md`.

## Alterações realizadas na v0.021
1. **Workspace Studio estilo CapCut (3 colunas organizadas):**
   - **Esquerda ampla (`left-stage`):** Vídeo selecionado com maior área de visualização (`max-height: 66vh`), timeline, janela de análise e lista de melhores momentos.
   - **Centro-Direita fixo (`preview-stage`):** Prévia vertical 9:16 dedicada e fixa durante o scroll, separada das opções de edição, com controles rápidos da divisória e tamanho de fonte/gancho.
   - **Extrema Direita (`studio-right-panel`):** Barra lateral com botões clicáveis (`Legendas`, `Gancho`, `Pacotes`, `Exportar`) que expandem ou recolhem uma gaveta limpa de configurações (`studio-drawer`).
2. **Remoção de botões redundantes:** Removidos os botões "Expandir tudo" e "Recolher tudo" da coluna direita, substituídos pela navegação direta por botões clicáveis no dock lateral.
3. **Integração Hub WaveCombat (`wallet.js`):** Painéis de assinatura semanal e pacotes de diamantes renderizados automaticamente dentro da aba `Pacotes` (`#hubDrawerContainer`).
4. **Atualização de versão:** Todos os arquivos sincronizados para `v0.021`.

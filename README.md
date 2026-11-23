# ClipFactory PWA × Hub WaveCombat (v0.016)

## Correções desta versão (v0.016)
- **Erro `updated_at` em `assinaturas`:** fallback automático caso a coluna não exista no cache do Supabase + inclusão no `supabase_setup.sql` com `notify pgrst, 'reload schema'`.
- **Durações exatas de 30s e 60s:** seleção de `30` ou `60` segundos aplicada na análise dos trechos, na prévia e na exportação final do arquivo.

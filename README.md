# Dasein

Plataforma web de gerenciamento de equipamentos escolares.

## Publicação

O conteúdo deste repositório é o próprio site. Publique a branch `main` pelo GitHub Pages usando a raiz (`/(root)`).

## Backend

Supabase é o backend do projeto. O frontend usa somente a Publishable Key, que pode ficar em código público. Nunca coloque Secret Key ou `service_role` no GitHub Pages.

A migration `supabase/migrations/20260918_dasein_web_bridge_0_0_2.sql` já foi aplicada ao projeto Supabase usado pelo Dasein e fica no repositório apenas como histórico versionado.

## Versão

0.0.4 — Connected Indicator Dashboard

Dashboard refeita com indicadores grandes conectados, ocupação integral do desktop e infoboxes próprios do Dasein. Mantém o mesmo Supabase e todas as funções da 0.0.3.
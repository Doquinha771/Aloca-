# Dasein

Plataforma web de gerenciamento de equipamentos escolares.

## Publicação

O conteúdo deste repositório é o próprio site. Publique a branch `main` pelo GitHub Pages usando a raiz (`/(root)`).

## Backend

Supabase é o backend do projeto. O frontend usa somente a Publishable Key. Nunca coloque Secret Key ou `service_role` no GitHub Pages.

As migrations da pasta `supabase/migrations` já foram aplicadas ao projeto usado pelo Dasein e permanecem no repositório apenas como histórico versionado.

## Versão

0.0.8 — Blue Sidebar + Smart Search

A interface foi reorganizada para eliminar cards isolados. Dashboard Bento, inventário, retiradas, reservas, histórico, carrinhos, manutenção e administração passam a usar superfícies conectadas, divisórias internas e uma hierarquia visual única. O backend e a estrutura do Supabase permanecem inalterados.

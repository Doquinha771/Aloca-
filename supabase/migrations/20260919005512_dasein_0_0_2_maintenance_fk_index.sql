-- Dasein 0.0.2 — índice recomendado pelo advisor
create index if not exists maintenance_opened_by_idx on public.maintenance_events(opened_by);

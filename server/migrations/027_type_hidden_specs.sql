-- Характеристики подкатегории действуют у всех её типов. Но отдельному типу
-- что-то может быть не нужно — здесь список таких отключённых характеристик.
-- Сама характеристика остаётся у подкатегории и у прочих типов.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/027_type_hidden_specs.sql

begin;

alter table item_type add column if not exists hidden_specs jsonb not null default '[]'::jsonb;

commit;

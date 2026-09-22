-- Характеристика, которой может быть несколько: второй диск, третья планка памяти.
-- Значения лежат там же, в item.specs, но у второго и дальше ключ с номером:
-- «s1» — первый, «s1#2» — второй, «s1#3» — третий. Так вся прежняя логика,
-- которая читает specs[id], продолжает работать с основным значением.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/026_spec_slots.sql

begin;

alter table spec add column if not exists multi boolean not null default false;

-- Про каждую добавленную строку: от какой запчасти она взялась и когда её сняли.
-- Ключ тот же, что у значения в specs: {"s1#2": {"src": "item:itm…", "off": "2026-09-12"}}
alter table item add column if not exists spec_slots jsonb not null default '{}'::jsonb;

commit;

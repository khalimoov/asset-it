-- У расходного материала может быть несколько моделей: одна и та же запчасть
-- подходит к разной технике («Seagate 1 ТБ» — и в системный блок, и в сервер).
-- Прежняя колонка model_id остаётся и держит первую из списка: по ней работает
-- всё, что читало модель материала до этой правки.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/030_supply_models.sql

begin;

alter table supply add column if not exists model_ids jsonb not null default '[]'::jsonb;

-- у кого модель уже стояла — переносим её в список, чтобы ничего не потерялось
update supply
   set model_ids = jsonb_build_array(model_id)
 where model_id is not null and model_ids = '[]'::jsonb;

commit;

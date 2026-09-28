-- Готовый набор характеристик принадлежит своему разделу учёта: набор для
-- компьютеров незачем показывать в рациях и расходных материалах.
-- У наборов, заведённых раньше, раздела нет — они остаются общими, пока их
-- не закрепят за разделом кнопкой в интерфейсе.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/028_preset_registry.sql

begin;

alter table preset add column if not exists registry_id text references registry(id) on delete cascade;
create index if not exists preset_reg_idx on preset(registry_id);

commit;

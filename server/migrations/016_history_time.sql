-- Время события в истории записи: до сих пор хранилась только дата строкой.
-- У старых строк времени нет — колонка у них остаётся пустой, показывается дата.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/016_history_time.sql

begin;

alter table item_history add column if not exists at timestamptz;
alter table item_history alter column at set default now();

commit;

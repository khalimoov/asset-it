-- Документальное списание: куда ушёл материал.
-- Одно списание может разойтись по нескольким местам, поэтому место лежит
-- на строке: одна строка — один материал в одно подразделение/отдел/склад.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/020_writeoff_places.sql

begin;

alter table stock_writeoff add column if not exists division_id   text references division(id) on delete set null;
alter table stock_writeoff add column if not exists department_id text references department(id) on delete set null;
alter table stock_writeoff add column if not exists warehouse_id  text references warehouse(id) on delete set null;
create index if not exists writeoff_place_idx on stock_writeoff(division_id, department_id, warehouse_id);

commit;

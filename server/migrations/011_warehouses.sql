-- Склады: номер приходит из накладной, а список ведётся отдельным справочником.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/011_warehouses.sql

begin;

create table if not exists warehouse (
  id     text primary key,
  org_id text references org(id) on delete cascade,
  code   text not null default '',     -- номер склада из накладной, например 5004
  name   text not null default '',
  note   text not null default ''
);
create index if not exists warehouse_org_idx on warehouse(org_id);

-- у расходных материалов склада нет: они лежат общей кучей на складе ИТ
alter table item add column if not exists warehouse_id text references warehouse(id) on delete set null;
create index if not exists item_wh_idx on item(warehouse_id);

-- номер склада, прочитанный из документа
alter table document add column if not exists warehouse text not null default '';

commit;

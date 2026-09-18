-- Передача оборудования между складами: своя накладная, свой след в истории.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/013_transfers.sql

begin;

create table if not exists transfer (
  id          text primary key,
  org_id      text references org(id) on delete cascade,
  item_id     text references item(id) on delete set null,
  inv         text not null default '',      -- на момент передачи: запись потом могут удалить
  type_name   text not null default '',
  from_wh_id  text,
  from_label  text not null default '',      -- «5004 · Склад ЦС» — чтобы список читался без склада
  to_wh_id    text,
  to_label    text not null default '',
  note        text not null default '',      -- почему передают; с примечанием карточки не путать
  orig_name   text not null default '',
  path        text not null default '',      -- относительно папки архива, прямые косые
  staff_id    text,
  who         text not null default '',
  at          timestamptz not null default now()
);
create index if not exists transfer_org_idx on transfer(org_id, at desc);
create index if not exists transfer_item_idx on transfer(item_id);

-- из истории карточки накладную на передачу можно открыть
alter table item_history add column if not exists transfer_id text;

commit;

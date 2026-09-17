-- Журнал удалений: карточка исчезает, но след о ней остаётся.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/003_deletion_log.sql

begin;

create table if not exists deletion (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  staff_id        text references staff(id) on delete set null,
  who             text not null default '',      -- имя на момент удаления
  reason          text not null default '',      -- зачем удалили, спрашивается в карточке
  item_id         text not null default '',      -- ссылки нет: записи уже не существует
  registry_id     text not null default '',
  registry_name   text not null default '',
  inv             text not null default '',
  type_name       text not null default '',
  cat_name        text not null default '',
  sub_name        text not null default '',
  status          text not null default '',
  owner_name      text not null default '',
  division_name   text not null default '',
  department_name text not null default '',
  notes           text not null default '',
  snapshot        jsonb not null default '{}'::jsonb   -- характеристики и вся история
);
create index if not exists deletion_at_idx    on deletion(at desc);
create index if not exists deletion_staff_idx on deletion(staff_id);

commit;

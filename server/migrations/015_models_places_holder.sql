-- Модели оборудования с фотографией, справочник мест и «за кем закреплено».
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/015_models_places_holder.sql

begin;

-- модель — справочник раздела, как и тип; фотография хранится в базе, чтобы не
-- зависеть от папки архива (она может быть не задана)
create table if not exists model (
  id          text primary key,
  registry_id text references registry(id) on delete cascade,
  name        text not null default '',
  note        text not null default '',
  photo       bytea,
  photo_type  text not null default ''
);
create index if not exists model_reg_idx on model(registry_id);
alter table item add column if not exists model_id text references model(id) on delete set null;

-- место (кабинет, серверная, пост…) — общий справочник учреждения
create table if not exists place (
  id     text primary key,
  org_id text references org(id) on delete cascade,
  name   text not null default '',
  note   text not null default ''
);
create index if not exists place_org_idx on place(org_id);

-- за кем закреплена единица: person — за сотрудником (ответственный, подразделение,
-- отдел), place — за местом, item — за другим оборудованием (жёсткий диск в компьютере)
alter table item add column if not exists holder        text not null default 'person';
alter table item add column if not exists place_id      text references place(id) on delete set null;
alter table item add column if not exists parent_id     text references item(id) on delete set null;
alter table item add column if not exists hide_attached boolean not null default false;
create index if not exists item_parent_idx on item(parent_id);

commit;

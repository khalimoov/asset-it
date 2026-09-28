-- Схема базы «Учёт ИТ-отдела» для PostgreSQL 14+
-- Применяется один раз: psql -U asset_it -d asset_it -f schema.sql
-- Все id — текстовые: клиент генерирует их сам, как и раньше.

begin;

-- ============================ доступ ============================

create table if not exists role (
  id          text primary key,
  name        text not null unique,
  descr       text not null default '',
  perms       jsonb not null default '[]'::jsonb,   -- ["repair.send","supply.issue", ...]
  reg_access  jsonb not null default '{}'::jsonb,   -- {"equipment":"edit","ipphone":"view"}
  builtin     boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

-- сотрудники ИТ; они же учётные записи для входа
create table if not exists staff (
  id          text primary key,
  full_name   text not null,
  position    text not null default '',
  login       text unique,
  pass_hash   text,                                  -- scrypt, соль внутри строки
  role_id     text references role(id) on delete set null,
  is_master   boolean not null default false,
  active      boolean not null default true,
  org_id      text,                              -- учреждение сотрудника (одно)
  can_edit    boolean not null default false,    -- доступ без этой галочки = просмотр
  created_at  timestamptz not null default now()
);

create table if not exists session (
  token       text primary key,
  staff_id    text not null references staff(id) on delete cascade,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists session_staff_idx on session(staff_id);

-- ============================ учреждения ============================

create table if not exists org (
  id         text primary key,
  name       text not null,
  note       text not null default '',
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- какие учреждения видит сотрудник ИТ; администратору видны все
-- учреждение сотрудника — поле staff.org_id (см. миграцию 007)

-- настройки, свои у каждого учреждения: подключение к домену, опрос сети
create table if not exists org_setting (
  org_id text not null references org(id) on delete cascade,
  key    text not null,
  value  jsonb not null,
  primary key (org_id, key)
);

-- ============================ справочники ============================

create table if not exists division (
  id text primary key,
  name text not null
);

create table if not exists department (
  id text primary key,
  name text not null
);

-- сотрудники предприятия: на них записывается техника и списываются материалы
create table if not exists person (
  id            text primary key,
  name          text not null,
  position      text not null default '',
  division_id   text references division(id) on delete set null,
  department_id text references department(id) on delete set null,
  phone         text not null default '',
  email         text not null default '',
  -- objectGUID из Active Directory: переживает переименование учётной записи
  ad_guid       text,
  ad_synced_at  timestamptz
);
create unique index if not exists person_ad_guid_idx
  on person(ad_guid) where ad_guid is not null;

create table if not exists registry (
  id        text primary key,
  name      text not null,
  icon      text not null default '▣',
  kind      text not null default 'assets',          -- assets | supplies
  builtin   boolean not null default false,
  statuses  jsonb not null default '[]'::jsonb,
  layout    jsonb not null default '{}'::jsonb,      -- {subs,specs,presets,dash}
  sort      int not null default 0
);

create table if not exists category (
  id          text primary key,
  name        text not null,
  registry_id text not null references registry(id) on delete cascade
);
create index if not exists category_reg_idx on category(registry_id);

create table if not exists subcategory (
  id          text primary key,
  name        text not null,
  category_id text references category(id) on delete set null,
  registry_id text not null references registry(id) on delete cascade
);
create index if not exists subcategory_reg_idx on subcategory(registry_id);

create table if not exists item_type (
  id             text primary key,
  name           text not null,
  category_id    text references category(id) on delete set null,
  subcategory_id text references subcategory(id) on delete set null,
  registry_id    text not null references registry(id) on delete cascade
);
create index if not exists item_type_reg_idx on item_type(registry_id);

-- характеристики: либо стандартные для подкатегории, либо собственные для типа
create table if not exists spec (
  id             text primary key,
  name           text not null,
  kind           text not null default 'text',       -- text|number|date|list|ip|mac
  unit           text not null default '',
  options        jsonb not null default '[]'::jsonb,
  req            boolean not null default false,
  uniq           boolean not null default false,
  opt            boolean not null default false,     -- разрешено «нет значения»
  req_statuses   jsonb not null default '[]'::jsonb, -- пусто = обязательна всегда
  grp            text not null default '',           -- группа в карточке
  pool_id        text,
  subcategory_id text references subcategory(id) on delete cascade,
  type_id        text references item_type(id) on delete cascade,
  check (subcategory_id is not null or type_id is not null)
);
create index if not exists spec_sub_idx  on spec(subcategory_id);
create index if not exists spec_type_idx on spec(type_id);

-- готовые наборы характеристик, общие для всех разделов
create table if not exists preset (
  id    text primary key,
  name  text not null unique,
  specs jsonb not null default '[]'::jsonb
);

-- ============================ IP-адреса ============================

create table if not exists ip_pool (
  id          text primary key,
  name        text not null,
  prefix      text not null,                          -- "192.168.203."
  host_from   int not null default 1,
  host_to     int not null default 254,
  note        text not null default '',
  registry_id text references registry(id) on delete set null,
  category_id text references category(id) on delete set null
);

create table if not exists ip_reserved (
  id   text primary key,
  ip   text not null unique,
  note text not null default '',
  data jsonb not null default '{}'::jsonb   -- ручные данные: имя, тип, ОС, ответственный…
);

create table if not exists ip_status (
  ip         text primary key,
  alive      boolean not null default false,
  method     text not null default '',      -- icmp | tcp:445 | tcp:3389
  last_check timestamptz,
  last_seen  timestamptz                    -- последний раз, когда адрес ответил
);
create index if not exists ip_status_seen_idx on ip_status(last_seen desc);

-- ============================ записи учёта ============================

create table if not exists item (
  id            text primary key,
  registry_id   text not null references registry(id) on delete cascade,
  inv           text not null default '',
  type_id       text references item_type(id) on delete set null,
  status        text not null default '',
  owner_id      text references person(id) on delete set null,
  division_id   text references division(id) on delete set null,
  department_id text references department(id) on delete set null,
  notes         text not null default '',
  specs         jsonb not null default '{}'::jsonb,   -- {spec_id: "значение"}
  specs_none    jsonb not null default '{}'::jsonb,   -- {spec_id: true}
  master_id     text references staff(id) on delete set null,
  status_date   date,
  status_note   text not null default '',
  updated_by      text references staff(id) on delete set null,
  updated_by_name text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists item_reg_idx    on item(registry_id);
create index if not exists item_status_idx on item(status);
create index if not exists item_owner_idx  on item(owner_id);
create index if not exists item_specs_idx  on item using gin (specs);

create table if not exists item_history (
  id       bigserial primary key,
  item_id  text not null references item(id) on delete cascade,
  d        text not null default '',                  -- дата как её видит пользователь
  t        text not null default '',                  -- текст события
  staff_id text references staff(id) on delete set null,
  who      text not null default '',                  -- имя автора на момент записи
  at       timestamptz not null default now()
);
create index if not exists item_history_staff_idx on item_history(staff_id);
create index if not exists item_history_idx on item_history(item_id);

-- ============================ ремонты ============================

create table if not exists repair (
  id          text primary key,
  item_id     text,                                   -- запись может быть удалена, строка остаётся
  registry_id text,
  inv         text not null default '',
  type_name   text not null default '',
  master_id   text references staff(id) on delete set null,
  master_name text not null default '',
  from_date   date,
  to_date     date,
  result      text not null default '',
  note        text not null default '',               -- причина
  done_note   text not null default ''                -- что сделали
);
create index if not exists repair_item_idx   on repair(item_id);
create index if not exists repair_master_idx on repair(master_id);
create index if not exists repair_open_idx   on repair(to_date) where to_date is null;

-- ============================ расходные материалы ============================

create table if not exists supply (
  id   text primary key,
  name text not null,
  unit text not null default 'шт',
  note text not null default ''
);

create table if not exists supply_receipt (
  id        text primary key,
  supply_id text not null references supply(id) on delete cascade,
  qty       int not null default 0,
  d         date,
  note      text not null default ''
);
create index if not exists receipt_supply_idx on supply_receipt(supply_id);

create table if not exists supply_issue (
  id        text primary key,
  supply_id text not null references supply(id) on delete cascade,
  person_id text references person(id) on delete set null,
  item_id   text references item(id) on delete set null,   -- либо на сотрудника, либо в технику
  qty       int not null default 1,
  d         date,
  note      text not null default ''
);
create index if not exists issue_supply_idx on supply_issue(supply_id);
create index if not exists issue_person_idx on supply_issue(person_id);
create index if not exists issue_item_idx on supply_issue(item_id);

-- ============================ журнал удалений ============================

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

-- ============================ уведомления и настройки ============================

create table if not exists notice (
  id           text primary key,
  at           timestamptz not null default now(),
  type         text not null default '',
  item_id      text,
  registry_id  text,
  inv          text not null default '',
  type_name    text not null default '',
  master_id    text,
  text         text not null default '',
  for_staff_id text,
  seen         boolean not null default false
);
create index if not exists notice_at_idx on notice(at desc);

create table if not exists setting (
  key   text primary key,
  value jsonb not null
);

commit;

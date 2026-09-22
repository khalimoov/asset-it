-- Модель может относиться сразу к нескольким разделам, категориям и подкатегориям;
-- у расходного материала тоже появляется модель; история пингов по дням.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/024_model_scope_ip_history.sql

begin;

-- Область применения модели. Одна строка — одно сочетание «раздел + категория +
-- подкатегория»; категорию и подкатегорию можно не указывать, тогда модель годится
-- всему разделу. Суррогатный ключ, а не составной: в составной не входят NULL.
create table if not exists model_scope (
  id             text primary key,
  model_id       text not null references model(id) on delete cascade,
  registry_id    text references registry(id) on delete cascade,
  category_id    text references category(id) on delete set null,
  subcategory_id text references subcategory(id) on delete set null
);
create index if not exists model_scope_model_idx on model_scope(model_id);
create index if not exists model_scope_reg_idx   on model_scope(registry_id);

-- у моделей, заведённых раньше, область одна — их раздел
insert into model_scope (id, model_id, registry_id)
select 'ms_' || m.id, m.id, m.registry_id from model m
 where m.registry_id is not null
   and not exists (select 1 from model_scope s where s.model_id = m.id);

-- Модель у расходного материала: по ней списывают на «Выдано и установлено».
alter table supply add column if not exists model_id text references model(id) on delete set null;
create index if not exists supply_model_idx on supply(model_id);

-- Имя хоста: заполняется при обходе сети обратным разрешением имени.
alter table ip_status add column if not exists host_name text not null default '';

-- История пингов по дням: одна строка на адрес и день, alive — отвечал ли он
-- в этот день хоть раз. Хранится полгода, лишнее чистит сам обход.
create table if not exists ip_day (
  org_id text not null references org(id) on delete cascade,
  ip     text not null,
  d      date not null,
  alive  boolean not null default false,
  seen   int not null default 0,          -- сколько раз ответил за день
  checks int not null default 0,          -- сколько раз проверяли
  primary key (org_id, ip, d)
);
create index if not exists ip_day_ip_idx on ip_day(org_id, ip, d desc);

commit;

-- Несколько учреждений в одной базе: у каждого свой учёт, свои справочники,
-- свои пользователи и свой дашборд. Доступ к учреждению выдаёт администратор.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/006_organizations.sql

begin;

create table if not exists org (
  id         text primary key,
  name       text not null,
  note       text not null default '',
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- какие учреждения видит сотрудник ИТ; администратору видны все
create table if not exists staff_org (
  staff_id text not null references staff(id) on delete cascade,
  org_id   text not null references org(id) on delete cascade,
  primary key (staff_id, org_id)
);
create index if not exists staff_org_org_idx on staff_org(org_id);

-- настройки, свои у каждого учреждения: подключение к домену, опрос сети
create table if not exists org_setting (
  org_id text not null references org(id) on delete cascade,
  key    text not null,
  value  jsonb not null,
  primary key (org_id, key)
);

-- ---------------------------------------------------------------- привязка данных

alter table registry    add column if not exists org_id text references org(id) on delete cascade;
alter table division    add column if not exists org_id text references org(id) on delete cascade;
alter table department  add column if not exists org_id text references org(id) on delete cascade;
alter table person      add column if not exists org_id text references org(id) on delete cascade;
alter table preset      add column if not exists org_id text references org(id) on delete cascade;
alter table ip_pool     add column if not exists org_id text references org(id) on delete cascade;
alter table ip_reserved add column if not exists org_id text references org(id) on delete cascade;
alter table supply      add column if not exists org_id text references org(id) on delete cascade;
alter table repair      add column if not exists org_id text references org(id) on delete cascade;
alter table notice      add column if not exists org_id text references org(id) on delete cascade;
alter table deletion    add column if not exists org_id text references org(id) on delete cascade;

-- Всё, что уже заведено, переезжает в одно учреждение. Название временное:
-- переименовывается в карточке учреждения одним полем.
insert into org (id, name, sort)
select 'org_main', 'Основное', 0
where not exists (select 1 from org)
  and exists (select 1 from registry);

update registry    set org_id = 'org_main' where org_id is null;
update division    set org_id = 'org_main' where org_id is null;
update department  set org_id = 'org_main' where org_id is null;
update person      set org_id = 'org_main' where org_id is null;
update preset      set org_id = 'org_main' where org_id is null;
update ip_pool     set org_id = 'org_main' where org_id is null;
update ip_reserved set org_id = 'org_main' where org_id is null;
update supply      set org_id = 'org_main' where org_id is null;
update repair      set org_id = 'org_main' where org_id is null;
update notice      set org_id = 'org_main' where org_id is null;
update deletion    set org_id = 'org_main' where org_id is null;

-- прежние общие настройки домена и опроса сети становятся настройками первого учреждения
insert into org_setting (org_id, key, value)
select 'org_main', key, value from setting
 where key in ('ldap', 'ldap_last', 'netscan', 'netscan_last')
   and exists (select 1 from org where id = 'org_main')
    on conflict (org_id, key) do nothing;
delete from setting where key in ('ldap', 'ldap_last', 'netscan', 'netscan_last');

-- доступ ко всем учреждениям для тех, кто уже заведён: права не сужаем молча
insert into staff_org (staff_id, org_id)
select s.id, o.id from staff s, org o
    on conflict do nothing;

create index if not exists registry_org_idx   on registry(org_id);
create index if not exists division_org_idx   on division(org_id);
create index if not exists department_org_idx on department(org_id);
create index if not exists person_org_idx     on person(org_id);
create index if not exists ip_pool_org_idx    on ip_pool(org_id);
create index if not exists supply_org_idx     on supply(org_id);
create index if not exists repair_org_idx     on repair(org_id);
create index if not exists notice_org_idx     on notice(org_id);
create index if not exists deletion_org_idx   on deletion(org_id);

-- ---------------------------------------------------------------- адреса по учреждениям

-- Один и тот же адрес может быть занят в разных учреждениях, поэтому ключ
-- теперь составной. Прежние строки уезжают в первое учреждение.
alter table ip_status add column if not exists org_id text references org(id) on delete cascade;
update ip_status set org_id = 'org_main' where org_id is null;
delete from ip_status where org_id is null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'ip_status_pkey'
               and conrelid = 'ip_status'::regclass
               and array_length(conkey, 1) = 1) then
    alter table ip_status drop constraint ip_status_pkey;
    alter table ip_status add primary key (org_id, ip);
  end if;
end $$;

commit;

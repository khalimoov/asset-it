-- Подключение к Active Directory: у пользователя появляются телефон, почта
-- и устойчивая связь с учётной записью домена.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/004_ldap_users.sql

begin;

alter table person add column if not exists phone        text not null default '';
alter table person add column if not exists email        text not null default '';
-- objectGUID домена: переживает переименование и перенос в другое подразделение
alter table person add column if not exists ad_guid      text;
alter table person add column if not exists ad_synced_at timestamptz;

create unique index if not exists person_ad_guid_idx
  on person(ad_guid) where ad_guid is not null;

commit;

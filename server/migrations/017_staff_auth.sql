-- Вход через Active Directory: у учётной записи запоминаем, откуда она —
-- local (пароль хранится у нас) или ad (пароль проверяет домен, у нас его нет).
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/017_staff_auth.sql

begin;

alter table staff add column if not exists auth text not null default 'local';

commit;

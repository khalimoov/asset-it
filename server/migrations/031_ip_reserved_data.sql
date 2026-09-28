-- Резерв IP-адреса с данными, заведёнными вручную: имя, тип, ОС, где работает,
-- ответственный, подразделение, отдел, MAC. Нужен для того, чего нет в учёте
-- оборудования, — прежде всего виртуальных серверов.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/031_ip_reserved_data.sql

begin;

alter table ip_reserved add column if not exists data jsonb not null default '{}'::jsonb;

commit;

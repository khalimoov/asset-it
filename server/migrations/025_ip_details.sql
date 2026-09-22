-- Подробности об устройстве на адресе: MAC и производитель, открытые порты,
-- заголовок веб-интерфейса и предполагаемый тип. В сети не только компьютеры —
-- телефоны, камеры, регистраторы, коммутаторы, радиомосты.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/025_ip_details.sql

begin;

alter table ip_status add column if not exists mac        text not null default '';
alter table ip_status add column if not exists vendor     text not null default '';
alter table ip_status add column if not exists ports      text not null default '';
alter table ip_status add column if not exists banner     text not null default '';
alter table ip_status add column if not exists kind       text not null default '';
-- когда последний раз разбирались подробно: полный разбор тяжелее обычного
-- пинга, поэтому повторяется раз в сутки, а не каждые пятнадцать минут
alter table ip_status add column if not exists probed_at  timestamptz;

commit;

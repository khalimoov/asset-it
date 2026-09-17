-- Опрос адресов: кто в сети и когда был в последний раз.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/005_ip_status.sql

begin;

create table if not exists ip_status (
  ip         text primary key,
  alive      boolean not null default false,
  method     text not null default '',      -- icmp | tcp:445 | tcp:3389
  last_check timestamptz,
  last_seen  timestamptz                    -- последний раз, когда адрес ответил
);
create index if not exists ip_status_seen_idx on ip_status(last_seen desc);

commit;

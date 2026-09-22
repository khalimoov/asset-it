-- Дата прихода и гарантия у записи учёта. Дата прихода при заведении по
-- накладной берётся из неё, гарантия всегда проставляется руками — в накладной
-- её нет. Гарантия хранится текстом: пишут и срок («24 месяца»), и дату.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/022_item_received_warranty.sql

begin;

alter table item add column if not exists received_at date;
alter table item add column if not exists warranty    text not null default '';

commit;

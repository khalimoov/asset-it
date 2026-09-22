-- Гарантия стала датой «действует до» вместо свободного текста.
-- Текстовую колонку убираем только если в ней ничего не успели написать:
-- поле прожило один день, но на чужой установке могли и заполнить.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/023_warranty_until.sql

begin;

alter table item add column if not exists warranty_until date;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'item' and column_name = 'warranty') then
    -- то, что похоже на дату, переносим; остальное оставляем человеку
    update item set warranty_until = warranty::date
     where warranty_until is null and warranty ~ '^\d{4}-\d{2}-\d{2}$';
    if not exists (select 1 from item
                    where coalesce(warranty, '') <> ''
                      and warranty !~ '^\d{4}-\d{2}-\d{2}$') then
      alter table item drop column warranty;
    end if;
  end if;
end $$;

commit;

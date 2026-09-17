-- Статус «На списание»: техника ждёт решения комиссии и месяцами висит
-- между эксплуатацией и списанием. Досеиваем его в уже заведённые разделы.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/009_status_to_writeoff.sql

begin;

-- ставим перед «Списано», а если его нет — в конец списка
update registry r
   set statuses = (
     select coalesce(jsonb_agg(v order by n), '[]'::jsonb)
       from (
         select value as v,
                case when value = '"Списано"'::jsonb then n + 0.5 else n end as n
           from jsonb_array_elements(r.statuses) with ordinality t(value, n)
         union all
         select '"На списание"'::jsonb,
                coalesce((select n from jsonb_array_elements(r.statuses)
                            with ordinality t(value, n)
                           where value = '"Списано"'::jsonb), 9999)
       ) q)
 where r.kind <> 'supplies'
   and not r.statuses @> '["На списание"]'::jsonb;

commit;

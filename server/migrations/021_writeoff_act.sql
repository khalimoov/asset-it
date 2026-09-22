-- Номер акта списания. act — то, что написал человек и что видно в списке;
-- act_id — внутренний ключ одного акта: по нему строки собираются вместе,
-- даже если номер случайно повторили или потом исправили.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/021_writeoff_act.sql

begin;

alter table stock_writeoff add column if not exists act    text not null default '';
alter table stock_writeoff add column if not exists act_id text not null default '';
create index if not exists writeoff_act_idx on stock_writeoff(act_id);

-- у строк, заведённых до этой миграции, своего акта нет: собираем их по дате,
-- чтобы список не рассыпался на строки без номера
update stock_writeoff set act_id = 'old-' || coalesce(d::text, 'нет-даты')
 where act_id = '';

commit;

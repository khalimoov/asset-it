-- Списание материала на оборудование: краска в принтер, термопаста в компьютер.
-- Строка выдачи ссылается либо на сотрудника (person_id), либо на единицу техники (item_id).
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/018_issue_item.sql

begin;

alter table supply_issue add column if not exists item_id text references item(id) on delete set null;
create index if not exists issue_item_idx on supply_issue(item_id);

commit;

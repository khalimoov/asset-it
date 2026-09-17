-- Кто изменил запись: автор каждого события истории и последний редактор записи.
begin;

alter table item_history add column if not exists staff_id text references staff(id) on delete set null;
alter table item_history add column if not exists who      text not null default '';

alter table item add column if not exists updated_by text references staff(id) on delete set null;
alter table item add column if not exists updated_by_name text not null default '';

create index if not exists item_history_staff_idx on item_history(staff_id);

commit;

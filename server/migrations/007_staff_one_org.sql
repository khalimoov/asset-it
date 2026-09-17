-- Сотрудник ИТ обслуживает одно учреждение, а не несколько.
-- Таблица многие-ко-многим заменяется полем в карточке сотрудника.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/007_staff_one_org.sql

begin;

alter table staff add column if not exists org_id text references org(id) on delete set null;

-- переносим прежние отметки доступа: берём первое учреждение сотрудника
update staff s
   set org_id = (select so.org_id from staff_org so
                  where so.staff_id = s.id
                  order by so.org_id limit 1)
 where s.org_id is null;

-- у кого отметок не было — первое учреждение по порядку, чтобы никто не остался без доступа
update staff
   set org_id = (select id from org order by sort, name limit 1)
 where org_id is null;

drop table if exists staff_org;

create index if not exists staff_org_idx on staff(org_id);

commit;

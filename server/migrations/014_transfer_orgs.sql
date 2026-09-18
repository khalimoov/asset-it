-- Передача между учреждениями: склад принадлежит учреждению, техника уезжает
-- вслед за складом, и в списке её видно как переданную, пока не введут в работу.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/014_transfer_orgs.sql

begin;

-- учреждение-получатель: накладную видят оба учреждения
alter table transfer add column if not exists to_org_id text references org(id) on delete set null;
create index if not exists transfer_to_org_idx on transfer(to_org_id, at desc);

-- когда единицу передали; снимается, как только статус уходит с «На складе»
alter table item add column if not exists transferred_at timestamptz;

commit;

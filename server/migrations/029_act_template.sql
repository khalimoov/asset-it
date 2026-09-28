-- Шаблоны акта на списание. У каждого учреждения свои: должности и фамилии
-- подписантов в акте — это люди конкретного учреждения, общего шаблона быть
-- не может. Сам файл .docx лежит здесь же, в базе: он маленький (около 15 КБ),
-- зато уезжает вместе с обычной резервной копией и не теряется при переносе.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/029_act_template.sql

begin;

create table if not exists act_template (
  id        text primary key,
  org_id    text references org(id) on delete cascade,
  name      text not null,
  note      text not null default '',
  orig_name text not null default '',
  data      bytea not null,
  staff_id  text references staff(id) on delete set null,
  who       text not null default '',
  at        timestamptz not null default now()
);
create index if not exists act_template_org_idx on act_template(org_id);

commit;

-- Доступ к учреждению сам по себе даёт только просмотр.
-- Редактирование включается отдельно, в карточке сотрудника.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/008_view_only_access.sql

begin;

alter table staff add column if not exists can_edit boolean not null default false;

-- Тем, кто заведён до этой правки, редактирование оставляем: сужать права
-- молча нельзя, иначе люди утром не смогут работать и не поймут почему.
update staff set can_edit = true where created_at < now();

commit;

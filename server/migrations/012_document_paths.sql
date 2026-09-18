-- Пути к файлам накладных хранятся с прямыми косыми.
-- Flask отдаёт файл через safe_join, а тот на пути с обратными косыми
-- возвращает None — вместо документа пользователь получал 404.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/012_document_paths.sql

begin;

update document
   set path = replace(path, chr(92), '/')
 where position(chr(92) in path) > 0;

commit;

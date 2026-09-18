-- Накладные: файл кладётся в архив, а записи учёта на него ссылаются.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/010_documents.sql

begin;

create table if not exists document (
  id         text primary key,
  org_id     text references org(id) on delete cascade,
  kind       text not null default 'invoice',   -- накладная; на будущее могут быть другие
  number     text not null default '',          -- номер накладной, если удалось прочитать
  doc_date   date,                              -- дата накладной
  supplier   text not null default '',
  orig_name  text not null default '',          -- как файл назывался у пользователя
  path       text not null default '',          -- путь в архиве, относительно базовой папки
  size_bytes bigint not null default 0,
  pages      int not null default 0,
  ocr_text   text not null default '',          -- распознанный текст целиком
  rows_json  jsonb not null default '[]'::jsonb, -- разобранные строки после правки
  status     text not null default 'new',       -- new | parsed | applied
  staff_id   text references staff(id) on delete set null,
  who        text not null default '',
  at         timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists document_org_idx on document(org_id);
create index if not exists document_at_idx  on document(at desc);

-- откуда приехала техника и материалы
alter table item           add column if not exists document_id text references document(id) on delete set null;
alter table supply_receipt add column if not exists document_id text references document(id) on delete set null;
create index if not exists item_doc_idx    on item(document_id);
create index if not exists receipt_doc_idx on supply_receipt(document_id);

-- Куда какая номенклатура уходила в прошлый раз: в следующей накладной
-- подставится сама, и руками почти ничего выбирать не придётся.
create table if not exists sku_hint (
  org_id      text not null references org(id) on delete cascade,
  sku         text not null,                    -- номенклатура из накладной
  registry_id text references registry(id) on delete cascade,
  type_id     text references item_type(id) on delete set null,
  supply_id   text references supply(id) on delete set null,
  name        text not null default '',
  seen_at     timestamptz not null default now(),
  primary key (org_id, sku)
);

commit;

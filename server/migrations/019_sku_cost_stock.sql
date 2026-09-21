-- Номенклатурный номер и стоимость по всему учёту, подразделение у отдела
-- и документальный склад материалов.
-- Применяется один раз: psql -U asset_it -d asset_it -f migrations/019_sku_cost_stock.sql

begin;

-- Отдел знает своё подразделение: в домене это company -> Подразделение,
-- department -> Отдел, и связь между ними раньше нигде не хранилась.
alter table department add column if not exists division_id text references division(id) on delete set null;
create index if not exists department_div_idx on department(division_id);

-- Номенклатурный номер отдельно от инвентарного: в накладной это разные числа
-- (счёт бухучёта 108000, номенклатура 7086302), а инвентарный присваивают у нас.
alter table item add column if not exists sku  text not null default '';
alter table item add column if not exists cost numeric(18, 2);
create index if not exists item_sku_idx on item(sku);

-- Материалы: номенклатура и цена за единицу приезжают из накладной.
-- Один и тот же материал с разной номенклатурой или ценой — разные остатки,
-- поэтому поля лежат на строке прихода, а не на самом материале.
alter table supply_receipt add column if not exists sku  text not null default '';
alter table supply_receipt add column if not exists cost numeric(18, 2);
create index if not exists receipt_sku_idx on supply_receipt(supply_id, sku, cost);

-- Выдача тоже привязана к конкретной связке: иначе по «Чернила Epson» с двумя
-- разными номенклатурами не посчитать, из какой партии ушло.
alter table supply_issue add column if not exists sku  text not null default '';
alter table supply_issue add column if not exists cost numeric(18, 2);
create index if not exists issue_sku_idx on supply_issue(supply_id, sku, cost);

-- Документальный склад: списания «по бумагам». Отдельный учёт от фактической
-- выдачи — на факт не влияет и в остатки «Выдано и установлено» не входит.
create table if not exists stock_writeoff (
  id        text primary key,
  org_id    text references org(id) on delete cascade,
  supply_id text not null references supply(id) on delete cascade,
  sku       text not null default '',
  cost      numeric(18, 2),
  qty       int not null default 0,
  d         date,
  note      text not null default '',
  staff_id  text references staff(id) on delete set null,
  who       text not null default '',
  at        timestamptz not null default now()
);
create index if not exists writeoff_org_idx    on stock_writeoff(org_id);
create index if not exists writeoff_supply_idx on stock_writeoff(supply_id, sku, cost);

commit;

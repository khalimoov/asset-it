/* Основа: константы и состояние, выборки, деньги, проверки значений, хранилище,
   связь с сервером, журнал удалений, вход в систему, права доступа, оформление.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== константы и состояние ================== */
var ST_USE = "В эксплуатации", ST_STOCK = "На складе", ST_REPAIR = "В ремонте";
var ST_READY = "Готово к эксплуатации", ST_OFF = "Списано";
/* Техника ждёт решения комиссии месяцами: в эксплуатации её уже нет,
   а списанной называть ещё нельзя. */
var ST_TOOFF = "На списание";
var DEF_STATUSES = [ST_USE, ST_STOCK, ST_REPAIR, ST_READY, ST_TOOFF, ST_OFF];
/* роли и права приходят с сервера: cfg.roles, me.perms, me.reg_access */
var REG_SEED = [
  {id:"equipment", name:"ПК и сетевое оборудование", icon:"▣"},
  {id:"ipphone",   name:"IP-телефоны",                icon:"☎"},
  {id:"supplies",  name:"Расходные материалы",        icon:"❏", kind:"supplies"},
  {id:"radio",     name:"Рации",                      icon:"≈"}
];
var SEED_IDS = REG_SEED.map(function(r){ return r.id; });
var DEF_UNITS = ["шт","компл","уп","л","мл","кг","м"];
var DEF_LAYOUT = {subs:true, specs:true, presets:true, dash:true};

var items = [];
var cfg = { registries:[], categories:[], subcategories:[], types:[], specs:[], presets:[],
            users:[], divisions:[], departments:[], ipPools:[], ipReserved:[],
            supplies:[], receipts:[], issues:[], staff:[], repairs:[], notices:[] };

var nav = "dash", curReg = "equipment", regTab = "items", supTab = "stock";
var sortKey = "inv", sortDir = 1, editingId = null, editingUser = null;
var curSpecScope = "", curPreset = "", curPool = "";
var me = null, permList = [], areaList = [], downloads = null, screenRestored = false;
/* Учреждение — верхний уровень: всё остальное приходит уже отфильтрованным
   сервером, поэтому здесь нужен только список и текущий выбор. */
var orgs = [], orgId = "", orgStaff = [], orgOverview = [];

var $ = function(id){ return document.getElementById(id); };
function uid(p){ return (p||"e") + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
/* Открытое модальное окно лежит в верхнем слое браузера — поверх любого z-index,
   и обычная всплывашка пряталась под ним: «не сохраняется, и ничего не пишет».
   Поэтому всплывашка — popover: при каждом показе поднимаем её в верхний слой
   заново, выше последнего открытого окна. Где popover нет — кладём её в окно. */
function toast(m){ var t=$("toast"); t.textContent=m;
  if(t.showPopover){
    try{ if(t.matches(":popover-open")) t.hidePopover(); t.showPopover(); }catch(e){}
  } else {
    var dl = document.querySelectorAll("dialog[open]");
    (dl.length ? dl[dl.length-1] : document.body).appendChild(t);
  }
  t.classList.add("on");
  clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove("on");},2800); }
function cellText(v){ var s = esc(v==null?"":v); return '<td title="'+s+'">'+s+'</td>'; }

/* ================== выборки ================== */
function byId(list,id){ return (cfg[list]||[]).find(function(o){ return o.id===id; }); }
function nameById(list,id){ var x=byId(list,id); return x?x.name:""; }
/* Отделы. Одноимённые отделы бывают в разных подразделениях (ООТиЗ есть и в
   ГМЗ-6, и в ГМЗ-7), поэтому список отделов всегда строится с оглядкой на
   подразделение: выбрано — только его отделы и ещё не размеченные; не выбрано —
   все, сгруппированные по подразделениям, чтобы одинаковые названия не шли подряд. */
function byName(a, b){ return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; }
function depOptions(divId, empty){
  var one = function(d){ return '<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>'; };
  var head = '<option value="">'+esc(empty)+'</option>';
  var free = cfg.departments.filter(function(d){ return !d.divisionId || !byId("divisions", d.divisionId); }).sort(byName);
  if(divId){
    var own = cfg.departments.filter(function(d){ return d.divisionId === divId; }).sort(byName);
    if(!free.length) return head + own.map(one).join("");
    return head + own.map(one).join("") +
      '<optgroup label="Без подразделения">' + free.map(one).join("") + '</optgroup>';
  }
  return head + cfg.divisions.slice().sort(byName).map(function(v){
    var list = cfg.departments.filter(function(d){ return d.divisionId === v.id; }).sort(byName);
    return list.length ? '<optgroup label="'+esc(v.name)+'">' + list.map(one).join("") + '</optgroup>' : "";
  }).join("") + (free.length ? '<optgroup label="Без подразделения">' + free.map(one).join("") + '</optgroup>' : "");
}
/* Пара «подразделение → отдел» в окне: отдел перестраивается под подразделение,
   выбранный отдел сохраняется, если он в новом списке есть. */
function fillDeps(divSel, depSel, keep, empty){
  var dep = $(depSel);
  dep.innerHTML = depOptions($(divSel).value, empty || "— не указан —");
  dep.value = keep && dep.querySelector('option[value="'+keep+'"]') ? keep : "";
}
/* выбрали отдел при пустом подразделении — подставляем его подразделение */
function depPicksDiv(divSel, depSel){
  var d = byId("departments", $(depSel).value);
  if(d && d.divisionId && !$(divSel).value && byId("divisions", d.divisionId)){
    $(divSel).value = d.divisionId; fillDeps(divSel, depSel, d.id);
  }
}
function rid(o){ return (o && o.registryId) || "equipment"; }
function reg(id){ return cfg.registries.find(function(r){ return r.id===(id||curReg); }) || cfg.registries[0] || REG_SEED[0]; }
function statusesOf(id){ var r = reg(id); return (r && r.statuses && r.statuses.length) ? r.statuses : DEF_STATUSES; }

function regItems(id){ id = id||curReg; return items.filter(function(i){ return rid(i)===id; }); }
function isSupplyReg(id){ var r = reg(id); return !!r && r.kind==="supplies"; }
/* какие уровни включены у раздела: подкатегории, характеристики, наборы, дашборд */
function regLayout(id){
  var r = reg(id), l = (r && r.layout) || {};
  return { subs: l.subs!==false, specs: l.specs!==false,
           presets: l.presets!==false, dash: l.dash!==false };
}
/* «оборудование» — всё, кроме разделов расходных материалов */
function assetItems(){
  var ids = cfg.registries.filter(function(r){ return r.kind!=="supplies"; }).map(function(r){ return r.id; });
  return items.filter(function(i){ return ids.indexOf(rid(i))!==-1; });
}
/* Списание идёт либо на сотрудника (userId), либо на оборудование (itemId):
   краска — в принтер, термопаста — в компьютер. Подразделение и отдел
   берутся у того, на кого списали. */
function issueTarget(x){
  if(x.itemId){
    var it = items.find(function(i){ return i.id===x.itemId; });
    if(!it) return {kind:"item", name:"оборудование удалено", div:"", dep:"", item:null};
    var who = ownerName(it.owner);
    return {kind:"item", item:it,
            name:(typeName(it.type)||"оборудование") + " · инв. " + (it.inv||"—") + (who ? " · " + who : ""),
            div:nameById("divisions", it.division), dep:nameById("departments", it.department)};
  }
  var u = byId("users", x.userId) || {};
  return {kind:"user", item:null, name:u.name||"",
          div:nameById("divisions", u.divisionId), dep:nameById("departments", u.departmentId)};
}
function issuesOfItem(id){
  return cfg.issues.filter(function(x){ return x.itemId===id; })
    .sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
}
function issuedCount(sid){
  return cfg.issues.filter(function(x){ return x.supplyId===sid; })
    .reduce(function(a,x){ return a + (x.qty||1); }, 0);
}
function roleName(id){
  var r = (cfg.roles||[]).find(function(x){ return x.id===id; });
  return r ? r.name : "—";
}
function masters(){ return (cfg.staff||[]).filter(function(x){ return x.isMaster; }); }
function staffName(id){ var x = byId("staff", id); return x ? x.name : ""; }
function fmtWhen(iso){
  if(!iso) return "";
  var d = new Date(iso);
  if(isNaN(d.getTime())) return "";
  var z = function(v){ return (v<10?"0":"")+v; };
  return z(d.getDate())+"."+z(d.getMonth()+1)+"."+d.getFullYear()+" "+z(d.getHours())+":"+z(d.getMinutes());
}
/* лента событий по ремонту; forStaffId заполняется на будущее — под адресные уведомления */
function notify(type, o, text, forStaffId){
  cfg.notices.unshift({id:uid("nt"), at:new Date().toISOString(), type:type,
    itemId:o.id||"", registryId:rid(o), inv:o.inv||"", typeName:typeName(o.type)||"",
    masterId:o.masterId||"", text:text||"", forStaffId:forStaffId||"", seen:false});
  if(cfg.notices.length > 300) cfg.notices.length = 300;
}
function unseenNotices(){ return cfg.notices.filter(function(x){ return !x.seen; }).length; }

function repairsOfMaster(id){
  return items.filter(function(i){ return i.masterId===id && i.status===ST_REPAIR; })
    .sort(function(a,b){ return (a.statusDate||"").localeCompare(b.statusDate||""); });
}
/* сколько дней между датами; если вторая пустая — по сегодняшний день */
function daysBetween(from, to){
  if(!from) return "";
  var d1 = new Date(from+"T00:00:00"), d2 = to ? new Date(to+"T00:00:00") : new Date();
  if(isNaN(d1.getTime()) || isNaN(d2.getTime())) return "";
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}
function openRepairOf(itemId){
  return cfg.repairs.find(function(r){ return r.itemId===itemId && !r.to; }) || null;
}
function repairsHistory(masterId){
  return cfg.repairs.filter(function(r){ return !masterId || r.masterId===masterId; })
    .sort(function(a,b){ return (b.from||"").localeCompare(a.from||""); });
}
function repairMasterName(r){ return staffName(r.masterId) || r.masterName || "—"; }
/* открываем и закрываем ремонт по смене статуса записи */
function syncRepairLog(prev, o){
  var id = o.id || (prev && prev.id); if(!id) return false;
  var was = !!(prev && prev.status===ST_REPAIR), now = (o.status===ST_REPAIR);
  var open = openRepairOf(id);
  if(now && !was){
    cfg.repairs.push({id:uid("rp"), itemId:id, registryId:rid(o), inv:o.inv||"",
      typeName:typeName(o.type)||"", masterId:o.masterId||"",
      masterName:staffName(o.masterId)||"", from:o.statusDate || today(), to:"",
      note:o.statusNote||"", result:""});
    notify("repair", o, "Отправлено в ремонт" +
      (staffName(o.masterId) ? " — мастер "+staffName(o.masterId) : "") +
      (o.statusNote ? ": "+o.statusNote : ""), o.masterId);
    return true;
  }
  if(now && was && open){
    open.masterId = o.masterId||"";
    open.masterName = staffName(o.masterId) || open.masterName || "";
    if(o.statusDate) open.from = o.statusDate;
    if(o.statusNote) open.note = o.statusNote;
    open.inv = o.inv||open.inv;
    return true;
  }
  if(!now && was && open){
    var to = o.statusDate || today();
    open.to = (to < open.from) ? open.from : to;
    open.result = o.status;
    open.doneNote = o.statusNote || "";
    var d = daysBetween(open.from, open.to);
    addHistory(o, "Возвращён из ремонта" +
      (repairMasterName(open)!=="—" ? " (мастер: "+repairMasterName(open)+")" : "") +
      ", дней в ремонте: " + d + (open.doneNote ? " — "+open.doneNote : ""));
    var who = repairMasterName(open)!=="—" ? " — мастер "+repairMasterName(open) : "";
    var what = open.doneNote ? ": "+open.doneNote : "";
    if(o.status===ST_READY)      notify("ready", o, "Готово к эксплуатации"+who+what, "");
    else if(o.status===ST_OFF)   notify("off",   o, "Списано после ремонта"+who+what, "");
    else                         notify("done",  o, "Вернулось из ремонта — «"+o.status+"»"+who+what, "");
    return true;
  }
  return false;
}
function supplyById(id){ return cfg.supplies.find(function(m){ return m.id===id; }) || null; }
function receiptsOf(sid){ return cfg.receipts.filter(function(x){ return x.supplyId===sid; }); }
/* «Поступило» всегда равно сумме приходов */
function recalcSupply(m){
  if(!m) return;
  m.qty = receiptsOf(m.id).reduce(function(a,x){ return a + (x.qty||0); }, 0);
}
function stockLeft(m){ return (m.qty||0) - issuedCount(m.id); }

/* Партии материала — строки прихода, сошедшиеся по материалу, номенклатурному
   номеру и стоимости. Совпало всё — одна строка остатков; разошлось хоть что-то
   (пришла другая партия по другой цене) — строки разные, у каждой свой остаток.
   out — фактическая выдача, off — документальное списание: это два разных учёта,
   поэтому и считаются они порознь. */
function lots(){
  var by = {}, order = [];
  var touch = function(supplyId, sku, cost){
    var k = lotKey(supplyId, sku, cost);
    if(!by[k]){
      by[k] = {key:k, supplyId:supplyId, sku:String(sku||"").trim(),
               cost:numVal(cost), got:0, out:0, off:0};
      order.push(k);
    }
    return by[k];
  };
  cfg.supplies.forEach(function(m){ touch(m.id, "", null); });
  cfg.receipts.forEach(function(r){ touch(r.supplyId, r.sku, r.cost).got += (r.qty||0); });
  cfg.issues.forEach(function(x){ touch(x.supplyId, x.sku, x.cost).out += (x.qty||1); });
  (cfg.writeoffs||[]).forEach(function(x){ touch(x.supplyId, x.sku, x.cost).off += (x.qty||0); });
  /* у материала без прихода остаётся пустая связка — иначе он пропал бы из списка;
     а вот лишние пустые связки у материалов, которые пришли с номенклатурой, убираем */
  return order.map(function(k){ return by[k]; }).filter(function(l){
    if(l.got || l.out || l.off) return true;
    return !order.some(function(k2){
      var o = by[k2];
      return o !== l && o.supplyId === l.supplyId && (o.got || o.out || o.off);
    });
  });
}
function lotsOf(supplyId){
  return lots().filter(function(l){ return l.supplyId === supplyId; });
}
function lotLeft(l){ return l.got - l.out; }        /* факт: пришло минус выдано */
function lotDocLeft(l){ return l.got - l.off; }     /* документально: пришло минус списано */
function lotLabel(l){
  var m = supplyById(l.supplyId) || {};
  var mm = supplyModelsOf(m).map(modelName).filter(Boolean).join(", ");
  return (m.name || "—") + (mm ? " · " + mm : "") +
         (l.sku ? " · " + l.sku : "") +
         (l.cost === null ? "" : " · " + money(l.cost));
}

/* ---- деньги ---- */
/* Число из поля ввода: пустое поле — «не указано», а не ноль. Пробелы в
   разрядах и запятую вместо точки люди ставят постоянно. */
function numVal(v){
  if(v === null || v === undefined) return null;
  var t = String(v).replace(/[\s ]/g, "").replace(",", ".");
  if(!t) return null;
  var n = parseFloat(t);
  return isFinite(n) ? n : null;
}
/* 28769000 -> «28 769 000», 120.5 -> «120.5». Копейки показываем только когда они есть. */
function money(v){
  var n = numVal(v);
  if(n === null) return "";
  var neg = n < 0; n = Math.abs(n);
  var whole = Math.floor(n), frac = Math.round((n - whole) * 100);
  var t = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  if(frac) t += "," + (frac<10 ? "0"+frac : String(frac));
  return (neg ? "−" : "") + t;
}
/* Сумма строки: цена за единицу на количество. Если цены нет — и суммы нет. */
function lineSum(cost, qty){
  var c = numVal(cost);
  return c === null ? null : c * (parseFloat(qty) || 0);
}
/* Ключ связки «материал + номенклатура + стоимость»: по нему материалы
   сходятся в одну строку остатков или расходятся на разные. */
function lotKey(supplyId, sku, cost){
  var c = numVal(cost);
  return (supplyId||"") + "|" + String(sku||"").trim() + "|" + (c === null ? "" : c.toFixed(2));
}
function fmtDate(d){
  if(!d) return "";
  var x = String(d).split("-");
  return x.length===3 ? x[2]+"."+x[1]+"."+x[0] : String(d);
}
function today(){
  var d = new Date(), z = function(v){ return (v<10?"0":"")+v; };
  return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate());
}
function regCats(id){ id = id||curReg; return cfg.categories.filter(function(c){ return rid(c)===id; }); }
function regSubs(id){ id = id||curReg; return cfg.subcategories.filter(function(g){ return rid(g)===id; }); }
function regTypes(id){ id = id||curReg; return cfg.types.filter(function(t){ return rid(t)===id; }); }

function typeName(id){ return nameById("types", id); }
function subOfType(typeId){ var t=byId("types",typeId); return t ? (t.subcategoryId||"") : ""; }
function catOfType(typeId){
  var t = byId("types", typeId); if(!t) return "";
  if(t.subcategoryId){ var g = byId("subcategories", t.subcategoryId); if(g) return g.categoryId||""; }
  return t.categoryId||"";
}
function subsOf(catId){ return regSubs().filter(function(g){ return !catId || (g.categoryId||"")===catId; }); }
function typesOf(catId, subId){
  return regTypes().filter(function(t){
    if(subId) return (t.subcategoryId||"")===subId;
    if(catId) return catOfType(t.id)===catId;
    return true;
  });
}
/* раздел, которому принадлежит характеристика — нужен, чтобы знать его статусы */
function regOfSpec(sp){
  if(sp.subcategoryId){ var g = byId("subcategories", sp.subcategoryId); if(g) return rid(g); }
  if(sp.typeId){ var t = byId("types", sp.typeId); if(t) return rid(t); }
  return curReg;
}
function statusesForSpec(sp){ return statusesOf(regOfSpec(sp)); }
/* обязательна ли характеристика при конкретном статусе */
function specReq(sp, status){
  if(!sp.req) return false;
  var rs = sp.reqStatuses;
  if(!rs || !rs.length) return true;
  return rs.indexOf(status) !== -1;
}
function ownSpecs(typeId){ return cfg.specs.filter(function(s){ return s.typeId===typeId; }); }
function subSpecs(subId){ return cfg.specs.filter(function(s){ return s.subcategoryId===subId; }); }
/* Характеристики подкатегории действуют у всех её типов, но отдельному типу
   что-то может быть не нужно: такие лежат в t.hiddenSpecs. Сама характеристика
   при этом остаётся у подкатегории и у остальных типов. */
function hiddenOf(t){ return (t && t.hiddenSpecs) || []; }
function specHidden(t, specId){ return hiddenOf(t).indexOf(specId) !== -1; }
function specsOf(typeId){
  var t = byId("types", typeId); if(!t) return [];
  var inh = (t.subcategoryId ? subSpecs(t.subcategoryId) : []).filter(function(sp){
    return !specHidden(t, sp.id);
  });
  return inh.concat(ownSpecs(typeId));
}
/* ответственный: ссылка на справочник или сохранённый текст */
function ownerName(v){ if(!v) return ""; var u = byId("users", v); return u ? u.name : String(v); }
function itemsOfUser(uidv){ return items.filter(function(i){ return i.owner===uidv; }).length; }
/* техника, которая реально числится за человеком: списанная не в счёт */
function activeOfUser(uidv){
  return items.filter(function(i){ return i.owner===uidv && i.status!==ST_OFF; });
}

/* ================== проверки значений ================== */
var KIND = {text:"Текст",number:"Число",date:"Дата",list:"Список",ip:"IP-адрес",mac:"MAC-адрес"};
var PLACE = {ip:"192.168.1.10", mac:"A1:B2:C3:D4:E5:F6"};
var RE_IP  = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
var RE_MAC = /^[0-9A-Fa-f]{2}([:\-. ]?[0-9A-Fa-f]{2}){5}$/;
function normVal(sp, v){
  v = String(v==null?"":v).trim();
  return sp.kind==="mac" ? v.toUpperCase().replace(/[^0-9A-F]/g,"") : v.toLowerCase();
}
function formatError(sp, v){
  v = String(v||"").trim(); if(!v) return "";
  if(sp.kind==="ip"  && !RE_IP.test(v))  return "неверный IP-адрес, нужен вид 192.168.1.10";
  if(sp.kind==="mac" && !RE_MAC.test(v)) return "неверный MAC-адрес, нужен вид A1:B2:C3:D4:E5:F6";
  if(sp.kind==="number" && isNaN(Number(v))) return "нужно число";
  return "";
}
/* одноимённые уникальные характеристики делят общее пространство значений —
   во всех разделах сразу, поэтому IP не повторится ни у ПК, ни у телефона */
function uniqueTwins(sp){
  var nm = String(sp.name||"").trim().toLowerCase();
  return cfg.specs.filter(function(x){ return x.uniq && String(x.name||"").trim().toLowerCase()===nm; });
}
function findDuplicate(sp, value, selfId){
  var target = normVal(sp, value); if(!target) return null;
  var ids = uniqueTwins(sp).map(function(x){ return x.id; }), hit = null;
  items.some(function(it){
    if(it.id===selfId) return false;
    return ids.some(function(id){
      if(it.specsNone && it.specsNone[id]) return false;
      var v = it.specs && it.specs[id];
      if(v && normVal(sp, v)===target){ hit = it; return true; }
      return false;
    });
  });
  return hit;
}

/* ================== хранилище ================== */
/* Приводит ответ сервера к виду, который ждёт интерфейс: все коллекции на месте,
   у разделов заполнены статусы и наполнение. Сами данные приходят из PostgreSQL. */
function normCfg(v){
  v = v || {};
  var c = { registries:v.registries||[], categories:v.categories||[], subcategories:v.subcategories||[],
    types:v.types||[], specs:v.specs||[], presets:v.presets||[], users:v.users||[],
    divisions:v.divisions||[], departments:v.departments||[],
    ipPools:v.ipPools||[], ipReserved:v.ipReserved||[],
    supplies:(v.supplies||[]).map(function(m){
      /* модели материала — всегда списком, даже если сервер прислал одну */
      m.models = (m.models && m.models.length) ? m.models : (m.model ? [m.model] : []);
      return m;
    }), receipts:v.receipts||[], issues:v.issues||[],
    writeoffs:v.writeoffs||[],
    staff:v.staff||[], roles:v.roles||[], repairs:v.repairs||[], notices:v.notices||[],
    netStatus:v.netStatus||{}, warehouses:v.warehouses||[],
    models:v.models||[], places:v.places||[],
    units:(v.units && v.units.length) ? v.units.slice() : DEF_UNITS.slice() };

  c.supplies.forEach(function(m){
    var u = (m.unit||"").trim();
    if(u && c.units.indexOf(u) === -1) c.units.push(u);
  });
  c.registries.forEach(function(r){
    if(!r.kind) r.kind = (r.id==="supplies") ? "supplies" : "assets";
    if(!r.statuses || !r.statuses.length) r.statuses = DEF_STATUSES.slice();
    /* промежуточный статус нужен логике ремонта — досеиваем его после «В ремонте» */
    if(r.kind!=="supplies" && r.statuses.indexOf(ST_READY)===-1 && r.statuses.indexOf(ST_REPAIR)!==-1)
      r.statuses.splice(r.statuses.indexOf(ST_REPAIR)+1, 0, ST_READY);
    /* «На списание» досеиваем перед «Списано» — в старых разделах его ещё нет */
    if(r.kind!=="supplies" && r.statuses.indexOf(ST_TOOFF)===-1 && r.statuses.indexOf(ST_OFF)!==-1)
      r.statuses.splice(r.statuses.indexOf(ST_OFF), 0, ST_TOOFF);
    if(r.builtin === undefined) r.builtin = SEED_IDS.indexOf(r.id) !== -1;
    if(!r.layout) r.layout = Object.assign({}, DEF_LAYOUT);
  });
  return c;
}

/* Версия приложения: 0.<вторая>.<третья>. Третья цифра растёт с каждым
   изменением, первую и вторую меняем только по слову заказчика. Та же строка —
   APP_BUILD в server/app.py: сервер отдаёт свою в /api/state, расходятся —
   значит файлы обновили, а сервер не перезапустили. */
var UI_BUILD = "0.2";
$("appVer").textContent = "Версия " + UI_BUILD;

/* ================== связь с сервером ================== */
function api(path, data){
  var opt = {credentials:"same-origin"};
  if(data !== undefined){
    opt.method = "POST";
    opt.headers = {"Content-Type":"application/json"};
    opt.body = JSON.stringify(data);
  }
  return fetch(path, opt).then(function(r){
    /* на самой форме входа 401 — это просто неверный пароль, а не потеря сессии */
    if(r.status === 401 && path !== "/api/login"){ showLogin(); return Promise.reject({auth:true}); }
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(!r.ok){ j.status = r.status; return Promise.reject(j); }
      return j;
    });
  });
}
/* при отказе сервера возвращаем экран к тому, что реально лежит в базе */
/* «Не удалось» без подробностей заставляет гадать. Показываем, что ответил
   сервер, и отдельно ловим случай «такого запроса сервер не знает». */
function apiWhy(e){
  if(!e) return "";
  if(e.status === 404 || e.status === 405)
    return " — сервер не знает такого запроса. Похоже, он работает на старой версии: " +
           "перезапустите start.bat на сервере.";
  if(e.message) return " — " + e.message;
  if(e.status) return " (ответ сервера: " + e.status + ")";
  return "";
}

function apiError(e){
  if(!e || e.auth) return;
  toast(e.error === "read_only"
          ? (e.message || "Вам открыт только просмотр")
          : e.error === "forbidden" ? "Недостаточно прав для этого действия"
          : e.error === "bad_inv" || e.error === "bad_value" ? (e.message || "Неправильное значение")
                                    : "Сервер недоступен — изменения не сохранены");
  loadState();
}

function loadState(){
  return api("/api/state").then(function(d){
    cfg = normCfg(d.cfg);
    items = d.items || [];
    me = d.me; permList = d.permList || []; areaList = d.areaList || [];
    orgs = d.orgs || []; orgId = d.orgId || "";
    renderOrgPick();
    $("loginScreen").hidden = true;
    $("appRoot").hidden = false;
    $("meName").textContent = me.name; $("meName").title = me.name;
    showBuildWarning(d.build);
    $("meRole").textContent = me.roleName || "роль не назначена";
    document.body.classList.toggle("noadmin", !isAdmin());
    document.body.classList.toggle("nodict", !can("models.edit"));
    if(!screenRestored){ screenRestored = true; restoreScreen(); }
    renderAll();
    loadDeletions();
    loadAd();
    loadOrgs();
    loadOverview();
    loadDocs();
    loadTransfers();
    loadActTpls();
  }).catch(function(e){
    if(e && e.error === "no_org"){
      $("loginScreen").hidden = true; $("appRoot").hidden = false;
      $("buildWarn").hidden = false;
      $("buildWarn").textContent = e.message ||
        "Вам не открыт доступ ни к одному учреждению. Обратитесь к администратору.";
      return;
    }
    if(e && !e.auth) toast("Не удалось загрузить данные");
  });
}

/* Полоса наверху, если страница и сервер из разных сборок: молчать об этом
   нельзя — половина кнопок будет отвечать невнятными ошибками. */
function showBuildWarning(serverBuild){
  var bar = $("buildWarn");
  var bad = !!serverBuild && serverBuild !== UI_BUILD;
  bar.hidden = !bad;
  if(bad)
    bar.textContent = "Страница обновлена (" + UI_BUILD + "), а сервер работает на старой " +
      "версии (" + serverBuild + "). Перезапустите start.bat на сервере — иначе новые " +
      "разделы будут отвечать ошибками.";
  /* совсем старый сервер версию не присылает — тогда тоже предупреждаем */
  if(!serverBuild){
    bar.hidden = false;
    bar.textContent = "Сервер не сообщает свою версию — он запущен со старыми файлами. " +
      "Перезапустите start.bat на сервере.";
  }
}

var cfgSaving = false, cfgPending = false;
function saveCfg(){
  renderAll();
  if(cfgSaving){ cfgPending = true; return Promise.resolve(); }
  cfgSaving = true;
  return api("/api/cfg", cfg).then(function(){
    cfgSaving = false;
    if(cfgPending){ cfgPending = false; return saveCfg(); }
  }).catch(function(e){ cfgSaving = false; apiError(e); });
}
function putLocal(o){
  if(!o.id) o.id = uid();
  var i = items.findIndex(function(x){ return x.id===o.id; });
  if(i>=0) items[i] = o; else items.push(o);
}
function saveItem(obj){
  putLocal(obj); renderAll();
  return api("/api/items", {items:[obj]})
    .then(function(){ toast("Сохранено"); return loadState(); })
    .catch(apiError);
}
function saveItems(list){
  if(!list.length) return Promise.resolve();
  list.forEach(putLocal); renderAll();
  return api("/api/items", {items:list}).then(function(){ return loadState(); }).catch(apiError);
}
/* Причина обязательна: сервер без неё отвечает отказом, а журнал удалений
   существует ради вопроса «кто и зачем это убрал». */
function deleteItems(list, reason){
  if(!list.length) return Promise.resolve();
  var ids = list.map(function(o){ return o.id; });
  items = items.filter(function(x){ return ids.indexOf(x.id)===-1; });
  renderAll();
  return api("/api/items/delete", {ids:ids, reason:reason})
    .then(function(){ return loadDeletions(); }).catch(apiError);
}
function deleteItem(id, reason){
  items = items.filter(function(x){ return x.id!==id; });
  renderAll();
  return api("/api/items/delete", {ids:[id], reason:reason})
    .then(function(){ toast("Удалено"); return loadDeletions(); }).catch(apiError);
}

/* ---------- журнал удалений ---------- */
var dels = [];
function loadDeletions(){
  if(!can("deletions.view")) return Promise.resolve();
  return api("/api/deletions").then(function(d){
    dels = d.deletions || []; renderDels(); renderNav();
  }).catch(function(){});
}

/* Спрашивает причину и зовёт fn(reason). Без причины кнопка «Удалить» недоступна. */
function askDeleteReason(what, fn){
  $("da_what").textContent = what;
  $("da_reason").value = ""; $("da_err").textContent = "";
  $("btnDaOk").disabled = true;
  $("dlgDelAsk").showModal();
  setTimeout(function(){ $("da_reason").focus(); }, 30);
  askDeleteReason.run = fn;
}
$("da_reason").oninput = function(){
  $("btnDaOk").disabled = $("da_reason").value.trim().length < 3;
  $("da_err").textContent = "";
};
$("btnDaCancel").onclick = function(){ $("dlgDelAsk").close(); };
$("btnDaOk").onclick = function(){
  var r = $("da_reason").value.trim();
  if(r.length < 3){ $("da_err").textContent = "Напишите причину — хотя бы несколько слов"; return; }
  $("dlgDelAsk").close();
  if(askDeleteReason.run) askDeleteReason.run(r);
};

/* ================== вход в систему ================== */
function showLogin(){
  $("appRoot").hidden = true;
  $("loginScreen").hidden = false;
  /* подсказка про домен — только там, где вход через домен включён:
     в других местах домена может не быть, и заходят по выданным паролям */
  api("/api/login-info").then(function(d){
    $("lg_sub").textContent = d.ad
      ? "Вход в систему — доменный логин (например, i.ivanov) и пароль Windows, либо логин и пароль, выданные администратором"
      : "Вход в систему — логин и пароль, выданные администратором";
    /* пока нет ни одного логина — вместо входа экран первого запуска */
    $("setupForm").hidden = !d.setup;
    $("loginForm").hidden = !!d.setup;
    if(d.setup) setTimeout(function(){ $("su_name").focus(); }, 30);
  }).catch(function(){});
  setTimeout(function(){ if(!$("loginForm").hidden) $("lg_login").focus(); }, 30);
}
$("setupForm").onsubmit = function(e){
  e.preventDefault();
  var err = $("su_err"); err.textContent = "";
  var name = $("su_name").value.trim(), login = $("su_login").value.trim();
  var p1 = $("su_pass").value, p2 = $("su_pass2").value;
  if(!name){ err.textContent = "Укажите имя"; $("su_name").focus(); return; }
  if(!/^[A-Za-z0-9][A-Za-z0-9._@-]{2,63}$/.test(login)){
    err.textContent = "Логин — от 3 знаков: латиница, цифры, точка, дефис"; $("su_login").focus(); return; }
  if(p1.length < 6){ err.textContent = "Пароль — не короче 6 знаков"; $("su_pass").focus(); return; }
  if(p1 !== p2){ err.textContent = "Пароли не совпадают"; $("su_pass2").focus(); return; }
  $("btnSetup").disabled = true;
  api("/api/setup", {name:name, login:login, password:p1})
    .then(function(){ $("su_pass").value = ""; $("su_pass2").value = ""; forgetScreen(); return loadState(); })
    .catch(function(x){
      err.textContent = (x && x.error === "already_set_up")
        ? "Администратор уже создан — войдите по логину и паролю"
        : ((x && x.message) || "Не удалось создать учётную запись" + apiWhy(x));
      if(x && x.error === "already_set_up") showLogin();
    })
    .then(function(){ $("btnSetup").disabled = false; });
};
$("loginForm").onsubmit = function(e){
  e.preventDefault();
  $("lg_err").textContent = "";
  api("/api/login", {login:$("lg_login").value.trim(), password:$("lg_pass").value})
    .then(function(){ $("lg_pass").value = ""; forgetScreen(); return loadState(); })
    .catch(function(err){
      $("lg_err").textContent = (err && err.auth) ? "" : "Неверный логин или пароль";
    });
};
$("btnLogout").onclick = function(){
  forgetScreen();
  /* после выхода — на главную: следующий вход начинается с дашборда */
  try{ if(urlOn) history.replaceState(null, "", "/"); }catch(e){}
  api("/api/logout", {}).then(function(){ location.reload(); })
    .catch(function(){ location.reload(); });
};
/* ================== права доступа ==================
   Источник правды — сервер: он же отдаёт только доступные разделы.
   Здесь права нужны, чтобы не показывать то, чего нельзя. */
function can(code){ return !!me && me.perms.indexOf(code) !== -1; }
function isAdmin(){ return can("admin"); }
/* Те же правила, что и на сервере: уровень раздела решает роль, а роли общие
   на всю базу, поэтому уровень ищется и по исходному имени раздела
   («<учреждение>_equipment»). Правка раздела — это всё внутри него: записи,
   категории, типы, характеристики, наборы, ремонт, списание. */
function regLevel(id){
  if(!me) return "none";
  if(isAdmin()) return "edit";
  var acc = me.reg_access || {};
  var lvl = acc[id];
  if(lvl === undefined){
    var base = (id || "").indexOf("_") !== -1 ? id.slice(id.indexOf("_") + 1) : id;
    lvl = acc[base] || "none";
  }
  /* разделы учёта видят все: «нет доступа» здесь значит просмотр */
  if(lvl !== "edit") lvl = "view";
  /* чужое учреждение: правка только с org.editall */
  if(lvl === "edit" && orgId && me.org_id && orgId !== me.org_id && !can("org.editall")) return "view";
  return lvl;
}
function canEdit(id){ return regLevel(id || curReg) === "edit"; }
/* приход и выдача материалов — правка раздела «Расходные материалы» */
function canSup(){
  var r = cfg.registries.find(function(x){ return x.kind === "supplies"; });
  return !!r && canEdit(r.id);
}
/* Справочник: правка — «<код>.edit», просмотр — «<код>.view» (сервер выводит
   их из таблицы доступа роли). Без просмотра страницы справочника нет в меню. */
function canDict(code){ return can(code + ".edit"); }
function hide(id, allowed){ var el = $(id); if(el) el.hidden = !allowed; }
function applyPerms(){
  var reg = canEdit(curReg);
  hide("btnAdd", reg);
  /* при взгляде на несколько учреждений непонятно, куда добавлять раздел */
  hide("btnAddReg", isAdmin() && !scopeWide());
  hide("btnAddUser", canDict("employees"));
  hide("btnCollectUsers", canDict("employees"));
  hide("btnAddStaff", can("staff.manage"));
  hide("btnAaTest", isAdmin());          /* проверка входа LDAP — только администратору */
  hide("btnAddRole", can("staff.manage"));
  hide("btnAdSync", can("ad.sync"));
  hide("btnAdSave", can("ad.sync"));
  hide("btnAdTest", can("ad.sync"));
  hide("btnAddOrg", can("org.manage"));
  hide("btnAddWh", canDict("warehouses"));
  hide("btnAddModel", canDict("models"));
  hide("btnAddActTpl", canDict("acttpl"));
  hide("btnShowModel", canDict("models"));
  if(!canDict("models") && $("addModel")) $("addModel").hidden = true;
  ["divisions","departments","places"].forEach(function(k){
    var K = k.charAt(0).toUpperCase() + k.slice(1), ok = canDict(k);
    hide("btnShow" + K, ok);
    if(!ok && $("add" + K)) $("add" + K).hidden = true;
    var b = document.querySelector('[data-add="' + k + '"]'); if(b) b.hidden = !ok;
  });
  hide("docDrop", can("docs.edit"));
  hide("btnDocCfg", can("docs.edit"));
  hide("btnPools", can("ip.edit"));
  hide("btnAddIp", can("ip.edit"));
  /* материалы: без правки раздела нет ни «+ Приход материала», ни «Списание» */
  var sup = canSup();
  hide("btnShowSup", sup);
  hide("btnWhOff", sup);
  if(!sup && $("supAddCard")) $("supAddCard").hidden = true;
  ["btnAddSub","btnAddType","btnAddSpec","btnApplyPreset","btnTagPreset",
   "btnAddPresetSpec","btnRenPreset","btnDelPreset"].forEach(function(id){ hide(id, reg); });
  var c = document.querySelector('[data-add="categories"]'); if(c) c.hidden = !reg;
  var pr = document.querySelector('[data-add="presets"]');   if(pr) pr.hidden = !reg;
  /* раздел только на просмотр: формы правки спрятаны, таблицы не нажимаются */
  $("v-reg").classList.toggle("ro", !reg);
}

/* ================== оформление ================== */
/* Тумблер у названия: два положения, светлая и тёмная. Пока пользователь его
   не трогал, тема берётся у системы («auto» в localStorage, как раньше), а
   тумблер просто показывает, какая сейчас действует. */
function systemDark(){
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function applyTheme(t){
  if(t==="auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try{ localStorage.setItem("it_inv_theme", t); }catch(e){}
  var dark = t==="dark" || (t==="auto" && systemDark());
  var sw = $("themeSw");
  sw.classList.toggle("on", dark);
  sw.setAttribute("aria-checked", dark ? "true" : "false");
  sw.title = dark ? "Тёмная тема — переключить на светлую" : "Светлая тема — переключить на тёмную";
}
$("themeSw").onclick = function(){
  applyTheme($("themeSw").classList.contains("on") ? "light" : "dark");
};
(function(){
  var t = "auto";
  try{ t = localStorage.getItem("it_inv_theme") || "auto"; }catch(e){}
  applyTheme(t);
  if(window.matchMedia){
    /* тема системы поменялась, а своей пользователь не выбирал — двигаем тумблер */
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onSys = function(){ var cur = "auto"; try{ cur = localStorage.getItem("it_inv_theme") || "auto"; }catch(e){} if(cur==="auto") applyTheme("auto"); };
    if(mq.addEventListener) mq.addEventListener("change", onSys);
  }
})();

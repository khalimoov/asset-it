/* Расходные материалы: Таблица факт, выдача, приход, карточка материала.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== расходные материалы ================== */
var ADD_UNIT = "__add_unit__";
function fillUnits(){
  var sel = $("supUnit"), keep = sel.value;
  sel.innerHTML = cfg.units.map(function(u){
    return '<option value="'+esc(u)+'">'+esc(u)+'</option>'; }).join("") +
    (isAdmin() ? '<option value="'+ADD_UNIT+'">＋ добавить свою…</option>' : '');
  if(keep && cfg.units.indexOf(keep)!==-1) sel.value = keep;
}
$("supUnit").onchange = function(){
  if(this.value !== ADD_UNIT) return;
  var nm = prompt("Новая единица измерения:", "");
  nm = nm===null ? "" : String(nm).trim();
  if(!nm){ fillUnits(); return; }
  if(cfg.units.some(function(u){ return u.toLowerCase()===nm.toLowerCase(); })){
    toast("Такая единица уже есть"); fillUnits(); this.value = nm; return;
  }
  cfg.units.push(nm);
  fillUnits(); this.value = nm;
  saveCfg(); toast("Единица добавлена: "+nm);
};
/* подставляем единицу уже заведённого материала, когда его выбирают из подсказок */
$("supName").addEventListener("input", function(){
  var v = this.value.trim().toLowerCase(); if(!v) return;
  var m = cfg.supplies.find(function(x){ return x.name.toLowerCase()===v; });
  if(!m) return;
  if(m.unit && cfg.units.indexOf(m.unit)!==-1) $("supUnit").value = m.unit;
  /* узнали материал по названию — показываем его модели, их можно дополнить */
  if(!supPickedModels.length) setSupPicked(supplyModelsOf(m));
});

/* Модели для материала — все модели техники. Отдельных «моделей расходников»
   нет: материал ставится в оборудование, и модель у него та же, что у железа
   («Seagate 1 ТБ» — и запчасть, и диск в компьютере). Раньше список сужался по
   разделу расходников и потому всегда был пуст. */
function supplyModels(){
  return cfg.models.slice()
    .sort(function(a,b){ return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; });
}
/* «Без модели» — явное «не указывать»: список запирается и очищается.
   Заказчик просил показать, что модель необязательна, а не догадываться
   по пустому пункту в списке. */
function noModelToggle(boxId, selId, after){
  var b = $(boxId); if(!b) return;
  b.onchange = function(){
    var sel = $(selId);
    sel.disabled = b.checked;
    if(b.checked) sel.value = "";
    if(after) after();
  };
}
noModelToggle("supNoModel", "supModel", function(){
  $("btnSupModelAdd").disabled = $("supNoModel").checked;
  if($("supNoModel").checked) setSupPicked([]);
});
$("btnSupModelAdd").onclick = function(){
  var id = $("supModel").value;
  if(!id){ toast("Выберите модель в списке"); return; }
  if(supPickedModels.indexOf(id) !== -1){ toast("Эта модель уже добавлена"); return; }
  supPickedModels.push(id);
  renderSupPicked();
};
$("supModelList").addEventListener("click", function(e){
  var b = e.target.closest(".js-supmdel"); if(!b) return;
  supPickedModels = supPickedModels.filter(function(x){ return x !== b.dataset.m; });
  renderSupPicked();
});

/* Модели материала — список: одна и та же запчасть подходит к разной технике.
   Поле `model` у материала осталось первой из списка ради старых мест. */
function supplyModelsOf(m){
  if(!m) return [];
  if(m.models && m.models.length) return m.models;
  return m.model ? [m.model] : [];
}
var supPickedModels = [];          /* что набрано в форме прихода */
function renderSupPicked(){
  var box = $("supModelList");
  if(!box) return;
  box.innerHTML = supPickedModels.map(function(id){
    return '<span class="chip">'+esc(modelName(id) || "—")+
           '<button class="x js-supmdel" data-m="'+esc(id)+'" title="Убрать">✕</button></span>';
  }).join("") || '<span class="note" style="margin:0">Модель не выбрана</span>';
}
function setSupPicked(list){
  supPickedModels = (list || []).slice();
  renderSupPicked();
}
function fillSupModels(){
  var keep = $("supModel").value;
  $("supModel").innerHTML = supModelOptions();
  if(keep) $("supModel").value = keep;
  $("supModel").disabled = $("supNoModel").checked;
}
function supModelOptions(){
  var list = supplyModels();
  /* раскладываем по разделам: так видно, к какой технике модель относится */
  var by = {}, order = [];
  list.forEach(function(m){
    var r = rid(m) || "";
    if(!by[r]){ by[r] = []; order.push(r); }
    by[r].push(m);
  });
  var opts = '<option value="">— не указана —</option>';
  order.sort(function(a, b){
    return (nameById("registries", a) || "").toLowerCase() <
           (nameById("registries", b) || "").toLowerCase() ? -1 : 1;
  }).forEach(function(r){
    var inner = by[r].map(function(m){
      return '<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>'; }).join("");
    var nm = nameById("registries", r);
    opts += nm ? '<optgroup label="'+esc(nm)+'">'+inner+'</optgroup>' : inner;
  });
  return opts;
}
function renderStock(){
  fillUnits();
  fillSupModels();
  renderSupPicked();
  $("supNames").innerHTML = cfg.supplies.slice()
    .sort(function(a,b){ return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; })
    .map(function(m){ return '<option value="'+esc(m.name)+'"></option>'; }).join("");
  var q = $("qStock").value.trim().toLowerCase(), giveOk = can("supply.issue");
  var all = lots().sort(function(a,b){
    var an = (supplyById(a.supplyId)||{}).name || "", bn = (supplyById(b.supplyId)||{}).name || "";
    if(an.toLowerCase() !== bn.toLowerCase()) return an.toLowerCase()<bn.toLowerCase()?-1:1;
    if(a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
    return (a.cost||0) - (b.cost||0);
  });
  var list = all.filter(function(l){
    if(!q) return true;
    var m = supplyById(l.supplyId) || {};
    return [m.name, l.sku, String(l.cost||""), m.note].join(" ").toLowerCase().indexOf(q)!==-1;
  });
  /* выдача начинается со строки материала: связка уже выбрана, остаётся
     указать, кому и сколько */
  $("stockBody").innerHTML = list.map(function(l, i){
    var m = supplyById(l.supplyId) || {}, left = lotLeft(l);
    var cls = left<=0 ? "b-danger" : left<=2 ? "b-warn" : "b-ok";
    return '<tr data-m="'+esc(l.supplyId)+'" data-k="'+esc(l.key)+'"><td class="num">'+(i+1)+'</td>'+
      cellText(m.name||"—")+
      '<td class="mono">'+esc(l.sku||"—")+'</td>'+
      '<td class="mono">'+esc(l.cost===null ? "—" : money(l.cost))+'</td>'+
      cellText(m.unit||"шт")+
      '<td>'+l.got+'</td><td>'+l.out+'</td>'+
      '<td><span class="badge '+cls+'">'+left+'</span></td>'+
      '<td class="hide-md" title="'+esc(m.note||"")+'">'+esc(m.note||"")+'</td>'+
      acts(['<button class="btn-sm js-give"'+(left<=0 || !giveOk ? ' disabled' : '')+
              ' title="'+(left<=0 ? "Остатка нет" : "Выдать сотруднику или установить в оборудование")+'">Выдать</button>',
            '<button class="ic js-renm" title="Изменить материал">✎</button>',
            '<button class="ic btn-danger js-delm" title="Удалить материал">✕</button>'])+'</tr>';
  }).join("");
  var se = $("stockEmpty"); se.hidden = list.length>0;
  se.textContent = all.length ? "Ничего не найдено." : "Материалы пока не заведены.";
}
$("qStock").oninput = function(){ renderStock(); renderIssued(); };
$("btnAddSup").onclick = function(){
  var nm = $("supName").value.trim();
  var qty = Math.max(1, parseInt($("supQty").value,10)||1);
  if(!nm){ toast("Введите название материала"); return; }
  var d = $("supDate").value || today();
  var note = $("supNote").value.trim();
  var m = cfg.supplies.find(function(x){ return x.name.toLowerCase()===nm.toLowerCase(); });
  if(m){
    if($("supUnit").value.trim()) m.unit = $("supUnit").value.trim();
  } else {
    m = {id:uid("m"), name:nm, unit:$("supUnit").value.trim()||"шт", qty:0, note:note};
    cfg.supplies.push(m);
  }
  /* модели — свойство материала, а не отдельного прихода: по ним потом
     отбирают, что списывать по документам на «Таблице склада». Их может быть
     несколько: одна запчасть подходит к разной технике. */
  if($("supNoModel").checked){
    m.models = []; m.model = "";
  } else if(supPickedModels.length){
    m.models = supPickedModels.slice();
    m.model = m.models[0];
  }
  var sku = $("supSku").value.trim(), cost = numVal($("supCost").value);
  cfg.receipts.push({id:uid("rc"), supplyId:m.id, qty:qty, sku:sku, cost:cost, date:d, note:note});
  recalcSupply(m);
  $("supName").value=""; $("supQty").value="1"; $("supNote").value="";
  $("supSku").value=""; $("supCost").value="";
  setSupPicked([]);
  saveCfg();
  toast("Приход записан: "+m.name+(sku?" · "+sku:"")+" × "+qty+" от "+fmtDate(d));
};
$("supName").addEventListener("keydown", function(e){ if(e.key==="Enter") $("btnAddSup").click(); });
$("stockBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  if(e.target.classList.contains("js-give")){ openIssue(tr.dataset.k); return; }
  var m = supplyById(tr.dataset.m); if(!m) return;
  if(e.target.classList.contains("js-renm")){ openSupCard(tr.dataset.k); return; }
  if(e.target.classList.contains("js-delm")) delSupply(m);
});
function delSupply(m){
  var used = issuedCount(m.id);
  if(!confirm("Удалить материал «"+m.name+"»?"+
    (used?"\nПо нему есть списания: "+used+" — они тоже удалятся.":""))) return false;
  cfg.issues = cfg.issues.filter(function(x){ return x.supplyId!==m.id; });
  cfg.receipts = cfg.receipts.filter(function(x){ return x.supplyId!==m.id; });
  cfg.supplies = cfg.supplies.filter(function(x){ return x.id!==m.id; });
  saveCfg();
  return true;
}

/* Карточка материала: всё, что раньше спрашивалось подряд окнами prompt.
   Строка «Таблицы факт» — связка «материал + номенклатура + стоимость»:
   название, единица, модели и примечание — у материала целиком, а
   номенклатура и стоимость — у этой связки: меняются во всех её приходах,
   выдачах и списаниях, иначе остатки разошлись бы на две строки. */
var spKey = "", spModels = [];
function renderSpModels(){
  $("spModelList").innerHTML = spModels.map(function(id){
    return '<span class="chip">'+esc(modelName(id) || "—")+
           '<button class="x js-spmdel" data-m="'+esc(id)+'" title="Убрать">✕</button></span>';
  }).join("") || '<span class="note" style="margin:0">Модель не выбрана</span>';
}
function openSupCard(key){
  var l = lots().find(function(x){ return x.key===key; }); if(!l) return;
  var m = supplyById(l.supplyId); if(!m) return;
  spKey = key;
  spModels = supplyModelsOf(m).slice();
  $("spTitle").textContent = "Материал: " + m.name;
  $("sp_name").value = m.name || "";
  var units = cfg.units.slice();
  if(m.unit && units.indexOf(m.unit) === -1) units.push(m.unit);
  $("sp_unit").innerHTML = units.map(function(u){
    return '<option value="'+esc(u)+'">'+esc(u)+'</option>'; }).join("");
  $("sp_unit").value = m.unit || units[0] || "";
  $("sp_sku").value = l.sku || "";
  $("sp_cost").value = l.cost === null ? "" : String(l.cost);
  $("sp_note").value = m.note || "";
  $("sp_model").innerHTML = supModelOptions();
  $("spNoModel").checked = !spModels.length;
  renderSpModels();
  var u = m.unit || "шт";
  $("spStats").innerHTML =
    '<div><span>Поступило</span><b>'+l.got+' '+esc(u)+'</b></div>'+
    '<div><span>Выдано</span><b>'+l.out+' '+esc(u)+'</b></div>'+
    '<div><span>Остаток</span><b>'+lotLeft(l)+' '+esc(u)+'</b></div>'+
    '<div><span>По документам</span><b>'+lotDocLeft(l)+' '+esc(u)+'</b></div>';
  $("sp_err").textContent = "";
  /* номенклатура и цена переписывают и выдачи со списаниями — нужны оба права */
  var mayLot = can("supply.receive") && can("supply.issue");
  $("sp_sku").disabled = $("sp_cost").disabled = !mayLot;
  var may = can("supply.receive");
  ["sp_name","sp_unit","sp_note","spNoModel"].forEach(function(id){ $(id).disabled = !may; });
  $("sp_model").disabled = $("btnSpModelAdd").disabled = !may || $("spNoModel").checked;
  hide("btnSpSave", can("supply.receive"));
  hide("btnSpDel", can("supply.receive"));
  $("dlgSup").showModal();
}
$("btnSpModelAdd").onclick = function(){
  var id = $("sp_model").value;
  if(!id){ $("sp_err").textContent = "Выберите модель в списке"; return; }
  if(spModels.indexOf(id) !== -1){ $("sp_err").textContent = "Эта модель уже добавлена"; return; }
  $("sp_err").textContent = "";
  spModels.push(id); renderSpModels();
};
$("spModelList").addEventListener("click", function(e){
  var b = e.target.closest(".js-spmdel"); if(!b) return;
  spModels = spModels.filter(function(x){ return x !== b.dataset.m; });
  renderSpModels();
});
$("spNoModel").onchange = function(){
  var on = this.checked;
  $("sp_model").disabled = $("btnSpModelAdd").disabled = on;
  if(on){ $("sp_model").value = ""; spModels = []; renderSpModels(); }
};
$("btnSpCancel").onclick = function(){ $("dlgSup").close(); };
$("btnSpDel").onclick = function(){
  var l = lots().find(function(x){ return x.key===spKey; });
  var m = l ? supplyById(l.supplyId) : null; if(!m) return;
  if(delSupply(m)) $("dlgSup").close();
};
$("btnSpSave").onclick = function(){
  var l = lots().find(function(x){ return x.key===spKey; });
  var m = l ? supplyById(l.supplyId) : null;
  if(!m){ $("dlgSup").close(); return; }
  var err = function(t){ $("sp_err").textContent = t; };
  var nm = $("sp_name").value.trim();
  if(!nm){ err("Введите название материала"); $("sp_name").focus(); return; }
  if(cfg.supplies.some(function(x){ return x.id !== m.id && x.name.toLowerCase() === nm.toLowerCase(); })){
    err("Материал «" + nm + "» уже есть — выберите другое название"); return;
  }
  var costTxt = $("sp_cost").value.trim(), cost = numVal(costTxt);
  if(costTxt && cost === null){ err("Стоимость — число, например 1200 или 1 200,50"); return; }
  if(cost !== null && cost < 0){ err("Стоимость не может быть меньше нуля"); return; }
  var sku = $("sp_sku").value.trim();
  m.name = nm;
  m.unit = $("sp_unit").value || m.unit;
  m.note = $("sp_note").value.trim();
  m.models = $("spNoModel").checked ? [] : spModels.slice();
  m.model = m.models[0] || "";
  /* связка поменялась — переписываем все её строки, чтобы остаток остался одним */
  var newKey = lotKey(m.id, sku, cost), moved = 0;
  if(newKey !== spKey && !$("sp_sku").disabled){
    [cfg.receipts, cfg.issues, cfg.writeoffs || []].forEach(function(list){
      list.forEach(function(x){
        if(lotKey(x.supplyId, x.sku, x.cost) !== spKey) return;
        x.sku = sku; x.cost = cost; moved++;
      });
    });
  }
  $("dlgSup").close();
  saveCfg();
  toast("Сохранено: " + m.name + (moved ? " · номенклатура и цена переписаны в " + moved + " строк" : ""));
};

function renderReceipts(){
  if(!$("supDate").value) $("supDate").value = today();
  var q = $("qRec").value.trim().toLowerCase();
  var list = cfg.receipts.slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
  var shown = list.filter(function(x){
    if(!q) return true;
    var m = supplyById(x.supplyId) || {};
    return [fmtDate(x.date), m.name, x.sku, String(x.cost||""), String(x.qty||0), x.note]
      .join(" ").toLowerCase().indexOf(q)!==-1;
  });
  $("receiptsBody").innerHTML = shown.map(function(x, i){
    var m = supplyById(x.supplyId) || {};
    return '<tr data-r="'+esc(x.id)+'"><td class="num">'+(i+1)+'</td>'+
      '<td class="mono" title="'+esc(fmtDate(x.date)||"—")+'">'+esc(fmtDate(x.date)||"—")+'</td>'+
      cellText(m.name||"—") +
      '<td class="mono">'+esc(x.sku||"—")+'</td>'+
      '<td class="mono">'+esc(x.cost==null ? "—" : money(x.cost))+'</td>'+
      '<td>'+(x.qty||0)+'</td>'+
      '<td class="mono">'+esc(money(lineSum(x.cost, x.qty||0)) || "—")+'</td>'+
      '<td class="hide-md" title="'+esc(x.note||"")+'">'+esc(x.note||"")+'</td>'+
      acts(['<button class="ic btn-danger js-delrec" title="Удалить приход">✕</button>'])+'</tr>';
  }).join("");
  var re = $("receiptsEmpty"); re.hidden = shown.length>0;
  re.textContent = list.length ? "Ничего не найдено." : "Поступлений пока не было.";
}
$("qRec").oninput = renderReceipts;
$("receiptsBody").addEventListener("click", function(e){
  if(!e.target.classList.contains("js-delrec")) return;
  var x = cfg.receipts.find(function(y){ return y.id===e.target.closest("tr").dataset.r; }); if(!x) return;
  var m = supplyById(x.supplyId) || {};
  if(!confirm("Удалить приход «"+(m.name||"")+"» × "+(x.qty||0)+" от "+(fmtDate(x.date)||"—")+"?"+
    "\nОстаток уменьшится на это количество.")) return;
  cfg.receipts = cfg.receipts.filter(function(y){ return y.id!==x.id; });
  recalcSupply(m); saveCfg();
});

/* Окно выдачи. Материал приходит из строки «Таблицы факт», но его можно
   сменить: в списке всё, что реально есть на складе, иначе уйдём в минус.
   Выбирается не материал вообще, а связка: у одного названия может быть
   несколько номенклатур и цен, и списывать надо из конкретной. */
function fillIssueForm(key){
  var keepU = $("isUser").value;
  var avail = lots().filter(function(l){ return lotLeft(l) > 0; })
    .sort(function(a,b){ return lotLabel(a).toLowerCase()<lotLabel(b).toLowerCase()?-1:1; });
  $("isSup").innerHTML = avail.map(function(l){
    var m = supplyById(l.supplyId) || {};
    return '<option value="'+esc(l.key)+'">'+esc(lotLabel(l))+' — остаток '+lotLeft(l)+
           ' '+esc(m.unit||"шт")+'</option>'; }).join("");
  if(key && avail.some(function(l){ return l.key===key; })) $("isSup").value = key;
  /* материал уже выбран строкой таблицы — в окне показываем его и остаток */
  var pl = avail.find(function(l){ return l.key===$("isSup").value; });
  var pm = pl ? (supplyById(pl.supplyId) || {}) : {};
  $("isTitle").textContent = pl ? "Выдать: " + (pm.name||"—") + (pl.sku ? " · " + pl.sku : "") : "Выдать / установить";
  $("isLeft").value = pl ? lotLeft(pl) + " " + (pm.unit||"шт") +
    (pl.cost===null ? "" : " · по " + money(pl.cost)) : "—";
  $("btnIssue").disabled = !pl || !can("supply.issue");
  $("isUser").innerHTML = cfg.users.length
    ? '<option value="">— выберите сотрудника —</option>' + cfg.users.slice().sort(function(a,b){
        return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; }).map(function(u){
        return '<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>'; }).join("")
    : '<option value="">— сотрудники не заведены —</option>';
  if(keepU && byId("users", keepU)) $("isUser").value = keepU;
  /* Оборудование — всё, кроме списанного, по разделам; подпись как в «Прикрепить к». */
  var keepI = $("isItem").value, groups = {}, shownItems = 0;
  assetItems().filter(function(x){ return x.status !== ST_OFF; }).forEach(function(x){
    var k = rid(x); (groups[k] = groups[k] || []).push(x); shownItems++; });
  $("isItem").innerHTML = (shownItems
      ? '<option value="">— выберите оборудование —</option>'
      : '<option value="">— оборудование не заведено —</option>') +
    cfg.registries.filter(function(r){ return groups[r.id]; }).map(function(r){
      return '<optgroup label="'+esc(r.name)+'">' + groups[r.id]
        .sort(function(a,b){ return (a.inv||"").localeCompare(b.inv||""); })
        .map(function(x){
          var who = ownerName(x.owner);
          return '<option value="'+esc(x.id)+'">'+esc((x.inv||"—") + " · " + (typeName(x.type)||"") +
                 (who ? " · " + who : "") + (x.status && x.status!==ST_USE ? " · " + x.status : ""))+'</option>';
        }).join("") + '</optgroup>';
    }).join("");
  if(keepI && $("isItem").querySelector('option[value="'+keepI+'"]')) $("isItem").value = keepI;
  fillIssueSpecs();
  syncIssueTarget();
}
function openIssue(key){
  if(!can("supply.issue")){ toast("Нет прав на выдачу материалов"); return; }
  var l = lots().find(function(x){ return x.key===key; });
  if(l && lotLeft(l) <= 0){ toast("«"+lotLabel(l)+"» закончился — сначала оприходуйте приход"); return; }
  fillIssueForm(key);
  $("isQty").value = "1"; $("isNote").value = "";
  $("isDate").value = today();
  $("isErr").textContent = "";
  $("dlgIssue").showModal();
}
$("btnIssueCancel").onclick = function(){ $("dlgIssue").close(); };

/* История выдач — нижняя таблица «Таблицы факт», поиск общий с остатками */
function renderIssued(){
  var q = $("qStock").value.trim().toLowerCase();
  var list = cfg.issues.slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
  var shown = list.filter(function(x){
    if(!q) return true;
    var t = issueTarget(x), m = supplyById(x.supplyId) || {};
    return [fmtDate(x.date), m.name, String(x.qty||1), t.name, t.div, t.dep, x.note]
      .join(" ").toLowerCase().indexOf(q)!==-1;
  });
  $("issuedBody").innerHTML = shown.map(function(x, i){
    var t = issueTarget(x), m = supplyById(x.supplyId) || {};
    return '<tr data-i="'+esc(x.id)+'"><td class="num">'+(i+1)+'</td>'+
      '<td class="mono" title="'+esc(fmtDate(x.date))+'">'+esc(fmtDate(x.date))+'</td>'+
      cellText(m.name||"—") + '<td>'+(x.qty||1)+'</td>' +
      '<td title="'+esc(t.name||"—")+'">'+
        (t.kind==="item" ? '<span class="chip" title="установлено в оборудование">⚙</span> ' : '')+
        (t.item ? '<a href="#" class="js-isitem" data-id="'+esc(t.item.id)+'">'+esc(t.name)+'</a>' : esc(t.name||"—"))+'</td>'+
      cellText(t.div||"—") +
      '<td class="hide-md" title="'+esc(t.dep||"—")+'">'+esc(t.dep||"—")+'</td>'+
      cellText(x.note||"") +
      acts(['<button class="ic btn-danger js-deli" title="Отменить списание">✕</button>'])+'</tr>';
  }).join("");
  var ie = $("issuedEmpty"); ie.hidden = shown.length>0;
  ie.textContent = list.length ? "Ничего не найдено." : "Выдач пока не было.";
}
/* Какую характеристику займёт материал: список берём у выбранной техники,
   и только те, где разрешено несколько значений. */
function fillIssueSpecs(){
  var it = items.find(function(x){ return x.id === $("isItem").value; });
  var list = multiSpecsOf(it), keep = $("isSpec").value;
  $("isSpec").innerHTML = '<option value="">— не занимает —</option>' + list.map(function(sp){
    var n = freeSlot(it, sp.id);
    return '<option value="'+esc(sp.id)+'">'+esc(slotLabel(sp, n || 1))+'</option>';
  }).join("");
  if(keep && list.some(function(sp){ return sp.id === keep; })) $("isSpec").value = keep;
  $("isSpecWrap").hidden = !list.length || $("isTo").value !== "item";
}
$("isItem").addEventListener("change", fillIssueSpecs);

/* Характеристики того оборудования, к которому прикрепляют. Значение возьмём
   из самой детали: одноимённая характеристика, иначе модель, иначе тип. */
function partValue(child, spName){
  if(!child) return "";
  var byName = specValueByName(child, spName);
  return byName || modelName(child.model) || typeName(child.type) || child.inv || "";
}
function fillParentSpecs(){
  if(!$("f_pspec")) return;
  var parent = items.find(function(x){ return x.id === $("f_parent").value; });
  var show = $("f_holder").value === "item" && !!parent;
  var list = show ? multiSpecsOf(parent) : [];
  var keep = $("f_pspec").value;
  $("f_pspec").innerHTML = '<option value="">— не занимает —</option>' + list.map(function(sp){
    var n = freeSlot(parent, sp.id);
    return '<option value="'+esc(sp.id)+'">'+esc(slotLabel(sp, n || 1))+'</option>';
  }).join("");
  if(keep && list.some(function(sp){ return sp.id === keep; })) $("f_pspec").value = keep;
  $("wrapPSpec").hidden = !list.length;
}
$("f_parent").addEventListener("change", fillParentSpecs);

function syncIssueTarget(){
  var toItem = $("isTo").value === "item";
  $("isUserWrap").hidden = toItem;
  $("isItemWrap").hidden = !toItem;
  if($("isSpecWrap")) $("isSpecWrap").hidden = !toItem || !$("isSpec").options.length ||
    $("isSpec").options.length < 2;
  $("btnIssue").textContent = toItem ? "Установить в оборудование" : "Списать на сотрудника";
}
$("isTo").onchange = syncIssueTarget;
$("btnIssue").onclick = function(){
  var key = $("isSup").value;
  var l = lots().find(function(x){ return x.key===key; });
  var m = l ? supplyById(l.supplyId) : null, toItem = $("isTo").value === "item";
  var u = toItem ? null : byId("users", $("isUser").value);
  var it = toItem ? items.find(function(x){ return x.id===$("isItem").value; }) : null;
  var err = function(t){ $("isErr").textContent = t; };
  if(!l || !m){ err("Выберите материал"); return; }
  if(!toItem && !u){ err("Выберите сотрудника"); return; }
  if(toItem && !it){ err("Выберите оборудование"); return; }
  var d = $("isDate").value || today();
  var qty = parseInt($("isQty").value,10);
  if(!(qty > 0) || String(qty) !== $("isQty").value.trim()){ err("Количество — целое число больше нуля"); return; }
  var left = lotLeft(l);
  if(left <= 0){ err("«"+lotLabel(l)+"» закончился — сначала оприходуйте приход"); return; }
  if(qty > left){ err("На складе только "+left+" "+(m.unit||"шт")+" — списать больше нельзя"); return; }
  var isId = uid("is");
  cfg.issues.push({id:isId, supplyId:l.supplyId, sku:l.sku, cost:l.cost,
                   userId:u ? u.id : "", itemId:it ? it.id : "",
                   qty:qty, date:d, note:$("isNote").value.trim()});
  /* материал занял характеристику — вписываем его в свободную строку и
     помечаем, что строка появилась от установленной запчасти */
  var slotMsg = "";
  if(toItem && it && $("isSpec").value){
    var label = fillSlot(it, $("isSpec").value, m.name, "issue:" + isId);
    if(label){
      addHistory(it, "Установлено: " + label + " — " + m.name);
      saveItems([it]);
      slotMsg = ", " + label;
    }
  }
  $("isNote").value=""; $("isQty").value="1";
  $("dlgIssue").close();
  saveCfg(); toast("Выдано: "+lotLabel(l)+" × "+qty+slotMsg+" → "+(u ? u.name : "инв. "+(it.inv||"—")));
};
$("issuedBody").addEventListener("click", function(e){
  if(e.target.classList.contains("js-isitem")){
    e.preventDefault(); openItemById(e.target.dataset.id); return;
  }
  if(!e.target.classList.contains("js-deli")) return;
  var x = cfg.issues.find(function(y){ return y.id===e.target.closest("tr").dataset.i; }); if(!x) return;
  var m = supplyById(x.supplyId) || {}, t = issueTarget(x);
  if(!confirm("Отменить списание «"+(m.name||"")+"» на "+(t.name||"")+" от "+fmtDate(x.date)+"?")) return;
  cfg.issues = cfg.issues.filter(function(y){ return y.id!==x.id; }); saveCfg();
});
/* Форма прихода открывается кнопкой: на экране обычно смотрят остатки,
   а не заводят новое, и постоянная форма только занимает место. */
function formToggle(btnId, cardId, label){
  var b = $(btnId);
  if(!b) return;
  b.onclick = function(){
    var card = $(cardId);
    card.hidden = !card.hidden;
    b.textContent = card.hidden ? label : "Свернуть";
    if(!card.hidden){
      var first = card.querySelector("input,select");
      if(first) first.focus();
    }
  };
}
formToggle("btnShowSup", "supAddCard", "+ Приход материала");

/* Таблица склада: документальное списание по актам.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== таблица склада: документальное списание ================== */
/* Отдельный учёт: приход общий с фактом, а списания свои. Поэтому здесь
   считается lotDocLeft (пришло минус списано по документам), а не остаток
   после выдач «Таблицы факт». */
function renderWh(){
  var q = $("qWh2").value.trim().toLowerCase();

  /* сверху — свои остатки: пришло минус списано по документам */
  var stock = lots().sort(function(a,b){
    var an = (supplyById(a.supplyId)||{}).name || "", bn = (supplyById(b.supplyId)||{}).name || "";
    if(an.toLowerCase() !== bn.toLowerCase()) return an.toLowerCase()<bn.toLowerCase()?-1:1;
    if(a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
    return (a.cost||0) - (b.cost||0);
  }).filter(function(l){
    /* списали всё — строка уходит из остатков: в документальном учёте держать
       нули незачем, приход по ней всё равно виден в «Истории поступлений» */
    if(lotDocLeft(l) <= 0) return false;
    if(!q) return true;
    var m = supplyById(l.supplyId) || {};
    return [m.name, l.sku, String(l.cost||""), m.note].join(" ").toLowerCase().indexOf(q)!==-1;
  });
  $("whStockBody").innerHTML = stock.map(function(l, i){
    var m = supplyById(l.supplyId) || {}, left = lotDocLeft(l);
    var cls = left<=0 ? "b-danger" : left<=2 ? "b-warn" : "b-ok";
    return '<tr><td class="num">'+(i+1)+'</td>'+
      cellText(m.name||"—")+
      '<td class="mono">'+esc(l.sku||"—")+'</td>'+
      '<td class="mono">'+esc(l.cost===null ? "—" : money(l.cost))+'</td>'+
      cellText(m.unit||"шт")+
      '<td>'+l.got+'</td><td>'+l.off+'</td>'+
      '<td><span class="badge '+cls+'">'+left+'</span></td>'+
      '<td class="mono">'+esc(money(lineSum(l.cost, left)) || "—")+'</td>'+
      '<td class="hide-md" title="'+esc(m.note||"")+'">'+esc(m.note||"")+'</td></tr>';
  }).join("");
  var se = $("whStockEmpty"); se.hidden = stock.length>0;
  se.textContent = lots().some(function(l){ return lotDocLeft(l) > 0; })
    ? "Ничего не найдено." : "На складе по документам ничего не числится.";

  /* внизу — списания, собранные по актам: строка на акт, подробности по нажатию */
  var all = writeoffActs();
  var shown = all.filter(function(a){
    if(!q) return true;
    return a.search.indexOf(q) !== -1;
  });
  $("whBody").innerHTML = shown.map(function(a, i){
    return '<tr class="pick" data-a="'+esc(a.id)+'"><td class="num">'+(i+1)+'</td>'+
      '<td class="mono">'+esc(a.act || "—")+'</td>'+
      '<td class="mono">'+esc(fmtDate(a.date)||"—")+'</td>'+
      '<td>'+a.kinds+'</td>'+
      '<td>'+a.qty+'</td>'+
      '<td class="mono">'+esc(money(a.sum) || "—")+'</td>'+
      '<td class="hide-md" title="'+esc(a.note||"")+'">'+esc(a.note||"")+'</td>'+
      acts(canSup()
        ? ['<button class="ic btn-danger js-delact" title="Отменить акт">✕</button>'] : [])+'</tr>';
  }).join("");
  var we = $("whEmpty"); we.hidden = shown.length>0;
  we.textContent = all.length ? "Ничего не найдено." : "Списаний по документам пока не было.";

  $("btnWhOff").disabled = !canSup() ||
    !lots().some(function(l){ return lotDocLeft(l) > 0; });
}
$("qWh2").oninput = renderWh;

/* Списания собираются в акты: один акт — один поход на склад, в нём несколько
   материалов и мест. Ключ группировки — actId, а не номер: номер человек может
   повторить или потом исправить. */
function writeoffActs(){
  var by = {}, order = [];
  (cfg.writeoffs||[]).forEach(function(x){
    var id = x.actId || ("one-" + x.id);
    if(!by[id]){
      by[id] = {id:id, act:x.act||"", date:x.date||"", note:x.note||"", who:x.who||"",
                rows:[], qty:0, sum:0, kinds:0, search:""};
      order.push(id);
    }
    var a = by[id];
    a.rows.push(x);
    a.qty += (x.qty||0);
    a.sum += (lineSum(x.cost, x.qty||0) || 0);
    if(!a.act && x.act) a.act = x.act;
    if(!a.note && x.note) a.note = x.note;
  });
  return order.map(function(id){
    var a = by[id], seen = {};
    a.rows.forEach(function(x){ seen[x.supplyId + "|" + (x.sku||"")] = true; });
    a.kinds = Object.keys(seen).length;
    a.search = [a.act, fmtDate(a.date), a.note].concat(a.rows.map(function(x){
      var m = supplyById(x.supplyId) || {};
      return [m.name, x.sku, nameById("divisions", x.divisionId),
              nameById("departments", x.departmentId), whCode(x.warehouseId)].join(" ");
    })).join(" ").toLowerCase();
    return a;
  }).sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
}

var woCardId = "";
function openWoCard(id){
  var a = writeoffActs().find(function(x){ return x.id===id; }); if(!a) return;
  woCardId = id;
  $("woCardTitle").textContent = "Акт списания" + (a.act ? " № " + a.act : "");
  $("woCardHead").innerHTML =
    '<div><span>Дата</span><b>'+esc(fmtDate(a.date)||"—")+'</b></div>'+
    '<div><span>Материалов</span><b>'+a.kinds+'</b></div>'+
    '<div><span>Всего количество</span><b>'+a.qty+'</b></div>'+
    '<div><span>Сумма</span><b>'+esc(money(a.sum)||"—")+'</b></div>'+
    '<div><span>Кто списал</span><b>'+esc(a.who||"—")+'</b></div>'+
    '<div><span>Примечание</span><b>'+esc(a.note||"—")+'</b></div>';
  $("woCardBody").innerHTML = a.rows.map(function(x, i){
    var m = supplyById(x.supplyId) || {};
    return '<tr><td class="num">'+(i+1)+'</td>'+
      cellText(m.name||"—")+
      '<td class="mono">'+esc(x.sku||"—")+'</td>'+
      '<td class="mono">'+esc(x.cost==null ? "—" : money(x.cost))+'</td>'+
      cellText(nameById("divisions", x.divisionId) || "—")+
      cellText(nameById("departments", x.departmentId) || "—")+
      '<td class="mono">'+esc(whCode(x.warehouseId) || "—")+'</td>'+
      '<td>'+(x.qty||0)+'</td>'+
      '<td class="mono">'+esc(money(lineSum(x.cost, x.qty||0)) || "—")+'</td></tr>';
  }).join("");
  hide("btnWoCardDel", canSup());
  $("dlgWoCard").showModal();
}
$("btnWoCardClose").onclick = function(){ $("dlgWoCard").close(); };
/* Акт в Word. Шапку, четырёх подписантов и подписи внизу держит шаблон на
   сервере — он же подставляет номер, дату и список материалов. Забираем
   готовый файл: имя берём из ответа, чтобы оно совпадало с номером акта. */
$("btnWoCardDoc").onclick = function(){
  if(!woCardId) return;
  /* шаблонов может быть несколько — тогда спрашиваем, по какому оформлять */
  if(!acttpls.length){ grabAct(this, ""); return; }
  var self = this;
  $("ap_tpl").innerHTML = acttpls.map(function(t){
    return '<option value="'+esc(t.id)+'">'+esc(t.name||"—")+
           (t.note ? " — " + esc(t.note) : "")+'</option>';
  }).join("") + '<option value="">Встроенный образец</option>';
  $("dlgActPick").showModal();
  $("btnActPickOk").onclick = function(){
    var tpl = $("ap_tpl").value;
    $("dlgActPick").close();
    grabAct(self, tpl);
  };
};
$("btnActPickCancel").onclick = function(){ $("dlgActPick").close(); };
function grabAct(b, tpl){
  b.disabled = true;
  fetch("/api/writeoffs/" + encodeURIComponent(woCardId) + "/act" +
        (tpl ? "?tpl=" + encodeURIComponent(tpl) : ""))
    .then(function(r){
      if(!r.ok) return r.json().then(function(d){
        throw new Error(d.message || "Акт не сформировался"); });
      var cd = r.headers.get("Content-Disposition") || "";
      var m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      var name = m ? decodeURIComponent(m[1]) : "акт.docx";
      return r.blob().then(function(bl){ saveBlob(bl, name); toast("Акт сохранён"); });
    })
    .catch(function(e){ toast(e.message || "Акт не сформировался"); })
    .then(function(){ b.disabled = false; });
}
$("btnWoCardDel").onclick = function(){
  var a = writeoffActs().find(function(x){ return x.id===woCardId; }); if(!a) return;
  if(!confirm("Отменить акт" + (a.act ? " № " + a.act : "") + " от " + (fmtDate(a.date)||"—") +
              "?\nВ нём строк: " + a.rows.length + " — удалятся все.")) return;
  var ids = {};
  a.rows.forEach(function(x){ ids[x.id] = true; });
  cfg.writeoffs = cfg.writeoffs.filter(function(x){ return !ids[x.id]; });
  $("dlgWoCard").close();
  saveCfg();
};
$("whBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var id = tr.dataset.a;
  if(e.target.classList.contains("js-delact")){
    var a = writeoffActs().find(function(x){ return x.id===id; }); if(!a) return;
    if(!confirm("Отменить акт" + (a.act ? " № " + a.act : "") + " от " + (fmtDate(a.date)||"—") +
                "?\nВ нём строк: " + a.rows.length + " — удалятся все.")) return;
    var ids = {};
    a.rows.forEach(function(x){ ids[x.id] = true; });
    cfg.writeoffs = cfg.writeoffs.filter(function(x){ return !ids[x.id]; });
    saveCfg();
    return;
  }
  openWoCard(id);
});

/* Окно списания. Списание — это один акт на несколько материалов: сверху
   выбирается связка (материал -> его номенклатуры -> цены) и добавляется в
   список, а по нажатию на строку открывается второе окно, где материал
   разносится по местам: подразделение, отдел, склад, количество. Мест может
   быть несколько, поэтому количество не одно число, а сумма по местам. */
var woList = [];      /* [{key, supplyId, sku, cost, dest:[{divisionId, departmentId, warehouseId, qty}]}] */
var woDestIdx = -1;   /* какая строка сейчас открыта во втором окне */
var woDestDraft = [];

function woFillSupplies(){
  var sup = woSupplies(), keep = $("wo_sup").value;
  $("wo_sup").innerHTML = sup.map(function(m){
    return '<option value="'+esc(m.id)+'">'+esc(m.name)+'</option>'; }).join("");
  if(keep && sup.some(function(m){ return m.id===keep; })) $("wo_sup").value = keep;
  woFillSku();
}
function woSupplies(){
  var seen = {}, out = [];
  lots().forEach(function(l){
    if(lotDocLeft(l) <= 0 || seen[l.supplyId]) return;
    seen[l.supplyId] = true;
    out.push(supplyById(l.supplyId) || {id:l.supplyId, name:"\u2014"});
  });
  return out.sort(function(a,b){ return (a.name||"").toLowerCase()<(b.name||"").toLowerCase()?-1:1; });
}
function woLots(){
  var sid = $("wo_sup").value;
  return lots().filter(function(l){ return l.supplyId===sid && lotDocLeft(l) > 0; });
}
function woFillSku(){
  var seen = {}, opts = [];
  woLots().forEach(function(l){
    if(seen[l.sku]) return; seen[l.sku] = true;
    opts.push('<option value="'+esc(l.sku)+'">'+esc(l.sku || "\u2014 без номенклатуры \u2014")+'</option>');
  });
  $("wo_sku").innerHTML = opts.join("");
  woFillCost();
}
function woFillCost(){
  var sku = $("wo_sku").value;
  $("wo_cost").innerHTML = woLots().filter(function(l){ return l.sku === sku; }).map(function(l){
    return '<option value="'+esc(l.key)+'">'+
           esc(l.cost===null ? "\u2014 без цены \u2014" : money(l.cost))+
           ' · числится '+lotDocLeft(l)+'</option>';
  }).join("");
}
function woPicked(){
  var key = $("wo_cost").value;
  return lots().find(function(l){ return l.key===key; }) || null;
}
/* сколько этой связки уже разнесено по местам */
function woTaken(row){
  return (row.dest || []).reduce(function(a,d){ return a + (parseInt(d.qty,10)||0); }, 0);
}
function woLeftFor(row){
  var l = lots().find(function(x){ return x.key===row.key; });
  return l ? lotDocLeft(l) : 0;
}
function renderWoList(){
  $("woBody").innerHTML = woList.map(function(row, i){
    var m = supplyById(row.supplyId) || {}, left = woLeftFor(row), take = woTaken(row);
    var cls = take === 0 ? "b-warn" : take > left ? "b-danger" : "b-ok";
    return '<tr class="pick" data-w="'+i+'">'+
      '<td class="num">'+(i+1)+'</td>'+
      cellText(m.name||"\u2014")+
      '<td class="mono">'+esc(row.sku||"\u2014")+'</td>'+
      '<td class="mono">'+esc(row.cost===null ? "\u2014" : money(row.cost))+'</td>'+
      '<td>'+left+'</td>'+
      '<td><span class="badge '+cls+'">'+take+'</span></td>'+
      '<td class="mono">'+esc(money(lineSum(row.cost, take)) || "\u2014")+'</td>'+
      '<td class="act"><button class="ic btn-danger js-wodel" title="Убрать из списка">✕</button></td></tr>';
  }).join("");
  $("woEmpty").hidden = woList.length > 0;
}
$("wo_sup").onchange = woFillSku;
$("wo_sku").onchange = woFillCost;
$("btnWoAdd").onclick = function(){
  var l = woPicked();
  if(!l){ $("wo_err").textContent = "Выберите материал"; return; }
  if(woList.some(function(r){ return r.key === l.key; })){
    $("wo_err").textContent = "Этот материал уже в списке — нажмите на строку, чтобы добавить ещё место";
    return;
  }
  $("wo_err").textContent = "";
  woList.push({key:l.key, supplyId:l.supplyId, sku:l.sku, cost:l.cost, dest:[]});
  renderWoList();
};
$("woBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var i = parseInt(tr.dataset.w, 10);
  if(e.target.classList.contains("js-wodel")){
    woList.splice(i, 1); renderWoList(); return;
  }
  openWoDest(i);
});

/* ---- второе окно: места ---- */
/* Модель задаётся материалу при приходе. Есть модели — списываем туда, где
   стоит такая техника: подразделение, отдел и склад берутся у самой техники
   (у прикреплённой — у того, к чему она прикреплена). Моделей нет — null,
   списки полные. */
function woScope(row){
  var mids = supplyModelsOf(supplyById(row.supplyId));
  if(!mids.length) return null;
  var out = [];
  assetItems().forEach(function(x){
    if(x.status === ST_OFF || mids.indexOf(x.model) === -1) return;
    var h = holderOf(x), src = h.kind === "item" && h.root ? h.root : x;
    out.push({div: src.division || "", dep: src.department || "",
              wh: x.warehouse || src.warehouse || ""});
  });
  return out;
}
function woNone(sc){
  return '<option value="">\u2014 ' + (sc && !sc.length ? "техники этих моделей нет" : "не указано") +
         ' \u2014</option>';
}
function woDivOptions(sel, sc){
  return woNone(sc) + cfg.divisions.filter(function(d){
    return !sc || sc.some(function(x){ return x.div === d.id; });
  }).sort(function(a,b){
    return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; }).map(function(d){
    return '<option value="'+esc(d.id)+'"'+(d.id===sel?' selected':'')+'>'+esc(d.name)+'</option>';
  }).join("");
}
/* отделы сужаются по подразделению: связь для того и заводили в справочнике.
   Отделы без подразделения показываем всегда — их ещё не разметили. */
function woDepOptions(divId, sel, sc){
  var list = cfg.departments.filter(function(d){
    if(sc) return sc.some(function(x){ return x.dep === d.id && (!divId || x.div === divId); });
    return !divId || !d.divisionId || d.divisionId === divId;
  }).sort(function(a,b){ return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; });
  return woNone(sc) + list.map(function(d){
    return '<option value="'+esc(d.id)+'"'+(d.id===sel?' selected':'')+'>'+esc(d.name)+'</option>';
  }).join("");
}
function woWhOptions(sel, sc, divId, depId){
  return woNone(sc) + cfg.warehouses.filter(function(w){
    return !sc || sc.some(function(x){
      return x.wh === w.id && (!divId || x.div === divId) && (!depId || x.dep === depId); });
  }).sort(function(a,b){
    return (a.code||"").localeCompare(b.code||""); }).map(function(w){
    return '<option value="'+esc(w.id)+'"'+(w.id===sel?' selected':'')+'>'+
           esc((w.code ? w.code + " · " : "") + (w.name||""))+'</option>';
  }).join("");
}
function woSum(){
  var sum = 0;
  document.querySelectorAll("#woDestBody .js-wqty").forEach(function(el){
    var n = parseInt(el.value, 10);
    if(isFinite(n) && n > 0) sum += n; });
  return sum;
}
function woDestFoot(sum){
  var left = woDestIdx >= 0 ? woLeftFor(woList[woDestIdx] || {}) : 0;
  $("woDestTotal").textContent = "по местам: " + sum + " из " + left;
  var bad = woDestProblem(readWoDest());
  $("woDest_err").textContent = sum > left
    ? ("Числится только " + left + " — разнесено больше") : bad;
}
function renderWoDest(){
  var sc = woDestIdx >= 0 && woList[woDestIdx] ? woScope(woList[woDestIdx]) : null;
  $("woDestBody").innerHTML = woDestDraft.map(function(d, i){
    return '<tr data-d="'+i+'">'+
      '<td class="num">'+(i+1)+'</td>'+
      '<td><select class="js-wdiv">'+woDivOptions(d.divisionId||"", sc)+'</select></td>'+
      '<td><select class="js-wdep">'+woDepOptions(d.divisionId||"", d.departmentId||"", sc)+'</select></td>'+
      '<td><select class="js-wwh">'+woWhOptions(d.warehouseId||"", sc, d.divisionId||"", d.departmentId||"")+'</select></td>'+
      '<td><input class="js-wqty" type="number" min="1" step="1" inputmode="numeric" '+
        'value="'+esc(d.qty === 0 || d.qty ? d.qty : "")+'"></td>'+
      '<td class="act"><button class="ic btn-danger js-wdestdel" title="Убрать место">✕</button></td></tr>';
  }).join("");
  $("woDestEmpty").hidden = woDestDraft.length > 0;
  woDestFoot(woSum());
}
function readWoDest(){
  var out = [];
  document.querySelectorAll("#woDestBody tr").forEach(function(tr){
    /* количество берём как есть: если молча подставить единицу, человек
       не заметит, что строку не заполнил, и спишет не то */
    out.push({divisionId: tr.querySelector(".js-wdiv").value,
              departmentId: tr.querySelector(".js-wdep").value,
              warehouseId: tr.querySelector(".js-wwh").value,
              qty: tr.querySelector(".js-wqty").value.trim()});
  });
  return out;
}
/* Что не так со строкой места: номер строки и сообщение, или пусто. */
function woDestProblem(dest){
  for(var i = 0; i < dest.length; i++){
    var v = dest[i].qty;
    if(v === "" || v === null || v === undefined)
      return "Строка " + (i + 1) + ": не указано количество";
    var n = Number(v);
    if(!isFinite(n) || Math.floor(n) !== n)
      return "Строка " + (i + 1) + ": количество — целое число";
    if(n <= 0)
      return "Строка " + (i + 1) + ": количество должно быть больше нуля";
  }
  return "";
}
function openWoDest(i){
  woDestIdx = i;
  var row = woList[i]; if(!row) return;
  var m = supplyById(row.supplyId) || {};
  $("woDestTitle").textContent = "Куда списать: " + (m.name || "\u2014");
  var mm = supplyModelsOf(m).map(modelName).filter(Boolean).join(", ");
  $("woDestSub").textContent = (row.sku ? "номенклатура " + row.sku + " · " : "") +
    (row.cost === null ? "цена не указана" : "стоимость " + money(row.cost)) +
    " · числится " + woLeftFor(row) + " " + (m.unit || "шт") +
    (mm ? " · модели: " + mm + " — места, где стоит такая техника" : " · без модели — все места");
  woDestDraft = (row.dest || []).map(function(d){ return {divisionId:d.divisionId,
    departmentId:d.departmentId, warehouseId:d.warehouseId, qty:d.qty}; });
  if(!woDestDraft.length) woDestDraft = [{divisionId:"", departmentId:"", warehouseId:"", qty:1}];
  renderWoDest();
  $("dlgWoDest").showModal();
}
$("btnWoDestAdd").onclick = function(){
  woDestDraft = readWoDest();
  woDestDraft.push({divisionId:"", departmentId:"", warehouseId:"", qty:""});
  renderWoDest();
};
$("woDestBody").addEventListener("click", function(e){
  if(!e.target.classList.contains("js-wdestdel")) return;
  var i = parseInt(e.target.closest("tr").dataset.d, 10);
  woDestDraft = readWoDest();
  woDestDraft.splice(i, 1);
  renderWoDest();
});
$("woDestBody").addEventListener("change", function(e){
  if(e.target.classList.contains("js-wqty")) return;
  var isDiv = e.target.classList.contains("js-wdiv");
  var i = parseInt(e.target.closest("tr").dataset.d, 10);
  woDestDraft = readWoDest();
  /* сменили подразделение — прежний отдел мог к нему не относиться */
  if(isDiv) woDestDraft[i].departmentId = "";
  renderWoDest();
});
$("woDestBody").addEventListener("input", function(e){
  if(!e.target.classList.contains("js-wqty")) return;
  /* минус не даём набрать вовсе: знак убираем прямо при вводе */
  var v = e.target.value;
  if(v.indexOf("-") !== -1){ e.target.value = v.replace(/-/g, ""); }
  woDestFoot(woSum());
});
$("btnWoDestCancel").onclick = function(){ $("dlgWoDest").close(); };
$("btnWoDestOk").onclick = function(){
  var row = woList[woDestIdx]; if(!row){ $("dlgWoDest").close(); return; }
  var dest = readWoDest();
  var bad = woDestProblem(dest);
  if(bad){ $("woDest_err").textContent = bad; return; }
  dest = dest.map(function(d){
    return {divisionId:d.divisionId, departmentId:d.departmentId,
            warehouseId:d.warehouseId, qty: parseInt(d.qty, 10)};
  });
  var sum = dest.reduce(function(a,d){ return a + d.qty; }, 0);
  var left = woLeftFor(row);
  if(sum > left){
    $("woDest_err").textContent = "Числится только " + left + " — уменьшите количество";
    return;
  }
  row.dest = dest;
  $("dlgWoDest").close();
  renderWoList();
};

/* ---- открытие и сохранение акта ---- */
$("btnWhOff").onclick = function(){
  if(!woSupplies().length){ toast("Списывать нечего — на складе пусто"); return; }
  woFillSupplies();
  woList = []; woDestIdx = -1;
  renderWoList();
  $("wo_err").textContent = "";
  $("wo_act").value = "";
  $("wo_note").value = "";
  $("wo_date").value = today();
  $("dlgWhOff").showModal();
};
$("btnWoCancel").onclick = function(){ $("dlgWhOff").close(); };
$("btnWoSave").onclick = function(){
  if(!woList.length){ $("wo_err").textContent = "Добавьте хотя бы один материал"; return; }
  var bad = null;
  woList.forEach(function(row){
    var m = supplyById(row.supplyId) || {}, take = woTaken(row), left = woLeftFor(row);
    var why = woDestProblem(row.dest || []);
    if(why) bad = bad || ("У «" + (m.name||"\u2014") + "» " + why.toLowerCase());
    else if(!take) bad = bad || ("У «" + (m.name||"\u2014") + "» не указано ни одного места");
    else if(take > left) bad = bad || ("По «" + (m.name||"\u2014") + "» числится только " + left);
  });
  if(bad){ $("wo_err").textContent = bad; return; }
  var act = $("wo_act").value.trim();
  if(!act){ $("wo_err").textContent = "Укажите номер акта"; return; }
  var d = $("wo_date").value || today(), note = $("wo_note").value.trim();
  var actId = uid("act"), n = 0;
  woList.forEach(function(row){
    row.dest.forEach(function(dst){
      /* одна строка на материал в одно место: так видно, куда что ушло.
         actId один на весь акт — по нему строки и собираются в списке */
      cfg.writeoffs.push({id:uid("wo"), actId:actId, act:act,
                          supplyId:row.supplyId, sku:row.sku, cost:row.cost,
                          qty:dst.qty, divisionId:dst.divisionId, departmentId:dst.departmentId,
                          warehouseId:dst.warehouseId, date:d, note:note,
                          who:(me && me.name) || ""});
      n++;
    });
  });
  saveCfg();
  $("dlgWhOff").close();
  toast("Акт № " + act + ": материалов " + woList.length + ", строк " + n);
};

function renderSup(){ renderStock(); renderReceipts(); renderIssued(); renderWh(); }

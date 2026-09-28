/* Раздел учёта: настройки раздела и его дашборд.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== настройки раздела ================== */
var editingReg = null, regStatusDraft = [];
var SPECIAL_ST = [ST_USE, ST_STOCK, ST_REPAIR, ST_READY, ST_TOOFF, ST_OFF];

function renderRegStatuses(){
  if(!regStatusDraft.length){
    $("rg_stList").innerHTML = '<div class="note">Статусы не заданы — добавьте хотя бы один.</div>';
    return;
  }
  $("rg_stList").innerHTML = regStatusDraft.map(function(d, i){
    var sp = SPECIAL_ST.indexOf(d.cur) !== -1;
    return '<div class="stat-row" data-i="'+i+'">'+
      '<span class="num" style="width:16px;text-align:center">'+(i+1)+'</span>'+
      '<span class="nm">'+esc(d.cur)+(sp?' <span class="chip">особый</span>':'')+
        (d.old && d.old!==d.cur ? ' <span class="chip">было: '+esc(d.old)+'</span>' : '')+'</span>'+
      '<button class="ic js-up" title="Выше"'+(i===0?' disabled':'')+'>↑</button>'+
      '<button class="ic js-down" title="Ниже"'+(i===regStatusDraft.length-1?' disabled':'')+'>↓</button>'+
      (sp?'':'<button class="ic js-ren" title="Переименовать">✎</button>')+
      '<button class="ic btn-danger js-delst" title="Убрать">✕</button></div>';
  }).join("");
}
$("rg_stList").addEventListener("click", function(e){
  var row = e.target.closest(".stat-row"); if(!row) return;
  var i = parseInt(row.dataset.i, 10);
  if(e.target.classList.contains("js-up") && i>0){
    var t = regStatusDraft[i-1]; regStatusDraft[i-1] = regStatusDraft[i]; regStatusDraft[i] = t;
  }
  else if(e.target.classList.contains("js-down") && i<regStatusDraft.length-1){
    var t2 = regStatusDraft[i+1]; regStatusDraft[i+1] = regStatusDraft[i]; regStatusDraft[i] = t2;
  }
  else if(e.target.classList.contains("js-ren")){
    var nm = prompt("Название статуса:", regStatusDraft[i].cur);
    if(nm===null || !nm.trim()) return;
    nm = nm.trim();
    if(regStatusDraft.some(function(d, k){ return k!==i && d.cur.toLowerCase()===nm.toLowerCase(); })){
      toast("Такой статус уже есть"); return; }
    if(SPECIAL_ST.indexOf(nm)!==-1){ toast("Это имя зарезервировано за особым статусом"); return; }
    regStatusDraft[i].cur = nm;
  }
  else if(e.target.classList.contains("js-delst")){
    regStatusDraft.splice(i, 1);
  }
  else return;
  renderRegStatuses();
});
$("btnAddRegStatus").onclick = function(){
  var nm = $("rg_stNew").value.trim();
  if(!nm){ toast("Введите название статуса"); return; }
  if(regStatusDraft.some(function(d){ return d.cur.toLowerCase()===nm.toLowerCase(); })){
    toast("Такой статус уже есть"); return; }
  regStatusDraft.push({old:null, cur:nm});
  $("rg_stNew").value = ""; renderRegStatuses();
};
$("rg_stNew").addEventListener("keydown", function(e){ if(e.key==="Enter") $("btnAddRegStatus").click(); });

function currentKind(){ return document.querySelector('input[name="rgkind"]:checked').value; }
function syncRegKind(){
  var k = currentKind();
  $("rg_parts").hidden = k!=="assets";
  $("rg_stSec").hidden = k!=="assets";
  $("rg_kindHint").textContent = k==="assets"
    ? "Категории → типы → записи с характеристиками, статусами, историей и выгрузкой в CSV."
    : "Две вкладки: приход материалов с остатками и списание на сотрудников. Категорий и характеристик нет.";
}
document.querySelectorAll('input[name="rgkind"]').forEach(function(el){ el.onchange = syncRegKind; });

function openRegDlg(r){
  if(!isAdmin()){ toast("Настройка разделов доступна только администратору"); return; }
  editingReg = r ? r.id : null;
  var isNew = !r, locked = !!(r && r.builtin);
  $("dlgRegTitle").textContent = r ? ("Настройки раздела: "+r.name) : "Новый раздел учёта";
  $("rg_name").value = r ? r.name : "";
  $("rg_icon").value = r ? (r.icon||"▣") : "▣";
  /* название и значок правит администратор у любого раздела, и у заводского тоже */
  $("rg_name").disabled = false; $("rg_icon").disabled = false;
  $("rg_lock").hidden = !locked;
  var kind = r ? (r.kind||"assets") : "assets";
  document.querySelectorAll('input[name="rgkind"]').forEach(function(el){
    el.checked = (el.value===kind);
    el.disabled = !isNew;                       /* тип раздела задаётся только при создании */
  });
  var L = r ? regLayout(r.id) : DEF_LAYOUT;
  $("rg_subs").checked = L.subs; $("rg_specs").checked = L.specs;
  $("rg_presets").checked = L.presets; $("rg_dash").checked = L.dash;
  regStatusDraft = ((r && r.statuses && r.statuses.length) ? r.statuses : DEF_STATUSES)
    .map(function(st){ return {old:(r?st:null), cur:st}; });
  $("rg_stNew").value = "";
  syncRegKind(); renderRegStatuses();
  $("btnRegDel").hidden = isNew || locked;
  $("dlgReg").showModal();
  if(!locked) setTimeout(function(){ $("rg_name").focus(); }, 30);
}
$("btnRegCancel").onclick = function(){ $("dlgReg").close(); };
$("btnAddReg").onclick = function(){ openRegDlg(null); };

/* переименование и удаление статусов переносится на уже заведённые записи */
function applyStatusChanges(r, draft){
  var fresh = draft.map(function(d){ return d.cur; });
  var renames = draft.filter(function(d){ return d.old && d.old!==d.cur; });
  var gone = (r.statuses||[]).filter(function(st){
    return !draft.some(function(d){ return d.old===st; }); });
  var touched = [], fallback = fresh[0] || "";
  regItems(r.id).forEach(function(it){
    var hit = renames.find(function(d){ return d.old===it.status; });
    if(hit){ it.status = hit.cur; touched.push(it); return; }
    if(gone.indexOf(it.status)!==-1){ it.status = fallback; touched.push(it); }
  });
  /* обязательность характеристик тоже завязана на тексты статусов */
  cfg.specs.forEach(function(sp){
    if(!sp.reqStatuses || !sp.reqStatuses.length) return;
    if(regOfSpec(sp) !== r.id) return;
    sp.reqStatuses = sp.reqStatuses.map(function(st){
      var hit2 = renames.find(function(d){ return d.old===st; });
      return hit2 ? hit2.cur : st;
    }).filter(function(st){ return fresh.indexOf(st)!==-1; });
  });
  r.statuses = fresh;
  return touched;
}

$("btnRegSave").onclick = function(){
  var r = editingReg ? cfg.registries.find(function(x){ return x.id===editingReg; }) : null;
  var kind = currentKind(), nm = $("rg_name").value.trim();
  if(!nm){ toast("Введите название раздела"); return; }
  if(cfg.registries.some(function(x){ return x.name.toLowerCase()===nm.toLowerCase() && x.id!==editingReg; })){
    toast("Раздел с таким названием уже есть"); return; }
  if(kind==="assets" && !regStatusDraft.length){ toast("Добавьте хотя бы один статус"); return; }
  var layout = {subs:$("rg_subs").checked, specs:$("rg_specs").checked,
                presets:$("rg_presets").checked, dash:$("rg_dash").checked};
  if(!r){
    r = {id:uid("r"), name:nm, icon:$("rg_icon").value.trim()||"▣", kind:kind, builtin:false,
         layout:layout, statuses: kind==="assets" ? regStatusDraft.map(function(d){ return d.cur; })
                                                 : DEF_STATUSES.slice()};
    cfg.registries.push(r);
    saveCfg(); $("dlgReg").close();
    openReg(r.id, "categories");
    toast("Раздел создан");
    return;
  }
  r.name = nm; r.icon = $("rg_icon").value.trim()||"▣";
  r.layout = layout;
  var touched = [];
  if((r.kind||"assets")==="assets"){
    var gone = (r.statuses||[]).filter(function(st){
      return !regStatusDraft.some(function(d){ return d.old===st; }); });
    var hitCount = gone.length ? regItems(r.id).filter(function(it){ return gone.indexOf(it.status)!==-1; }).length : 0;
    if(hitCount && !confirm("Убираются статусы: "+gone.join(", ")+"."+
      "\nЗаписей с ними: "+hitCount+" — они получат статус «"+(regStatusDraft[0].cur)+"».\nПродолжить?")) return;
    touched = applyStatusChanges(r, regStatusDraft);
  }
  saveCfg();
  if(touched.length) saveItems(touched);
  $("dlgReg").close();
  toast("Настройки сохранены");
};

function deleteRegistry(r){
  if(!isAdmin()){ toast("Удаление разделов доступно только администратору"); return; }
  if(r.builtin){ toast("Это заводской раздел — удалить его нельзя"); return; }
  if(cfg.registries.length<=1){ toast("Это последний раздел — удалить нельзя"); return; }
  var doomed = regItems(r.id), cCnt = regCats(r.id).length, tCnt = regTypes(r.id).length;
  if(!confirm("Удалить раздел «"+r.name+"»?"+
    "\nБудет удалено: записей "+doomed.length+", категорий "+cCnt+", типов "+tCnt+"."+
    "\nДействие необратимо.")) return;
  var subIds = regSubs(r.id).map(function(x){ return x.id; });
  var typeIds = regTypes(r.id).map(function(x){ return x.id; });
  cfg.specs = cfg.specs.filter(function(sp){
    return subIds.indexOf(sp.subcategoryId)===-1 && typeIds.indexOf(sp.typeId)===-1; });
  cfg.types = cfg.types.filter(function(x){ return rid(x)!==r.id; });
  cfg.subcategories = cfg.subcategories.filter(function(x){ return rid(x)!==r.id; });
  cfg.categories = cfg.categories.filter(function(x){ return rid(x)!==r.id; });
  cfg.ipPools.forEach(function(x){ if(x.registryId===r.id){ x.registryId=""; x.categoryId=""; } });
  cfg.registries = cfg.registries.filter(function(x){ return x.id!==r.id; });
  if(curReg===r.id){ curReg = cfg.registries[0].id; resetRegState(); }
  saveCfg(); deleteItems(doomed, "Удалён раздел «" + r.name + "»");
  toast("Раздел удалён");
}
$("btnRegDel").onclick = function(){
  var r = cfg.registries.find(function(x){ return x.id===editingReg; }); if(!r) return;
  $("dlgReg").close();
  deleteRegistry(r);
};

/* ================== дашборд раздела ================== */
function renderRegDash(){
  var list = regItems(), total = list.length;
  var html = tile("Всего позиций", total);
  statusesOf().forEach(function(st){
    html += tile(st, list.filter(function(i){ return i.status===st; }).length);
  });
  $("regStats").innerHTML = html;
  var cats = regCats().map(function(c){
    var ids = typesOf(c.id).map(function(t){ return t.id; });
    return {name:c.name, cnt:list.filter(function(i){ return ids.indexOf(i.type)!==-1; }).length};
  }).sort(function(a,b){ return b.cnt-a.cnt; });
  $("regByCat").innerHTML = cats.map(function(c){ return barRow(c.name, c.cnt, total); }).join("");
  $("regByCatEmpty").hidden = cats.length>0;
  var divs = cfg.divisions.map(function(d){
    return {name:d.name, cnt:list.filter(function(i){ return i.division===d.id; }).length};
  }).sort(function(a,b){ return b.cnt-a.cnt; });
  $("regByDiv").innerHTML = divs.map(function(d){ return barRow(d.name, d.cnt, total); }).join("");
  $("regByDivEmpty").hidden = divs.length>0;
}

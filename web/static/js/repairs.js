/* Ремонты.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== ремонты ================== */
var REP_STATES = [["", "Все ремонты"], ["open", "Сейчас в ремонте"], ["closed", "Завершённые"]];
function repairRows(src){
  var st = $("fRepState").value, mid = $("fRepMaster").value, rg = $("fRepReg").value;
  var q = $("qRep").value.trim().toLowerCase();
  return (src || (scopeWide() ? scopePick(cross.repairs) : cfg.repairs)).filter(function(r){
    if(st==="open" && r.to) return false;
    if(st==="closed" && !r.to) return false;
    if(mid && r.masterId!==mid) return false;
    if(rg && !scopeWide() && r.registryId!==rg) return false;
    if(!q) return true;
    return [r.inv, r.typeName, repairMasterName(r), r.note, r.doneNote, r.result,
            r.orgName || "", (reg(r.registryId)||{}).name, fmtDate(r.from), fmtDate(r.to)]
      .join(" ").toLowerCase().indexOf(q) !== -1;
  }).sort(function(a,b){
    if(!a.to !== !b.to) return a.to ? 1 : -1;        /* незакрытые сверху */
    return (b.from||"").localeCompare(a.from||"");
  });
}
var openRepairId = null;
function openRepairDlg(id){
  var r = cfg.repairs.find(function(x){ return x.id===id; }); if(!r) return;
  openRepairId = r.id;
  $("rpTitle").textContent = "Ремонт: " + (r.inv || r.typeName || "запись") +
    (r.to ? "" : " · сейчас в ремонте");
  $("rp_reg").textContent    = (reg(r.registryId)||{}).name || "—";
  $("rp_inv").textContent    = r.inv || "—";
  $("rp_type").textContent   = r.typeName || "—";
  $("rp_master").textContent = repairMasterName(r);
  $("rp_from").textContent   = fmtDate(r.from) || "—";
  $("rp_to").textContent     = r.to ? fmtDate(r.to) : "ещё в ремонте";
  $("rp_days").textContent   = String(daysBetween(r.from, r.to));
  $("rp_result").textContent = r.result || (r.to ? "—" : "в работе");
  $("rp_note").textContent   = r.note || "— причина не записана —";
  $("rp_done").textContent   = r.doneNote || (r.to ? "— не записано —" : "— ремонт ещё идёт —");
  $("btnRpItem").hidden = !r.itemId || !items.some(function(x){ return x.id===r.itemId; });
  $("dlgRepair").showModal();
}
$("btnRpClose").onclick = function(){ $("dlgRepair").close(); };
$("btnRpItem").onclick = function(){
  var r = cfg.repairs.find(function(x){ return x.id===openRepairId; });
  $("dlgRepair").close();
  if(r && r.itemId) openItemById(r.itemId);
};

function renderRepairs(){
  var keepS = $("fRepState").value, keepM = $("fRepMaster").value, keepR = $("fRepReg").value;
  $("fRepState").innerHTML = REP_STATES.map(function(x){
    return '<option value="'+x[0]+'">'+esc(x[1])+'</option>'; }).join("");
  $("fRepState").value = keepS;
  var mids = [];
  (scopeWide() ? cross.repairs : cfg.repairs).forEach(function(r){
    if(r.masterId && mids.indexOf(r.masterId)===-1) mids.push(r.masterId); });
  $("fRepMaster").innerHTML = '<option value="">Все мастера</option>' + mids.map(function(id){
    return '<option value="'+esc(id)+'">'+esc(staffName(id)||"—")+'</option>'; }).join("");
  $("fRepMaster").value = keepM;
  $("fRepReg").innerHTML = '<option value="">Все разделы</option>' +
    cfg.registries.filter(function(r){ return r.kind!=="supplies"; }).map(function(r){
      return '<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>'; }).join("");
  $("fRepReg").value = keepR;

  var all = scopeWide() ? scopePick(cross.repairs) : cfg.repairs;
  var opened = all.filter(function(r){ return !r.to; });
  var closed = all.filter(function(r){ return r.to; });
  var offed = closed.filter(function(r){ return r.result===ST_OFF; });
  var days = closed.reduce(function(a,r){ return a + (daysBetween(r.from, r.to)||0); }, 0);
  $("repStats").innerHTML =
    tile("Сейчас в ремонте", opened.length) +
    tile("Завершено", closed.length) +
    tile("Списано после ремонта", offed.length) +
    tile("В среднем дней", closed.length ? Math.round(days/closed.length) : 0) +
    tile("Всего ремонтов", all.length);

  $("repColOrg").textContent = scopeWide() ? "Учреждение" : "Раздел";
  var list = repairRows(all);
  $("repairsBody").innerHTML = list.map(function(r, i){
    var open = !r.to;
    return '<tr class="pick" data-rp="'+esc(r.id)+'"><td class="num">'+(i+1)+'</td>'+
      cellText(scopeWide() ? (r.orgName||"") : ((reg(r.registryId)||{}).name||"")) +
      '<td class="mono" title="'+esc(r.inv||"")+'">'+esc(r.inv||"")+'</td>'+
      '<td class="hide-md" title="'+esc(r.typeName||"")+'">'+esc(r.typeName||"")+'</td>'+
      cellText(repairMasterName(r)) +
      '<td class="mono" title="'+esc(fmtDate(r.from)||"—")+'">'+esc(fmtDate(r.from)||"—")+'</td>'+
      cellText(r.note||"") +
      '<td class="mono" title="'+(open?"ещё в ремонте":esc(fmtDate(r.to)))+'">'+
        (open?'<span class="badge b-warn">в ремонте</span>':esc(fmtDate(r.to)))+'</td>'+
      cellText(r.doneNote||"") +
      '<td>'+daysBetween(r.from, r.to)+'</td>'+
      cellText(r.result||"") + '</tr>';
  }).join("");
  var e = $("repairsEmpty"); e.hidden = list.length>0;
  e.textContent = all.length ? "Ничего не найдено по фильтрам." : "Ремонтов пока не было.";
  $("repCount").textContent = !all.length ? ""
    : (list.length===all.length ? "Всего ремонтов: "+all.length
                                : "Показано: "+list.length+" из "+all.length);
  var act = (keepS?1:0) + (keepM?1:0) + (keepR?1:0);
  ["fRepState","fRepMaster","fRepReg"].forEach(function(id){ $(id).classList.toggle("act", !!$(id).value); });
  $("btnRepReset").hidden = !act;
  $("btnRepReset").textContent = act>1 ? ("Сбросить · "+act) : "Сбросить";
}
["qRep","fRepState","fRepMaster","fRepReg"].forEach(function(id){
  $(id).oninput = renderRepairs; $(id).onchange = renderRepairs;
});
$("btnRepReset").onclick = function(){
  $("fRepState").value=""; $("fRepMaster").value=""; $("fRepReg").value=""; $("qRep").value="";
  renderRepairs();
};
$("repairsBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-rp]"); if(!tr) return;
  openRepairDlg(tr.dataset.rp);
});
function exportRepairs(){
  var list = repairRows();
  if(!list.length){ toast("Выгружать нечего"); return; }
  var head = ["Раздел","Инв. номер","Тип","Мастер","Поступил","Причина",
              "Вернули","Что сделали","Дней","Итог"];
  var rows = list.map(function(r){
    return [(reg(r.registryId)||{}).name||"", r.inv||"", r.typeName||"", repairMasterName(r),
            fmtDate(r.from)||"", r.note||"", r.to ? fmtDate(r.to) : "в ремонте",
            r.doneNote||"", daysBetween(r.from, r.to), r.result||""];
  });
  saveTable({sheet:"Ремонты", head:head, rows:rows, textCols:[1]},
            "ремонты-" + new Date().toISOString().slice(0,10));
}

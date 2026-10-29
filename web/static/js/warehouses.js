/* Склады.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== склады ==================
   Номер приходит из накладной; если такого ещё нет, склад заводится сам,
   а название потом правится здесь. */
function renderWhs(){
  if(!$("whsBody")) return;
  var q = $("qWh").value.trim().toLowerCase();
  var list = (cfg.warehouses || []).filter(function(w){
    return !q || ((w.code||"") + " " + (w.name||"") + " " + (w.note||""))
      .toLowerCase().indexOf(q) !== -1;
  });
  $("whsBody").innerHTML = list.map(function(w, i){
    var used = items.filter(function(x){ return x.warehouse === w.id; }).length;
    return '<tr data-w="'+esc(w.id)+'"'+(canDict("warehouses") ? ' class="pick"' : '')+'><td class="num">'+(i+1)+'</td>'+
      '<td class="mono">'+esc(w.code||"—")+'</td>'+
      cellText(w.name||"—") + cellText(w.note||"") +
      '<td>'+used+'</td>'+
      acts(canDict("warehouses")
        ? ['<button class="ic js-whedit" title="Изменить">✎</button>',
           '<button class="ic btn-danger js-whdel"'+
             (used ? ' disabled title="На складе числится техника"' : ' title="Удалить"')+
             '>✕</button>']
        : [])+'</tr>';
  }).join("");
  $("whsEmpty").hidden = list.length > 0;
}
$("qWh").oninput = renderWhs;

var editingWh = null;
function openWh(w){
  editingWh = w ? w.id : null;
  $("dlgWhTitle").textContent = w ? ("Склад " + (w.code || "")) : "Новый склад";
  $("w_code").value = w ? (w.code||"") : "";
  $("w_name").value = w ? (w.name||"") : "";
  $("w_note").value = w ? (w.note||"") : "";
  $("w_org").innerHTML = orgs.map(function(o){
    return '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>'; }).join("");
  $("w_org").value = (w && w.orgId) || orgId;
  $("w_org").disabled = !isAdmin();
  $("w_err").textContent = "";
  $("btnWhDel").hidden = !w;
  $("dlgWh").showModal();
  setTimeout(function(){ $("w_code").focus(); }, 30);
}
$("btnAddWh").onclick = function(){ openWh(null); };
$("whsBody").addEventListener("click", function(e){
  /* на просмотре склад не открывается: окно — это форма правки */
  if(!canDict("warehouses")) return;
  var tr = e.target.closest("tr[data-w]"); if(!tr) return;
  var w = (cfg.warehouses || []).find(function(x){ return x.id === tr.dataset.w; });
  if(!w) return;
  if(e.target.closest(".js-whdel")){
    if(!confirm("Удалить склад «" + (w.code || w.name) + "»?")) return;
    cfg.warehouses = cfg.warehouses.filter(function(x){ return x.id !== w.id; });
    saveCfg(); toast("Удалено"); return;
  }
  openWh(w);
});
$("btnWhCancel").onclick = function(){ $("dlgWh").close(); };
$("btnWhSave").onclick = function(){
  var code = $("w_code").value.trim(), nm = $("w_name").value.trim();
  if(!code && !nm){ $("w_err").textContent = "Нужен хотя бы номер или название"; return; }
  var dup = (cfg.warehouses || []).find(function(x){
    return x.id !== editingWh && code && (x.code||"").trim() === code; });
  if(dup){ $("w_err").textContent = "Склад с номером " + code + " уже есть"; return; }
  var rec = editingWh ? cfg.warehouses.find(function(x){ return x.id === editingWh; })
                      : {id: uid("w")};
  rec.code = code; rec.name = nm; rec.note = $("w_note").value.trim();
  if(isAdmin()) rec.orgId = $("w_org").value || orgId;
  if(!editingWh) cfg.warehouses.push(rec);
  var moved = rec.orgId && rec.orgId !== orgId;
  saveCfg().then(function(){ if(moved) return loadState(); });
  $("dlgWh").close(); toast(moved ? "Склад передан другому учреждению" : "Сохранено");
};
$("btnWhDel").onclick = function(){
  if(!editingWh) return;
  cfg.warehouses = cfg.warehouses.filter(function(x){ return x.id !== editingWh; });
  saveCfg(); $("dlgWh").close(); toast("Удалено");
};

/* История удалений.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== история удалений ==================
   Данные приходят с сервера и здесь только показываются: ни добавить,
   ни убрать строку из интерфейса нельзя — в этом весь смысл журнала. */
function delSource(){ return scopeWide() ? scopePick(cross.deletions) : dels; }
function delRows(){
  var q = $("qDel").value.trim().toLowerCase();
  var fw = $("fDelWho").value, fr = $("fDelReg").value;
  return delSource().filter(function(x){
    if(fw && x.who !== fw) return false;
    if(fr && x.registryId !== fr) return false;
    if(!q) return true;
    return [x.inv, x.typeName, x.catName, x.subName, x.who, x.reason,
            x.ownerName, x.divName, x.depName, x.status, x.regName]
      .join(" ").toLowerCase().indexOf(q) !== -1;
  });
}
function renderDels(){
  if(!$("delsBody")) return;
  var keepW = $("fDelWho").value, keepR = $("fDelReg").value;
  var whos = [], regs = [];
  delSource().forEach(function(x){
    if(x.who && whos.indexOf(x.who) === -1) whos.push(x.who);
    if(x.registryId && !regs.some(function(r){ return r.id === x.registryId; }))
      regs.push({id:x.registryId, name:x.regName || x.registryId});
  });
  whos.sort(function(a,b){ return a.localeCompare(b, "ru"); });
  $("fDelWho").innerHTML = '<option value="">Все сотрудники</option>' + whos.map(function(w){
    return '<option value="'+esc(w)+'">'+esc(w)+'</option>'; }).join("");
  $("fDelWho").value = keepW;
  $("fDelReg").innerHTML = '<option value="">Все разделы</option>' + regs.map(function(r){
    return '<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>'; }).join("");
  $("fDelReg").value = keepR;

  var month = new Date(); month.setDate(month.getDate() - 30);
  var all = delSource();
  var last30 = all.filter(function(x){ return x.at && new Date(x.at) >= month; });
  $("delStats").innerHTML =
    tile("Всего удалений", all.length) +
    tile("За 30 дней", last30.length) +
    tile("Сотрудников удаляло", whos.length);

  $("delColOrg").textContent = scopeWide() ? "Учреждение" : "Раздел";
  var list = delRows();
  $("delsBody").innerHTML = list.map(function(x, i){
    return '<tr class="pick" data-dl="'+esc(x.id)+'"><td class="num">'+(i+1)+'</td>'+
      '<td class="mono" title="'+esc(fmtWhen(x.at))+'">'+esc(fmtWhen(x.at))+'</td>'+
      cellText(x.who || "—") +
      cellText((scopeWide() ? x.orgName : x.regName) || "—") +
      '<td class="mono" title="'+esc(x.inv||"—")+'">'+esc(x.inv||"—")+'</td>'+
      '<td class="hide-md" title="'+esc(x.typeName||"")+'">'+esc(x.typeName||"")+'</td>'+
      cellText(x.status || "") +
      '<td class="hide-md" title="'+esc(x.ownerName||"")+'">'+esc(x.ownerName||"")+'</td>'+
      cellText(x.reason || "") +
      acts(can("deletions.manage")
        ? ['<button class="ic btn-danger js-dldel" title="Убрать запись из журнала">✕</button>']
        : [])+'</tr>';
  }).join("");
  var e = $("delsEmpty"); e.hidden = list.length > 0;
  e.textContent = all.length ? "Ничего не найдено по фильтрам." : "Удалений пока не было.";
  $("delCount").textContent = !all.length ? ""
    : (list.length === all.length ? "Всего удалений: " + all.length
                                  : "Показано: " + list.length + " из " + all.length);
  var act = (keepW?1:0) + (keepR?1:0);
  ["fDelWho","fDelReg"].forEach(function(id){ $(id).classList.toggle("act", !!$(id).value); });
  $("btnDelReset").hidden = !act;
  $("btnDelReset").textContent = act > 1 ? ("Сбросить · " + act) : "Сбросить";
}
["qDel","fDelWho","fDelReg"].forEach(function(id){
  $(id).oninput = renderDels; $(id).onchange = renderDels;
});
$("btnDelReset").onclick = function(){
  $("fDelWho").value = ""; $("fDelReg").value = ""; $("qDel").value = ""; renderDels();
};
$("delsBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-dl]"); if(!tr) return;
  if(e.target.closest(".js-dldel")){
    var x = delSource().find(function(d){ return d.id === tr.dataset.dl; });
    if(!confirm("Убрать запись из журнала удалений" + (x && x.inv ? " (инв. " + x.inv + ")" : "") + "?\n\nСледа от этого не останется.")) return;
    api("/api/deletions/delete", {id:tr.dataset.dl})
      .then(function(){ toast("Запись убрана"); return loadDeletions(); })
      .catch(apiError);
    return;
  }
  openDelInfo(tr.dataset.dl);
});
function openDelInfo(id){
  var x = delSource().find(function(d){ return d.id === id; }); if(!x) return;
  $("diTitle").textContent = "Удалённая запись" + (x.inv ? ": инв. " + x.inv : "");
  $("di_who").textContent = x.who || "—";
  $("di_at").textContent  = fmtWhen(x.at) || "—";
  $("di_reg").textContent = x.regName || "—";
  $("di_inv").textContent = x.inv || "—";
  $("di_reason").textContent = x.reason || "—";
  $("di_cat").textContent    = x.catName || "—";
  $("di_sub").textContent    = x.subName || "—";
  $("di_type").textContent   = x.typeName || "—";
  $("di_status").textContent = x.status || "—";
  $("di_owner").textContent  = x.ownerName || "—";
  $("di_div").textContent    = x.divName || "—";
  $("di_dep").textContent    = x.depName || "—";
  $("di_notes").textContent  = x.notes || "—";
  $("di_specs").innerHTML = (x.specs || []).length
    ? x.specs.map(function(sp){
        return '<div><span>'+esc(sp.name)+'</span><b>'+esc(sp.value)+'</b></div>'; }).join("")
    : '<div><span>Характеристики</span><b>не заполнялись</b></div>';
  var h = x.history || [];
  $("di_hist").innerHTML = h.length
    ? h.slice().reverse().map(function(ev){
        return "<li>"+esc(histWhen(ev))+(ev.who ? ", <b>"+esc(ev.who)+"</b>" : "")+" — "+esc(ev.t)+"</li>";
      }).join("")
    : "<li>История пуста</li>";
  $("dlgDelInfo").showModal();
}
$("btnDiClose").onclick = function(){ $("dlgDelInfo").close(); };

function exportDels(){
  var list = delRows();
  if(!list.length){ toast("Выгружать нечего"); return; }
  var head = ["Когда","Кто удалил","Раздел","Инв. номер","Категория","Подкатегория","Тип",
              "Статус","Был у сотрудника","Подразделение","Отдел","Примечание","Причина удаления"];
  var rows = list.map(function(x){
    return [fmtWhen(x.at), x.who||"", x.regName||"", x.inv||"", x.catName||"", x.subName||"",
            x.typeName||"", x.status||"", x.ownerName||"", x.divName||"", x.depName||"",
            x.notes||"", x.reason||""];
  });
  saveTable({sheet:"Удаления", head:head, rows:rows, textCols:[3]},
            "удаления-" + new Date().toISOString().slice(0,10));
}

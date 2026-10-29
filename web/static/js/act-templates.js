/* Шаблоны акта на списание.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== шаблоны акта на списание ==================
   Файл с шапкой, должностями и подписями лежит на сервере: у каждого
   учреждения свои подписанты, общего шаблона быть не может. Здесь только
   список — сам файл туда-сюда носит форма. */
var acttpls = [];
function loadActTpls(){
  return api("/api/acttpl").then(function(d){
    acttpls = d.templates || [];
    renderActTpl(); renderNav();
  }).catch(function(){});
}
function renderActTpl(){
  if(!$("actTplBody")) return;
  var q = $("qActTpl").value.trim().toLowerCase();
  var list = acttpls.filter(function(t){
    return !q || ((t.name||"") + " " + (t.note||"")).toLowerCase().indexOf(q) !== -1;
  });
  $("actTplBody").innerHTML = list.map(function(t, i){
    return '<tr data-t="'+esc(t.id)+'"><td class="num">'+(i+1)+'</td>'+
      cellText(t.name||"—") + cellText(t.note||"") +
      '<td class="hide-md"><a href="/api/acttpl/'+encodeURIComponent(t.id)+'/file">'+
        esc(t.origName||"скачать")+'</a></td>'+
      '<td class="hide-md">'+esc(fmtWhen(t.at)||"—")+'</td>'+
      acts(canDict("acttpl")
        ? ['<button class="ic js-atedit" title="Изменить">✎</button>',
           '<button class="ic btn-danger js-atdel" title="Удалить">✕</button>']
        : [])+'</tr>';
  }).join("");
  $("actTplEmpty").hidden = list.length > 0;
}
$("qActTpl").oninput = renderActTpl;
$("btnActTplSample").onclick = function(){
  window.open("/api/acttpl/sample", "_blank");
};

var editingTpl = null;
function openActTpl(t){
  editingTpl = t ? t.id : null;
  $("dlgActTplTitle").textContent = t ? "Шаблон: " + (t.name||"") : "Новый шаблон";
  $("at_name").value = t ? (t.name||"") : "";
  $("at_note").value = t ? (t.note||"") : "";
  $("at_file").value = "";
  $("at_hint").textContent = t
    ? "Файл уже загружен (" + esc(t.origName||"") + "). Выберите новый, только если хотите его заменить."
    : "";
  $("at_err").textContent = "";
  $("btnActTplDel").hidden = !t;
  $("dlgActTpl").showModal();
  setTimeout(function(){ $("at_name").focus(); }, 30);
}
$("btnAddActTpl").onclick = function(){ openActTpl(null); };
$("btnActTplCancel").onclick = function(){ $("dlgActTpl").close(); };
$("actTplBody").addEventListener("click", function(e){
  if(!canDict("acttpl")) return;
  var tr = e.target.closest("tr[data-t]"); if(!tr) return;
  var t = acttpls.find(function(x){ return x.id === tr.dataset.t; });
  if(!t) return;
  if(e.target.closest(".js-atdel")){
    if(!confirm("Удалить шаблон «" + (t.name||"") + "»?")) return;
    api("/api/acttpl/delete", {id: t.id})
      .then(function(){ toast("Удалено"); return loadActTpls(); })
      .catch(function(err){ toast((err && err.message) || "Не получилось"); });
    return;
  }
  if(e.target.closest(".js-atedit")) openActTpl(t);
});
$("btnActTplDel").onclick = function(){
  if(!editingTpl) return;
  var t = acttpls.find(function(x){ return x.id === editingTpl; });
  if(!confirm("Удалить шаблон «" + ((t&&t.name)||"") + "»?")) return;
  api("/api/acttpl/delete", {id: editingTpl})
    .then(function(){ $("dlgActTpl").close(); toast("Удалено"); return loadActTpls(); })
    .catch(function(err){ $("at_err").textContent = (err && err.message) || "Не получилось"; });
};
$("btnActTplSave").onclick = function(){
  var name = $("at_name").value.trim();
  if(!name){ $("at_err").textContent = "Дайте шаблону название"; return; }
  var f = $("at_file").files[0];
  if(!editingTpl && !f){ $("at_err").textContent = "Выберите файл шаблона"; return; }
  var fd = new FormData();
  if(editingTpl) fd.append("id", editingTpl);
  fd.append("name", name);
  fd.append("note", $("at_note").value.trim());
  if(f) fd.append("file", f);
  $("btnActTplSave").disabled = true;
  /* form-data, а не JSON: JSON файлов не носит — как и у накладных */
  fetch("/api/acttpl", {method:"POST", body: fd}).then(function(r){
    return r.json().then(function(d){
      if(!r.ok) throw new Error(d.message || "Не получилось сохранить");
      $("dlgActTpl").close(); toast("Сохранено");
      return loadActTpls();
    });
  }).catch(function(err){
    $("at_err").textContent = err.message || "Не получилось сохранить";
  }).then(function(){ $("btnActTplSave").disabled = false; });
};

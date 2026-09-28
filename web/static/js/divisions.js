/* Подразделения, отделы, места.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== подразделения и отделы ================== */
var SIMPLE = {
  divisions: {field:"division", userField:"divisionId", title:"подразделение"},
  departments:{field:"department", userField:"departmentId", title:"отдел", division:true},
  places:     {field:"place", userField:"", title:"место"}
};
/* список подразделений: и в форме добавления отдела, и в каждой строке таблицы */
function divOptions(sel){
  return '<option value="">— не указано —</option>' +
    cfg.divisions.slice().sort(function(a,b){
      return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; }).map(function(d){
      return '<option value="'+esc(d.id)+'"'+(d.id===sel?' selected':'')+'>'+esc(d.name)+'</option>';
    }).join("");
}
function renderSimple(key){
  var conf = SIMPLE[key];
  if(!$(key+"Body")) return;
  if(conf.division && $("newDepartmentsDiv")){
    var keepNew = $("newDepartmentsDiv").value;
    $("newDepartmentsDiv").innerHTML = divOptions("");
    if(keepNew) $("newDepartmentsDiv").value = keepNew;
  }
  $(key+"Body").innerHTML = cfg[key].map(function(o, i){
    var used = items.filter(function(i){ return i[conf.field]===o.id; }).length;
    var staff = conf.userField ? cfg.users.filter(function(u){ return u[conf.userField]===o.id; }).length : null;
    return '<tr data-id="'+esc(o.id)+'"><td class="num">'+(i+1)+'</td>'+
      cellText(o.name)+
      (conf.division ? '<td><select class="js-depdiv"'+(can("users.manage")?'':' disabled')+'>'+
                       divOptions(o.divisionId||"")+'</select></td>' : '')+
      (staff===null ? '' : '<td>'+staff+'</td>')+'<td>'+used+'</td>'+
      acts(can("users.manage")
        ? ['<button class="ic js-ren" title="Переименовать">✎</button>',
           '<button class="ic btn-danger js-del" title="Удалить">✕</button>']
        : [])+'</tr>';
  }).join("");
  $(key+"Empty").hidden = cfg[key].length > 0;
}
Object.keys(SIMPLE).forEach(function(key){
  var conf = SIMPLE[key], inpId = "new"+key.charAt(0).toUpperCase()+key.slice(1);
  var add = function(){
    var n = $(inpId).value.trim();
    if(!n){ toast("Введите название"); return; }
    if(cfg[key].some(function(o){ return o.name.toLowerCase()===n.toLowerCase(); })){ toast("Уже есть в списке"); return; }
    var rec = {id:uid(key[0]), name:n};
    if(conf.division && $("newDepartmentsDiv")) rec.divisionId = $("newDepartmentsDiv").value || "";
    cfg[key].push(rec); $(inpId).value=""; saveCfg(); toast("Добавлено");
    var card = $("add"+key.charAt(0).toUpperCase()+key.slice(1)); if(card) card.hidden = true;
  };
  document.querySelector('[data-add="'+key+'"]').onclick = add;
  /* форма добавления показывается по кнопке, а не висит постоянно */
  var showBtn = $("btnShow"+key.charAt(0).toUpperCase()+key.slice(1));
  if(showBtn) showBtn.onclick = function(){
    var card = $("add"+key.charAt(0).toUpperCase()+key.slice(1));
    card.hidden = !card.hidden;
    if(!card.hidden) $(inpId).focus();
  };
  $(inpId).addEventListener("keydown", function(e){ if(e.key==="Enter") add(); });
  /* подразделение меняется прямо в строке: отдельного окна ради одного поля не нужно */
  if(conf.division) $(key+"Body").addEventListener("change", function(e){
    if(!e.target.classList.contains("js-depdiv")) return;
    var tr = e.target.closest("tr"); if(!tr) return;
    var o = cfg[key].find(function(x){ return x.id===tr.dataset.id; }); if(!o) return;
    o.divisionId = e.target.value || "";
    saveCfg(); toast(o.name + " → " + (nameById("divisions", o.divisionId) || "без подразделения"));
  });
  $(key+"Body").addEventListener("click", function(e){
    var tr = e.target.closest("tr"); if(!tr) return;
    var o = cfg[key].find(function(x){ return x.id===tr.dataset.id; }); if(!o) return;
    if(e.target.classList.contains("js-ren")){ var n=prompt("Новое название:", o.name); if(!n) return; o.name=n.trim(); saveCfg(); }
    if(e.target.classList.contains("js-del")){
      var used = items.filter(function(i){ return i[conf.field]===o.id; }).length;
      if(!confirm("Удалить "+conf.title+" «"+o.name+"»?"+(used?"\nИспользуется в "+used+" позициях.":""))) return;
      cfg[key] = cfg[key].filter(function(x){ return x.id!==o.id; });
      if(conf.userField) cfg.users.forEach(function(u){ if(u[conf.userField]===o.id) u[conf.userField]=""; });
      saveCfg();
    }
  });
});

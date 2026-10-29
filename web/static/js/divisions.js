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
/* Такой же уже есть? Для отдела — только в том же подразделении: ООТиЗ может
   быть и в ГМЗ-6, и в ГМЗ-7, а два ООТиЗ в одном ГМЗ-6 — уже путаница. */
function simpleDup(key, name, divId, exceptId){
  var n = String(name || "").trim().toLowerCase();
  return cfg[key].find(function(o){
    return o.id !== exceptId && o.name.trim().toLowerCase() === n &&
           (!SIMPLE[key].division || (o.divisionId || "") === (divId || ""));
  });
}
function simpleDupMsg(key, divId){
  return SIMPLE[key].division
    ? "Такой отдел уже есть в " + (nameById("divisions", divId) ? "«" + nameById("divisions", divId) + "»" : "списке без подразделения")
    : "Уже есть в списке";
}
/* Отделы идут группами по подразделениям — одинаковые названия не стоят подряд
   и сразу видно, чей это ООТиЗ. Над списком — поиск и выбор подразделения. */
function depsOrdered(){
  var fd = $("fDepsDiv") ? $("fDepsDiv").value : "", q = $("qDeps") ? $("qDeps").value.trim().toLowerCase() : "";
  var groups = cfg.divisions.slice().sort(byName).map(function(v){
    return {id:v.id, name:v.name, list:cfg.departments.filter(function(d){ return d.divisionId === v.id; })};
  });
  groups.push({id:"-", name:"Без подразделения", list:cfg.departments.filter(function(d){
    return !d.divisionId || !byId("divisions", d.divisionId); })});
  return groups.filter(function(g){ return !fd || g.id === fd; }).map(function(g){
    g.list = g.list.filter(function(d){ return !q || d.name.toLowerCase().indexOf(q) !== -1; }).sort(byName);
    return g;
  }).filter(function(g){ return g.list.length; });
}
function renderSimple(key){
  var conf = SIMPLE[key];
  if(!$(key+"Body")) return;
  if(conf.division && $("newDepartmentsDiv")){
    var keepNew = $("newDepartmentsDiv").value;
    $("newDepartmentsDiv").innerHTML = divOptions("");
    if(keepNew) $("newDepartmentsDiv").value = keepNew;
  }
  if(conf.division && $("fDepsDiv")){
    var keepF = $("fDepsDiv").value;
    $("fDepsDiv").innerHTML = '<option value="">Все подразделения</option>' +
      cfg.divisions.slice().sort(byName).map(function(v){
        return '<option value="'+esc(v.id)+'">'+esc(v.name)+'</option>'; }).join("") +
      '<option value="-">Без подразделения</option>';
    $("fDepsDiv").value = keepF && $("fDepsDiv").querySelector('option[value="'+keepF+'"]') ? keepF : "";
  }
  var rows = cfg[key], heads = null, cols = 3 + (conf.division ? 1 : 0) + (conf.userField ? 1 : 0) + 1;
  if(conf.division){
    rows = []; heads = {};
    depsOrdered().forEach(function(g){ heads[rows.length] = g; rows = rows.concat(g.list); });
  }
  $(key+"Body").innerHTML = rows.map(function(o, i){
    var head = heads && heads[i] ? '<tr class="grp-row"><td colspan="'+cols+'">'+esc(heads[i].name)+
      ' <span class="cnt">'+heads[i].list.length+'</span></td></tr>' : "";
    return head + (function(){
    var used = items.filter(function(i){ return i[conf.field]===o.id; }).length;
    var staff = conf.userField ? cfg.users.filter(function(u){ return u[conf.userField]===o.id; }).length : null;
    return '<tr data-id="'+esc(o.id)+'"><td class="num">'+(i+1)+'</td>'+
      cellText(o.name)+
      (conf.division ? '<td><select class="js-depdiv"'+(canDict(key)?'':' disabled')+'>'+
                       divOptions(o.divisionId||"")+'</select></td>' : '')+
      (staff===null ? '' : '<td>'+staff+'</td>')+'<td>'+used+'</td>'+
      acts(canDict(key)
        ? ['<button class="ic js-ren" title="Переименовать">✎</button>',
           '<button class="ic btn-danger js-del" title="Удалить">✕</button>']
        : [])+'</tr>';
    })();
  }).join("");
  $(key+"Empty").hidden = rows.length > 0;
  if(conf.division) $(key+"Empty").textContent = cfg[key].length ? "Ничего не найдено." : "Отделы пока не заведены.";
}
$("qDeps").oninput = function(){ renderSimple("departments"); };
$("fDepsDiv").onchange = function(){
  /* выбрали подразделение — новый отдел по умолчанию заводится в нём же */
  var v = $("fDepsDiv").value;
  if(v && v !== "-") $("newDepartmentsDiv").value = v;
  renderSimple("departments");
};
Object.keys(SIMPLE).forEach(function(key){
  var conf = SIMPLE[key], inpId = "new"+key.charAt(0).toUpperCase()+key.slice(1);
  var add = function(){
    var n = $(inpId).value.trim();
    if(!n){ toast("Введите название"); return; }
    var dv = conf.division && $("newDepartmentsDiv") ? ($("newDepartmentsDiv").value || "") : "";
    if(simpleDup(key, n, dv)){ toast(simpleDupMsg(key, dv)); return; }
    var rec = {id:uid(key[0]), name:n};
    if(conf.division) rec.divisionId = dv;
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
    if(!e.target.classList.contains("js-depdiv") || !canDict(key)) return;
    var tr = e.target.closest("tr"); if(!tr) return;
    var o = cfg[key].find(function(x){ return x.id===tr.dataset.id; }); if(!o) return;
    if(simpleDup(key, o.name, e.target.value, o.id)){
      toast(simpleDupMsg(key, e.target.value)); e.target.value = o.divisionId || ""; return; }
    o.divisionId = e.target.value || "";
    saveCfg(); toast(o.name + " → " + (nameById("divisions", o.divisionId) || "без подразделения"));
  });
  $(key+"Body").addEventListener("click", function(e){
    if(!canDict(key)) return;
    var tr = e.target.closest("tr"); if(!tr) return;
    var o = cfg[key].find(function(x){ return x.id===tr.dataset.id; }); if(!o) return;
    if(e.target.classList.contains("js-ren")){
      var n = prompt("Новое название:", o.name); if(!n || !n.trim()) return;
      if(simpleDup(key, n, o.divisionId, o.id)){ toast(simpleDupMsg(key, o.divisionId)); return; }
      o.name = n.trim(); saveCfg(); }
    if(e.target.classList.contains("js-del")){
      var used = items.filter(function(i){ return i[conf.field]===o.id; }).length;
      if(!confirm("Удалить "+conf.title+" «"+o.name+"»?"+(used?"\nИспользуется в "+used+" позициях.":""))) return;
      cfg[key] = cfg[key].filter(function(x){ return x.id!==o.id; });
      if(conf.userField) cfg.users.forEach(function(u){ if(u[conf.userField]===o.id) u[conf.userField]=""; });
      saveCfg();
    }
  });
});

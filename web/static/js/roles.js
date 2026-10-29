/* Роли и доступ.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== роли и доступ ==================
   Роль — таблица доступа и несколько галочек. В таблице у каждого раздела
   учёта, у IP-адресов, накладных и справочников свой уровень. Разделы учёта
   видят все, поэтому у них только «просмотр» и «редактирование»; справочник
   можно и закрыть. Строки, не связанные с разделом, — ключи с «@» (areaList
   приходит с сервера, там же уровень по умолчанию). */
var ACCESS = [["none", "нет доступа"], ["view", "просмотр"], ["edit", "редактирование"]];
var editingRole = null;

function staffOfRole(id){ return (cfg.staff||[]).filter(function(x){ return x.role===id; }).length; }
function permTitle(code){
  var p = permList.find(function(x){ return x.code===code; });
  return p ? p.title : code;
}
/* уровень строки «@…» у роли: не задан — по умолчанию строки */
function areaLevel(acc, a){
  var v = (acc || {})[a.key];
  if(["none","view","edit"].indexOf(v) === -1) v = a.def;
  if(a.group === "ledger" && v === "none") v = "view";
  return v;
}
/* кратко, что роль правит и что ей закрыто — для таблицы ролей */
function roleAccessText(r){
  var acc = r.regAccess || {};
  var edit = cfg.registries.filter(function(rg){ return acc[rg.id] === "edit"; })
    .map(function(rg){ return rg.name; })
    .concat(areaList.filter(function(a){ return areaLevel(acc, a) === "edit"; })
      .map(function(a){ return a.title; }));
  var shut = areaList.filter(function(a){ return areaLevel(acc, a) === "none"; })
    .map(function(a){ return a.title; });
  return (edit.length ? "правка: " + edit.join(", ") : "только просмотр") +
         (shut.length ? "; закрыто: " + shut.join(", ") : "");
}
function accessSelect(attr, key, value, withNone){
  return '<td><select '+attr+'="'+esc(key)+'">'+ACCESS.filter(function(a){
      return withNone || a[0] !== "none"; }).map(function(a){
      return '<option value="'+a[0]+'"'+(value===a[0]?' selected':'')+'>'+esc(a[1])+'</option>';
    }).join("")+'</select></td>';
}
function renderRoles(){
  var q = $("qRole").value.trim().toLowerCase();
  var list = (cfg.roles||[]).filter(function(r){
    if(!q) return true;
    return [r.name, r.descr].join(" ").toLowerCase().indexOf(q)!==-1;
  });
  $("rolesBody").innerHTML = list.map(function(r, i){
    var perms = (r.perms||[]);
    var adm = perms.indexOf("admin")!==-1;
    var pText = adm ? "полный доступ"
      : (perms.length ? perms.map(permTitle).join(", ") : "—");
    var rText = adm ? "все разделы и справочники" : roleAccessText(r);
    return '<tr class="pick" data-r="'+esc(r.id)+'"><td class="num">'+(i+1)+'</td>'+
      '<td title="'+esc(r.name)+'">'+esc(r.name)+
        (r.builtin?' <span class="chip">заводская</span>':'')+
        (staffOfRole(r.id)?' <span class="chip">сотрудников: '+staffOfRole(r.id)+'</span>':'')+'</td>'+
      cellText(r.descr||"") + cellText(pText) +
      '<td class="hide-md" title="'+esc(rText)+'">'+esc(rText)+'</td>'+
      acts(!can("staff.manage") ? [] : ['<button class="ic js-redit" title="Изменить">✎</button>'].concat(
        r.builtin ? ['<button class="ic" disabled title="Заводская роль — удалить нельзя">✕</button>']
                  : ['<button class="ic btn-danger js-rdel" title="Удалить роль">✕</button>']))+'</tr>';
  }).join("");
  var e = $("rolesEmpty"); e.hidden = list.length>0;
  e.textContent = (cfg.roles||[]).length ? "Ничего не найдено." : "Роли не заведены.";
}
$("qRole").oninput = renderRoles;

function openRole(r){
  if(!can("staff.manage") && !r){ toast("Роли настраивает тот, кому выдано право"); return; }
  editingRole = r ? r.id : null;
  $("dlgRoleTitle").textContent = r ? ("Роль: "+r.name) : "Новая роль";
  $("rl_name").value = r ? r.name : "";
  $("rl_descr").value = r ? (r.descr||"") : "";
  var perms = r ? (r.perms||[]) : [];
  $("rl_perms").innerHTML = permList.map(function(pp){
    return '<label class="chk" style="display:flex;margin:0 0 6px"><input type="checkbox" data-perm="'+
      esc(pp.code)+'"'+(perms.indexOf(pp.code)!==-1?' checked':'')+'> '+esc(pp.title)+'</label>';
  }).join("");
  var acc = r ? (r.regAccess||{}) : {};
  $("rl_regs").innerHTML = cfg.registries.map(function(rg){
    return '<tr>'+cellText(rg.name)+accessSelect("data-reg", rg.id, acc[rg.id]==="edit" ? "edit" : "view", false)+'</tr>';
  }).concat(areaList.filter(function(a){ return a.group === "ledger"; }).map(function(a){
    return '<tr>'+cellText(a.title)+accessSelect("data-area", a.key, areaLevel(acc, a), false)+'</tr>';
  })).join("");
  $("rl_dicts").innerHTML = areaList.filter(function(a){ return a.group !== "ledger"; }).map(function(a){
    return '<tr>'+cellText(a.title)+accessSelect("data-area", a.key, areaLevel(acc, a), true)+'</tr>';
  }).join("");
  $("btnRoleDel").hidden = !r || r.builtin;
  var mayRoles = can("staff.manage");
  $("dlgRole").querySelectorAll("input,select,textarea").forEach(function(el){ el.disabled = !mayRoles; });
  $("btnRoleSave").hidden = !mayRoles;
  if(!mayRoles) $("btnRoleDel").hidden = true;
  $("dlgRole").showModal();
  setTimeout(function(){ $("rl_name").focus(); }, 30);
}
$("btnAddRole").onclick = function(){ openRole(null); };
$("btnRoleCancel").onclick = function(){ $("dlgRole").close(); };
$("rolesBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-r]"); if(!tr) return;
  var r = (cfg.roles||[]).find(function(x){ return x.id===tr.dataset.r; }); if(!r) return;
  if(e.target.classList.contains("js-rdel") && can("staff.manage")){
    if(staffOfRole(r.id)){ toast("Роль назначена сотрудникам — сначала переведите их на другую"); return; }
    if(!confirm("Удалить роль «"+r.name+"»?")) return;
    api("/api/roles/delete", {id:r.id})
      .then(function(){ toast("Роль удалена"); return loadState(); })
      .catch(function(err){
        if(err && err.error === "in_use") toast("Роль назначена сотрудникам");
        else if(err && err.error === "builtin") toast("Заводскую роль удалить нельзя");
        else apiError(err);
      });
    return;
  }
  openRole(r);
});
$("btnRoleDel").onclick = function(){
  var r = (cfg.roles||[]).find(function(x){ return x.id===editingRole; }); if(!r) return;
  $("dlgRole").close();
  if(staffOfRole(r.id)){ toast("Роль назначена сотрудникам — сначала переведите их на другую"); return; }
  if(!confirm("Удалить роль «"+r.name+"»?")) return;
  api("/api/roles/delete", {id:r.id})
    .then(function(){ toast("Роль удалена"); return loadState(); }).catch(apiError);
};
$("btnRoleSave").onclick = function(){
  var nm = $("rl_name").value.trim();
  if(!nm){ toast("Введите название роли"); return; }
  var perms = [];
  $("rl_perms").querySelectorAll("input:checked").forEach(function(el){ perms.push(el.dataset.perm); });
  /* роли общие на всю базу, а в окне — разделы только этого учреждения:
     уровни разделов других учреждений сохраняем как были */
  var old = (cfg.roles||[]).find(function(x){ return x.id===editingRole; });
  var access = JSON.parse(JSON.stringify((old && old.regAccess) || {}));
  $("dlgRole").querySelectorAll("select[data-reg]").forEach(function(el){
    access[el.dataset.reg] = el.value;
  });
  $("dlgRole").querySelectorAll("select[data-area]").forEach(function(el){
    access[el.dataset.area] = el.value;
  });
  api("/api/roles", {id: editingRole || uid("role"), name: nm,
                     descr: $("rl_descr").value.trim(), perms: perms, regAccess: access})
    .then(function(){ $("dlgRole").close(); toast("Роль сохранена"); return loadState(); })
    .catch(apiError);
};

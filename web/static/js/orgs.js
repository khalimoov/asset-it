/* Учреждения и область просмотра администратора.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== область просмотра для администратора ==================
   На дашборде, ремонтах, уведомлениях и в журнале удалений администратор может
   смотреть не только своё учреждение. Данные для этого приходят отдельным
   запросом: состояние приложения остаётся строго в рамках одного учреждения,
   иначе правка записей стала бы опасной — непонятно, в чьи данные пишем. */
var SCOPE_VIEWS = ["dash", "repairs", "notices", "dels"];
var scopeOrg = "";          /* "" — текущее учреждение, "*" — все, иначе id */
var cross = null;           /* сквозные данные, подгружаются по требованию */

function scopeWide(){ return !!(me && me.seesAllOrgs) && scopeOrg !== "" && !!cross; }
function scopeLabel(){
  if(scopeOrg === "*") return "все учреждения";
  return orgName(scopeOrg) || orgName(orgId);
}
/* Отбирает из сквозных данных то, что показываем сейчас. */
function scopePick(list){
  if(scopeOrg === "*") return list;
  return list.filter(function(x){ return x.orgId === scopeOrg; });
}
function renderScopePick(){
  var sel = $("scopeOrg");
  var show = !!(me && me.seesAllOrgs) && orgs.length > 1 && SCOPE_VIEWS.indexOf(nav) !== -1;
  sel.hidden = !show;
  if(!show) return;
  /* «Все учреждения» всегда первым: с него смотрят чаще всего */
  sel.innerHTML = '<option value="*">Все учреждения</option>' +
    '<option value="">Только ' + esc(orgName(orgId)) + '</option>' +
    orgs.filter(function(o){ return o.id !== orgId; }).map(function(o){
      return '<option value="'+esc(o.id)+'">Только '+esc(o.name)+'</option>'; }).join("");
  sel.value = scopeOrg;
}
$("scopeOrg").addEventListener("change", function(){
  scopeOrg = $("scopeOrg").value;
  if(scopeOrg === ""){ cross = null; renderAll(); return; }
  /* без catch ошибка отрисовки утонет в промисе: window.onerror их не ловит */
  loadCross().then(renderAll)
    .catch(function(e){ toast("Сбой при показе данных: " + ((e && e.message) || e)); });
});
function loadCross(){
  if(!(me && me.seesAllOrgs)) return Promise.resolve();
  return api("/api/cross").then(function(d){ cross = d; })
    .catch(function(e){ toast("Не удалось получить данные по учреждениям" + apiWhy(e)); });
}

/* ================== учреждения ==================
   Переключение идёт через сервер: он же проверяет доступ и запоминает выбор
   в cookie. Подменять учреждение на стороне браузера бесполезно — данные
   приходят уже отфильтрованными. */
function orgName(id){
  var o = orgs.find(function(x){ return x.id === id; });
  return o ? o.name : "";
}
function renderOrgPick(){
  var sel = $("orgPick");
  sel.hidden = orgs.length < 2;
  sel.innerHTML = orgs.map(function(o){
    return '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>'; }).join("");
  sel.value = orgId;
  $("meRole").title = orgName(orgId) ? ("Учреждение: " + orgName(orgId)) : "";
}
$("orgPick").onchange = function(){
  switchOrg($("orgPick").value);
};
function switchOrg(id){
  if(!id || id === orgId) return Promise.resolve();
  return api("/api/org/select", {id:id}).then(function(){
    orgId = id;
    /* смена учреждения — это смена всех справочников; сбрасываем выбор раздела */
    curReg = ""; nav = "dash";
    return loadState().then(function(){ toast("Учреждение: " + orgName(id)); });
  }).catch(function(e){ toast("Не удалось переключиться" + apiWhy(e)); });
}

function loadOrgs(){
  return api("/api/orgs/access").then(function(d){
    orgStaff = d.staff || [];
    renderOrgsScreen(d.orgs || []);
  }).catch(function(){});
}
function loadOverview(){
  if(!(me && me.seesAllOrgs)) return Promise.resolve();
  return api("/api/overview").then(function(d){
    orgOverview = d.orgs || []; renderOverview();
  }).catch(function(){});
}

var orgList = [];
function renderOrgsScreen(list){
  if(list) orgList = list;
  var q = $("qOrg").value.trim().toLowerCase();
  var counts = {};
  orgOverview.forEach(function(o){ counts[o.id] = o.items; });
  var shown = orgList.filter(function(o){
    return !q || (o.name + " " + (o.note||"")).toLowerCase().indexOf(q) !== -1; });

  $("orgsBody").innerHTML = shown.map(function(o, i){
    var who = orgStaff.filter(function(st){ return st.orgId === o.id; }).length;
    return '<tr data-o="'+esc(o.id)+'"><td class="num">'+(i+1)+'</td>'+
      cellText(o.name + (o.id === orgId ? "" : "")) +
      cellText(o.note || "—") +
      '<td>'+(counts[o.id] === undefined ? "—" : counts[o.id])+'</td>'+
      '<td>'+who+'</td>'+
      acts(['<button class="ic js-oedit" title="Изменить">✎</button>']) + '</tr>';
  }).join("");
  $("orgsEmpty").hidden = shown.length > 0;

  /* кто где работает: у каждого сотрудника ровно одно учреждение */
  $("accBody").innerHTML = orgStaff.map(function(st, i){
    return '<tr><td class="num">'+(i+1)+'</td>'+ cellText(st.name) +
      cellText(st.roleName || "—") +
      '<td><select class="js-staff-org" data-s="'+esc(st.id)+'"'+(can("org.manage") ? '' : ' disabled')+'>' +
        orgList.map(function(o){
          return '<option value="'+esc(o.id)+'"'+(st.orgId === o.id ? " selected" : "")+'>'+
                 esc(o.name)+'</option>'; }).join("") +
      '</select>' + (st.isAdmin ? ' <span class="chip" title="администратору открыты все учреждения">все</span>' : '') +
      '</td></tr>';
  }).join("");
}
$("qOrg").oninput = function(){ renderOrgsScreen(); };
$("accBody").addEventListener("change", function(e){
  var el = e.target.closest("select.js-staff-org"); if(!el) return;
  var sid = el.dataset.s;
  api("/api/orgs/access", {staffId:sid, orgId:el.value})
    .then(function(){ toast("Сотрудник переведён"); return loadOrgs(); })
    .catch(function(e2){ toast("Не удалось перевести" + apiWhy(e2)); });
});

function renderOverview(){
  var sum = function(k){ return orgOverview.reduce(function(a,o){ return a + (o[k]||0); }, 0); };
  $("allStats").innerHTML =
    tile("Учреждений", orgOverview.length) + tile("Всего записей", sum("items")) +
    tile("В эксплуатации", sum("inUse")) + tile("В ремонте", sum("repair")) +
    tile("Сотрудников", sum("people"));
  $("allBody").innerHTML = orgOverview.map(function(o, i){
    return '<tr class="pick" data-go="'+esc(o.id)+'"><td class="num">'+(i+1)+'</td>'+
      cellText(o.name + (o.id === orgId ? " · вы здесь" : "")) +
      '<td>'+o.items+'</td><td>'+o.inUse+'</td><td>'+o.stock+'</td>'+
      '<td>'+o.repair+(o.openRepairs ? ' <span class="chip">откр. '+o.openRepairs+'</span>' : '')+'</td>'+
      '<td>'+(o.toOff||0)+'</td>'+
      '<td>'+o.off+'</td><td class="hide-md">'+o.people+'</td><td>'+o.staff+'</td></tr>';
  }).join("");
  $("allEmpty").hidden = orgOverview.length > 0;
  $("cntAll").textContent = orgOverview.length ? String(orgOverview.length) : "";
}
$("allBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-go]"); if(!tr) return;
  switchOrg(tr.dataset.go);
});

/* ---------- карточка учреждения ---------- */
var editingOrg = null;
function openOrg(o){
  editingOrg = o ? o.id : null;
  $("dlgOrgTitle").textContent = o ? ("Учреждение: " + o.name) : "Новое учреждение";
  $("o_name").value = o ? o.name : "";
  $("o_note").value = o ? (o.note || "") : "";
  $("o_sort").value = o ? (o.sort || 0) : (orgList.length);
  $("o_err").textContent = "";
  $("o_hint").textContent = o
    ? "Удалить можно только учреждение без записей учёта."
    : "Новое учреждение сразу получит четыре заводских раздела. Справочники, сотрудники и настройки домена у него свои.";
  $("btnOrgDel").hidden = !o || orgList.length < 2;
  $("dlgOrg").showModal();
  setTimeout(function(){ $("o_name").focus(); }, 30);
}
$("btnAddOrg").onclick = function(){ openOrg(null); };
$("orgsBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-o]"); if(!tr) return;
  var o = orgList.find(function(x){ return x.id === tr.dataset.o; });
  if(o) openOrg(o);
});
$("btnOrgCancel").onclick = function(){ $("dlgOrg").close(); };
$("btnOrgSave").onclick = function(){
  var nm = $("o_name").value.trim();
  if(!nm){ $("o_err").textContent = "Название обязательно"; return; }
  var id = editingOrg || ("org" + Date.now().toString(36));
  api("/api/orgs", {id:id, name:nm, note:$("o_note").value.trim(),
                    sort:parseInt($("o_sort").value, 10) || 0})
    .then(function(){
      $("dlgOrg").close(); toast("Сохранено");
      return loadState().then(loadOrgs).then(loadOverview);
    })
    .catch(function(e){ $("o_err").textContent = "Не удалось сохранить" + apiWhy(e); });
};
$("btnOrgDel").onclick = function(){
  if(!editingOrg) return;
  if(!confirm("Удалить учреждение вместе с его справочниками и настройками?")) return;
  api("/api/orgs/delete", {id:editingOrg})
    .then(function(){
      $("dlgOrg").close(); toast("Удалено");
      return loadState().then(loadOrgs).then(loadOverview);
    })
    .catch(function(e){
      $("o_err").textContent = (e && e.error === "not_empty")
        ? "В учреждении есть записи учёта — сначала удалите их"
        : (e && e.error === "last_org") ? "Последнее учреждение удалить нельзя"
        : ("Не удалось удалить" + apiWhy(e));
    });
};

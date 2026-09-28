/* Пользователи ИТ.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== пользователи ИТ ================== */
function renderStaff(){
  var q = $("qStaff").value.trim().toLowerCase();
  var list = (cfg.staff||[]).slice().sort(function(a,b){
      return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; })
    .filter(function(x){
      if(!q) return true;
      return [x.name, x.position, x.login, roleName(x.role)].join(" ").toLowerCase().indexOf(q)!==-1;
    });
  $("staffBody").innerHTML = list.map(function(x, i){
    return '<tr class="pick" data-s="'+esc(x.id)+'"><td class="num">'+(i+1)+'</td>'+
      '<td title="'+esc(x.name)+'">'+esc(x.name)+(x.auth==="ad" ? ' <span class="chip" title="входит с доменным паролем">AD</span>' : '')+'</td>'+
      cellText(x.position||"—")+
      '<td><label class="chk"><input type="checkbox" data-master'+(x.isMaster?' checked':'')+
        (isAdmin()?'':' disabled title="назначает администратор"')+'> мастер</label></td>'+
      '<td>'+(function(){
        var k = repairsOfMaster(x.id).length;
        return k ? '<span class="badge b-warn">'+k+'</span>' : '<span class="chip">—</span>';
      })()+'</td>'+
      cellText(x.login||"—")+
      '<td class="hide-md" title="'+esc(roleName(x.role))+'">'+esc(roleName(x.role))+'</td>'+
      acts(['<button class="ic js-edit" title="Изменить">✎</button>',
            '<button class="ic btn-danger js-del" title="Удалить">✕</button>'])+'</tr>';
  }).join("");
  var e = $("staffEmpty"); e.hidden = list.length>0;
  e.textContent = (cfg.staff||[]).length ? "Ничего не найдено." : "Пользователи ИТ пока не заведены.";
}
$("qStaff").oninput = renderStaff;
var editingStaff = null;
$("st_auth").onchange = function(){
  var ad = this.value === "ad";
  $("st_pass").disabled = ad;
  $("st_pass").placeholder = ad ? "проверяет домен — здесь не нужен" : "оставьте пустым, чтобы не менять";
};
function openStaff(x){
  editingStaff = x ? x.id : null;
  $("dlgStaffTitle").textContent = x ? ("Пользователь ИТ: "+x.name) : "Новый пользователь ИТ";
  $("st_name").value = x ? x.name : "";
  $("st_pos").value = x ? (x.position||"") : "";
  $("st_login").value = x ? (x.login||"") : "";
  $("st_auth").value = x ? (x.auth||"local") : "local";
  $("st_auth").onchange();
  $("st_org").innerHTML = orgs.map(function(o){
    return '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>'; }).join("");
  $("st_org").value = (x && x.orgId) || orgId;
  $("st_edit").checked = x ? !!x.canEdit : false;
  $("st_pass").value = "";
  $("st_role").innerHTML = '<option value="">— роль не назначена —</option>' +
    (cfg.roles||[]).map(function(r){
      return '<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>'; }).join("");
  $("st_role").value = x && x.role ? x.role : "";
  $("st_master").checked = !!(x && x.isMaster);
  $("st_active").checked = x ? (x.active !== false) : true;
  $("btnStaffDel").hidden = !x;
  var mayStaff = can("staff.manage");
  $("dlgStaff").querySelectorAll("input,select,textarea").forEach(function(el){ el.disabled = !mayStaff; });
  $("btnStaffSave").hidden = !mayStaff;
  if(!mayStaff) $("btnStaffDel").hidden = true;
  $("dlgStaff").showModal();
  setTimeout(function(){ $("st_name").focus(); }, 30);
}
function openStaffInfo(x){
  editingStaff = x.id;
  $("siTitle").textContent = x.name;
  $("si_pos").textContent   = x.position || "—";
  $("si_role").textContent  = roleName(x.role);
  $("si_master").textContent = x.isMaster ? "да" : "нет";
  $("si_login").textContent = x.login || "—";
  var list = repairsOfMaster(x.id);
  $("si_repair").innerHTML = miniTable(
    ["Раздел","Инв. номер","Тип","Отправлен","Дней","Причина"],
    list.map(function(i){
      return [(reg(rid(i))||{}).name||"", i.inv||"", typeName(i.type)||"",
              fmtDate(i.statusDate)||"—", daysBetween(i.statusDate, ""), i.statusNote||""];
    }),
    x.isMaster ? "Сейчас ничего не в ремонте." : "Сотрудник не отмечен мастером по ремонту.",
    list.map(function(i){ return i.id; }),
    ["20%","13%","17%","12%","7%","31%"], [5]);
  var hist = repairsHistory(x.id);
  var closed = hist.filter(function(r){ return r.to; });
  var totalDays = closed.reduce(function(a,r){ return a + (daysBetween(r.from, r.to)||0); }, 0);
  $("si_stat").textContent = hist.length
    ? ("Всего ремонтов: "+hist.length+", завершено: "+closed.length+
       (closed.length ? ", в среднем "+Math.round(totalDays/closed.length)+" дн." : ""))
    : "";
  $("si_history").innerHTML = miniTable(
    ["Инв. номер","Тип","Отправлен","Возвращён","Дней","Итог","Причина → что сделали"],
    hist.map(function(r){
      return [r.inv||"", r.typeName||"", fmtDate(r.from)||"—",
              r.to ? fmtDate(r.to) : "в ремонте", daysBetween(r.from, r.to), r.result||"",
              [r.note, r.doneNote].filter(Boolean).join(" → ")];
    }), "Ремонтов пока не было.",
    hist.map(function(r){ return "rp:"+r.id; }),
    ["12%","16%","11%","11%","6%","16%","28%"], [6]);
  $("dlgStaffInfo").showModal();
}
$("btnSiClose").onclick = function(){ $("dlgStaffInfo").close(); };
$("btnSiEdit").onclick = function(){
  var x = byId("staff", editingStaff);
  $("dlgStaffInfo").close();
  if(x) openStaff(x);
};
$("btnAddStaff").onclick = function(){
  if(!can("staff.manage")){ toast("Заводить сотрудников может только администратор"); return; }
  openStaff(null);
};
$("btnStaffCancel").onclick = function(){ $("dlgStaff").close(); };
$("btnStaffSave").onclick = function(){
  var nm = $("st_name").value.trim();
  if(!nm){ toast("Введите ФИО"); return; }
  if((cfg.staff||[]).some(function(x){ return x.name.toLowerCase()===nm.toLowerCase() && x.id!==editingStaff; })){
    toast("Такой сотрудник уже есть"); return; }
  var lg = $("st_login").value.trim();
  if(lg && (cfg.staff||[]).some(function(x){ return (x.login||"").toLowerCase()===lg.toLowerCase() && x.id!==editingStaff; })){
    toast("Такой логин уже занят"); return; }
  var body = {
    id: editingStaff || uid("st"),
    name: nm, position: $("st_pos").value.trim(),
    login: lg, role: $("st_role").value,
    isMaster: $("st_master").checked, active: $("st_active").checked
  };
  body.orgId = $("st_org").value;
  body.canEdit = $("st_edit").checked;
  body.auth = $("st_auth").value;
  if(body.auth === "ad" && !lg){ toast("Для входа через домен нужен доменный логин"); return; }
  if(body.auth !== "ad" && $("st_pass").value) body.password = $("st_pass").value;
  api("/api/staff", body)
    .then(function(){ $("dlgStaff").close(); toast("Сохранено"); return loadState(); })
    .catch(apiError);
};
$("btnStaffDel").onclick = function(){
  var x = byId("staff", editingStaff); if(!x) return;
  var linked = items.filter(function(i){ return i.masterId===x.id; });
  if(!confirm("Удалить сотрудника «"+x.name+"»?"+
    (linked.length?"\nОн назначен мастером в "+linked.length+" записях — поле у них очистится.":""))) return;
  linked.forEach(function(i){ i.masterId = ""; });
  if(linked.length) saveItems(linked);
  api("/api/staff/delete", {id:x.id})
    .then(function(){ $("dlgStaff").close(); toast("Удалено"); return loadState(); })
    .catch(function(e){
      if(e && e.error === "self") toast("Нельзя удалить самого себя");
      else apiError(e);
    });
};
$("staffBody").addEventListener("change", function(e){
  if(!e.target.hasAttribute("data-master")) return;
  if(!can("staff.manage")){ toast("Отмечать мастеров может только администратор"); renderStaff(); return; }
  var x = byId("staff", e.target.closest("tr").dataset.s); if(!x) return;
  x.isMaster = e.target.checked;
  api("/api/staff", {id:x.id, name:x.name, position:x.position, login:x.login,
                     role:x.role, isMaster:x.isMaster, active:x.active !== false})
    .catch(apiError);
});
$("staffBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var x = byId("staff", tr.dataset.s); if(!x) return;
  if(e.target.classList.contains("js-del")){ editingStaff = x.id; $("btnStaffDel").onclick(); return; }
  if(e.target.classList.contains("js-edit")){ openStaff(x); return; }
  if(e.target.tagName !== "INPUT") openStaffInfo(x);
});

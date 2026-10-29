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
      acts(can("staff.manage")
        ? ['<button class="ic js-edit" title="Изменить">✎</button>',
           '<button class="ic btn-danger js-del" title="Удалить">✕</button>']
        : [])+'</tr>';
  }).join("");
  var e = $("staffEmpty"); e.hidden = list.length>0;
  e.textContent = (cfg.staff||[]).length ? "Ничего не найдено." : "Пользователи ИТ пока не заведены.";
}
$("qStaff").oninput = renderStaff;
var editingStaff = null;
/* Источник авторизации. Local — пароль задаёт администратор. LDAP — человека
   находим в домене по логину, ФИО или почте, пароль проверяет домен; ФИО и
   логин берутся из AD как есть, руками их не набирают (ФИО и должность ещё и
   обновляются из домена при каждом входе). */
function stIsFirst(){ var x = editingStaff && byId("staff", editingStaff); return !!(x && x.first); }
function stAuthShow(){
  var ad = $("st_auth").value === "ad";
  $("st_ldapBox").hidden = !ad;
  $("st_passBox").hidden = ad;
  $("st_login").readOnly = ad;
  $("st_name").readOnly = ad;
  $("st_login").placeholder = ad ? "придёт из AD — выберите пользователя выше" : "i.ivanov";
  $("st_name").placeholder = ad ? "придёт из AD" : "Халимов Б.Ш.";
  $("st_passLbl").textContent = editingStaff ? "Пароль" : "Начальный пароль";
  $("st_pass").placeholder = editingStaff ? "оставьте пустым, чтобы не менять" : "";
  $("st_authHint").textContent = ad
    ? "Входит доменным логином и паролем. Работает, пока включено подключение в разделе «LDAP»."
    : "Входит логином и паролем, которые задаёт администратор.";
  /* переключили с Local на LDAP — набранное руками не годится, ждём выбора из AD */
  if(ad && !$("st_ldapPicked").textContent){ $("st_name").value = ""; $("st_login").value = ""; }
  if(ad) setTimeout(function(){ if(!$("st_login").value) $("st_ldapQ").focus(); }, 30);
}
$("st_auth").onchange = stAuthShow;

var stLdapTimer = null, stLdapSeq = 0, stLdapHits = [];
function stPicked(p){
  var el = $("st_ldapPicked");
  el.hidden = !p;
  el.innerHTML = p ? '<b>' + esc(p.name || p.login) + '</b><span>' + esc(p.login) + '</span>' +
    (p.email ? '<span>' + esc(p.email) + '</span>' : '') : "";
}
function stLdapPaint(msg){
  var list = $("st_ldapList");
  if(msg){ list.innerHTML = '<div class="ldap-msg">' + esc(msg) + '</div>'; return; }
  list.innerHTML = stLdapHits.map(function(p, i){
    var used = p.used && p.used.id !== editingStaff;
    return '<div class="ldap-it' + (used || p.disabled ? ' used' : '') + '" data-i="' + i + '">' +
      '<b>' + esc(p.name || p.login) + '</b>' +
      '<div>' + esc(p.login) + '</div>' +
      (p.email ? '<div>' + esc(p.email) + '</div>' : '') +
      (p.position ? '<div>' + esc(p.position) + '</div>' : '') +
      (used ? '<div class="tag">Уже используется' + (p.used.name ? ': ' + esc(p.used.name) : '') + '</div>' :
       p.disabled ? '<div class="tag">Учётная запись отключена в домене</div>' : '') +
      '</div>';
  }).join("");
}
$("st_ldapQ").oninput = function(){
  var q = this.value.trim(), seq = ++stLdapSeq;
  clearTimeout(stLdapTimer);
  if(q.length < 2){ stLdapHits = []; $("st_ldapList").innerHTML = ""; return; }
  stLdapTimer = setTimeout(function(){
    stLdapPaint("Ищу в домене…");
    api("/api/ldap/users?q=" + encodeURIComponent(q)).then(function(d){
      if(seq !== stLdapSeq) return;          /* пока ждали, набрали дальше */
      stLdapHits = d.users || [];
      if(stLdapHits.length) stLdapPaint(); else stLdapPaint("В домене никого не нашлось.");
    }).catch(function(e){
      if(seq !== stLdapSeq) return;
      stLdapHits = [];
      stLdapPaint("Поиск не удался" + apiWhy(e));
    });
  }, 300);
};
$("st_ldapQ").onkeydown = function(e){
  if(e.key === "Enter"){ e.preventDefault();
    var ok = stLdapHits.filter(function(p){ return !(p.used && p.used.id !== editingStaff) && !p.disabled; });
    if(ok.length === 1) stLdapPick(ok[0]);
  }
};
function stLdapPick(p){
  $("st_login").value = p.login;
  $("st_name").value = p.name || p.login;
  if(p.position) $("st_pos").value = p.position;
  stPicked(p);
  stLdapHits = []; $("st_ldapList").innerHTML = ""; $("st_ldapQ").value = "";
}
$("st_ldapList").addEventListener("click", function(e){
  var it = e.target.closest(".ldap-it"); if(!it || it.classList.contains("used")) return;
  var p = stLdapHits[+it.dataset.i]; if(p) stLdapPick(p);
});

function openStaff(x){
  editingStaff = x ? x.id : null;
  $("dlgStaffTitle").textContent = x ? ("Пользователь ИТ: "+x.name) : "Новый пользователь ИТ";
  $("st_name").value = x ? x.name : "";
  $("st_pos").value = x ? (x.position||"") : "";
  $("st_login").value = x ? (x.login||"") : "";
  $("st_auth").value = x ? (x.auth||"local") : "local";
  stLdapHits = []; $("st_ldapList").innerHTML = ""; $("st_ldapQ").value = "";
  stPicked(x && x.auth === "ad" && x.login ? {name:x.name, login:x.login} : null);
  stAuthShow();
  $("st_org").innerHTML = orgs.map(function(o){
    return '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>'; }).join("");
  $("st_org").value = (x && x.orgId) || orgId;
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
  /* первая учётка входит всегда своим паролем — источник, доступ и роль не трогаем */
  var first = stIsFirst();
  $("st_firstHint").hidden = !first;
  if(first){
    ["st_auth","st_active","st_role"].forEach(function(id){ $(id).disabled = true; });
    $("btnStaffDel").hidden = true;
  }
  $("dlgStaff").showModal();
  setTimeout(function(){ (x || $("st_auth").value !== "ad" ? $("st_name") : $("st_ldapQ")).focus(); }, 30);
}
function openStaffInfo(x){
  editingStaff = x.id;
  $("siTitle").textContent = x.name;
  $("si_pos").textContent   = x.position || "—";
  $("si_role").textContent  = roleName(x.role);
  $("si_master").textContent = x.isMaster ? "да" : "нет";
  $("si_login").textContent = x.login || "—";
  $("btnSiEdit").hidden = !can("staff.manage");
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
  body.auth = $("st_auth").value;
  if(body.auth === "ad" && !lg){ toast("Найдите пользователя в Active Directory"); $("st_ldapQ").focus(); return; }
  if(body.auth !== "ad" && !editingStaff && lg && !$("st_pass").value){
    toast("Задайте начальный пароль — иначе войти будет нечем"); $("st_pass").focus(); return; }
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
      else if(e && e.error === "first") toast(e.message);
      else apiError(e);
    });
};
$("staffBody").addEventListener("change", function(e){
  if(!e.target.hasAttribute("data-master")) return;
  if(!can("staff.manage")){ toast("Отмечать мастеров может только администратор"); renderStaff(); return; }
  var x = byId("staff", e.target.closest("tr").dataset.s); if(!x) return;
  x.isMaster = e.target.checked;
  /* шлём запись целиком: без auth и orgId сервер сбросил бы их */
  api("/api/staff", {id:x.id, name:x.name, position:x.position, login:x.login,
                     role:x.role, isMaster:x.isMaster, active:x.active !== false,
                     auth:x.auth || "local", orgId:x.orgId || ""})
    .catch(apiError);
});
$("staffBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var x = byId("staff", tr.dataset.s); if(!x) return;
  if(e.target.classList.contains("js-del") && can("staff.manage")){ editingStaff = x.id; $("btnStaffDel").onclick(); return; }
  if(e.target.classList.contains("js-edit") && can("staff.manage")){ openStaff(x); return; }
  if(e.target.tagName !== "INPUT") openStaffInfo(x);
});

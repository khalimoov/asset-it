/* Сотрудники.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== сотрудники ================== */
function renderUsers(){
  var q = $("qUser").value.trim().toLowerCase();
  var list = cfg.users.slice().sort(function(a,b){ return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; })
    .filter(function(u){
      if(!q) return true;
      return [u.name,u.position,u.phone,u.email,
              nameById("divisions",u.divisionId),nameById("departments",u.departmentId)]
        .join(" ").toLowerCase().indexOf(q)!==-1;
    });
  $("usersBody").innerHTML = list.map(function(u, i){
    return '<tr class="pick" data-u="'+esc(u.id)+'"><td class="num">'+(i+1)+'</td>'+
      cellText(u.name)+cellText(u.position||"—")+
      cellText(nameById("divisions", u.divisionId)||"—")+
      '<td class="hide-md" title="'+esc(nameById("departments", u.departmentId)||"—")+'">'+
        esc(nameById("departments", u.departmentId)||"—")+'</td>'+
      '<td class="hide-md mono" title="'+esc(u.phone||"")+'">'+esc(u.phone||"")+'</td>'+
      '<td class="hide-md" title="'+esc(u.email||"")+'">'+esc(u.email||"")+'</td>'+
      '<td>'+itemsOfUser(u.id)+
        (cfg.issues.filter(function(x){ return x.userId===u.id; }).length
          ? ' <span class="chip" title="выдано расходных материалов">+'+
            cfg.issues.filter(function(x){ return x.userId===u.id; }).length+' мат.</span>' : '')+'</td>'+
      acts(!canDict("employees") ? [] :
           ['<button class="ic js-edit" title="Изменить данные">✎</button>',
            '<button class="ic btn-danger js-del"'+
              (activeOfUser(u.id).length
                ? ' disabled title="За сотрудником числится техника — удалить нельзя"'
                : ' title="Удалить"')+'>✕</button>'])+'</tr>';
  }).join("");
  var e = $("usersEmpty"); e.hidden = list.length>0;
  e.textContent = cfg.users.length ? "Ничего не найдено." : "Сотрудники пока не заведены.";
}
$("qUser").oninput = renderUsers;

function miniTable(head, rows, emptyMsg, ids, widths, wrapCols){
  if(!rows.length) return '<div class="note">'+esc(emptyMsg)+'</div>';
  var cg = widths ? '<colgroup>'+widths.map(function(w){
    return '<col style="width:'+w+'">'; }).join("")+'</colgroup>' : '';
  return '<div class="miniwrap"><table class="mini">'+cg+'<thead><tr>'+
    head.map(function(h){ return '<th>'+esc(h)+'</th>'; }).join("")+'</tr></thead><tbody>'+
    rows.map(function(r, i){
      var id = ids && ids[i];
      return '<tr'+(id ? ' class="pick" data-open="'+esc(id)+'" title="открыть карточку"' : '')+'>'+
        r.map(function(c, k){
          var w = (wrapCols && wrapCols.indexOf(k)!==-1) ? ' class="wrap"' : '';
          return '<td'+w+' title="'+esc(c)+'">'+esc(c)+'</td>';
        }).join("")+'</tr>';
    }).join("")+
    '</tbody></table></div>';
}
/* из любой сводки можно провалиться в карточку записи */
function openItemById(id){
  var it = items.find(function(x){ return x.id===id; });
  if(!it){ toast("Запись удалена — осталась только в журнале ремонтов"); return; }
  ["dlgStaffInfo","dlgUserInfo","dlgDrill"].forEach(function(d){ if($(d).open) $(d).close(); });
  openReg(rid(it), "items");
  openDlg(it);
}
["si_repair","si_history","ui_items","drillBody"].forEach(function(id){
  $(id).addEventListener("click", function(e){
    var tr = e.target.closest("tr[data-open]"); if(!tr) return;
    var v = tr.dataset.open;
    if(v.indexOf("rp:")===0){
      if($("dlgStaffInfo").open) $("dlgStaffInfo").close();
      openRepairDlg(v.slice(3));
      return;
    }
    openItemById(v);
  });
});
function openUserInfo(u){
  editingUser = u.id;
  $("uiTitle").textContent = u.name;
  $("btnUiEdit").hidden = !canDict("employees");
  $("ui_pos").textContent = u.position || "—";
  $("ui_div").textContent = nameById("divisions", u.divisionId) || "—";
  $("ui_dep").textContent = nameById("departments", u.departmentId) || "—";
  $("ui_phone").textContent = u.phone || "—";
  /* почта — ссылкой: по клику сразу письмо */
  $("ui_mail").innerHTML = u.email
    ? '<a href="mailto:'+esc(u.email)+'">'+esc(u.email)+'</a>' : "—";
  var own = itemsOfPerson(u.id);
  $("ui_items").innerHTML = miniTable(
    ["Раздел","Инв. номер","Тип","Статус"],
    own.map(function(i){
      var h = holderOf(i);
      return [(reg(rid(i))||{}).name||"", i.inv||"",
              (typeName(i.type)||"") + (h.kind==="item" && h.parent ? " · прикреплено к инв. " + (h.parent.inv||"—") : ""),
              i.status||""]; }),
    "За сотрудником ничего не закреплено.",
    own.map(function(i){ return i.id; }));
  var iss = cfg.issues.filter(function(x){ return x.userId===u.id; })
    .sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
  $("ui_sup").innerHTML = miniTable(
    ["Дата","Материал","Кол-во","Примечание"],
    iss.map(function(x){ var m = supplyById(x.supplyId)||{};
      return [fmtDate(x.date), m.name||"—", String(x.qty||1), x.note||""]; }),
    "Расходные материалы не выдавались.");
  loadUserRequests(u);
  $("dlgUserInfo").showModal();
}

/* заявки на доступ из программы «Заявки ИТ»: сервер сам ходит в её API */
var REQ_BADGE = {done:"b-ok", created:"b-warn"};
var RIGHT_BADGE = {requested:"b-warn", revoking:"b-danger"};
function loadUserRequests(u){
  var box = $("ui_req"), side = $("ui_rights");
  function say(t){ box.innerHTML = side.innerHTML = '<div class="note">'+esc(t)+'</div>'; }
  $("ui_reqLink").hidden = true;
  say("Загрузка…");
  api("/api/persons/"+encodeURIComponent(u.id)+"/requests").then(function(d){
    if(editingUser!==u.id) return;            /* окно уже открыто на другом сотруднике */
    if(!d.configured){
      say("Связь с программой заявок не настроена: ключ API — ZAYAVKI_KEY в server/.env или файл api.txt.");
      return;
    }
    if(!d.found){ say("В программе заявок этот сотрудник не найден."); return; }
    if(d.url){ $("ui_reqLink").href = d.url; $("ui_reqLink").hidden = false; }
    box.innerHTML = reqTable(["Дата","Заявка","На что","Состояние"], ["90px","150px","","140px"],
      d.requests.map(function(r){
        var what = r.resources.map(function(x){
          return (x.system ? x.system+": " : "")+x.name+(x.permission ? " ("+x.permission+")" : ""); });
        return {href:r.url, cells:[
          fmtDate(r.date)+(r.number ? " №"+r.number : ""),
          r.kindName+(r.action==="revoke" ? " · "+r.actionName : ""),
          {text:r.label || what.join("; ") || "—", title:what.join("\n"), wrap:true},
          {badge:REQ_BADGE[r.status]||"b-mute", text:r.statusName}]};
      }), "Заявок на сотрудника нет.");
    side.innerHTML = rightsList(d.rights, "Действующих полномочий нет.") +
      (d.removed.length ? '<details class="ui-removed"><summary>Снятые полномочия: '+d.removed.length+
        '</summary>'+rightsList(d.removed, "", true)+'</details>' : "");
  }, function(e){
    if(editingUser!==u.id || (e && e.auth)) return;
    say("Заявки не загрузились"+apiWhy(e));
  });
}
/* Полномочия столбиком, нумерация — как в «Заявках ИТ» (и в бланке заявки):
   система — «1.», её подпункты — «1.1», «1.2»…; ресурс без системы — следующий номер.
   Снятые (flat) — там же простым списком «1.», «2.» с «Система → ресурс». Порядок — как отдаёт API. */
function rightsList(list, emptyMsg, flat){
  if(!list.length) return emptyMsg ? '<div class="note">'+esc(emptyMsg)+'</div>' : "";
  var out = "", n = 0, k = 0, sys = null;
  list.forEach(function(x, i){
    var name = x.resource;
    if(flat){ n = i+1; if(x.system) name = x.system+" → "+name; }
    else{
      if(!x.system || x.system!==sys){ n++; k = 0; }
      if(x.system && x.system!==sys)
        out += '<div class="rg-sys" title="'+esc(x.system)+'"><span class="rt-n">'+n+'.</span>'+
               '<span>'+esc(x.system)+'</span></div>';
      sys = x.system;
      if(x.system) k++;
    }
    var tip = (x.info ? x.info+"\n" : "")+(x.requestDate ? "заявка от "+fmtDate(x.requestDate) : "");
    out += '<a class="rt'+(!flat && x.system ? ' child' : '')+'" target="_blank" rel="noopener"'+
      (x.url ? ' href="'+esc(x.url)+'"' : '')+' title="'+esc(tip)+'">'+
      '<span class="rt-n">'+n+'.'+(!flat && x.system ? k : '')+'</span><span class="rt-name">'+esc(name)+'</span>'+
      (x.permission ? '<span class="chip">'+esc(x.permission)+'</span>' : '')+
      (RIGHT_BADGE[x.state] ? '<span class="badge '+RIGHT_BADGE[x.state]+'">'+esc(x.stateName)+'</span>' : '')+
      '</a>';
  });
  return out;
}
function reqTable(head, widths, rows, emptyMsg){
  if(!rows.length) return '<div class="note">'+esc(emptyMsg)+'</div>';
  return '<div class="miniwrap"><table class="mini"><colgroup>'+widths.map(function(w){
      return '<col'+(w ? ' style="width:'+w+'"' : '')+'>'; }).join("")+'</colgroup><thead><tr>'+
    head.map(function(h){ return '<th>'+esc(h)+'</th>'; }).join("")+'</tr></thead><tbody>'+
    rows.map(function(r){
      return '<tr'+(r.href ? ' class="pick" data-href="'+esc(r.href)+'" title="открыть заявку"' : '')+'>'+
        r.cells.map(function(c){
          if(typeof c==="string") c = {text:c};
          var body = c.badge ? '<span class="badge '+c.badge+'">'+esc(c.text)+'</span>' : esc(c.text);
          return '<td'+(c.wrap ? ' class="wrap"' : '')+' title="'+esc(c.title||c.text)+'">'+body+'</td>';
        }).join("")+'</tr>';
    }).join("")+'</tbody></table></div>';
}
$("ui_req").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-href]");
  if(tr) window.open(tr.dataset.href, "_blank", "noopener");
});
$("btnUiClose").onclick = function(){ $("dlgUserInfo").close(); };
$("btnUiEdit").onclick = function(){
  var u = byId("users", editingUser);
  $("dlgUserInfo").close();
  if(u) openUser(u);
};

function openUser(u){
  editingUser = u ? u.id : null;
  $("dlgUserTitle").textContent = u ? "Сотрудник: "+u.name : "Новый сотрудник";
  $("u_name").value = u ? u.name : "";
  $("u_pos").value = u ? (u.position||"") : "";
  $("u_phone").value = u ? (u.phone||"") : "";
  $("u_mail").value = u ? (u.email||"") : "";
  $("u_div").innerHTML = opts(cfg.divisions, "— не указано —");
  $("u_div").value = u ? (u.divisionId||"") : "";
  fillDeps("u_div", "u_dep", u ? (u.departmentId||"") : "");
  $("btnUserDel").hidden = !u;
  var mayUsers = canDict("employees");
  $("dlgUser").querySelectorAll("input,select,textarea").forEach(function(el){ el.disabled = !mayUsers; });
  $("btnUserSave").hidden = !mayUsers;
  if(!mayUsers) $("btnUserDel").hidden = true;
  $("dlgUser").showModal();
  setTimeout(function(){ $("u_name").focus(); }, 30);
}
$("btnAddUser").onclick = function(){ openUser(null); };
$("u_div").onchange = function(){ fillDeps("u_div", "u_dep", $("u_dep").value); };
$("u_dep").onchange = function(){ depPicksDiv("u_div", "u_dep"); };
$("btnUserCancel").onclick = function(){ $("dlgUser").close(); };
$("btnUserSave").onclick = function(){
  var nm = $("u_name").value.trim();
  if(!nm){ toast("Введите ФИО"); return; }
  var dup = cfg.users.find(function(u){ return u.name.toLowerCase()===nm.toLowerCase() && u.id!==editingUser; });
  if(dup){ toast("Такой сотрудник уже есть"); return; }
  var rec = editingUser ? byId("users", editingUser) : {id:uid("u")};
  rec.name = nm; rec.position = $("u_pos").value.trim();
  rec.phone = $("u_phone").value.trim(); rec.email = $("u_mail").value.trim();
  rec.divisionId = $("u_div").value; rec.departmentId = $("u_dep").value;
  if(!editingUser) cfg.users.push(rec);
  saveCfg(); $("dlgUser").close(); toast("Сохранено");
};
$("btnUserDel").onclick = function(){
  var u = byId("users", editingUser); if(!u) return;
  var active = activeOfUser(u.id);
  if(active.length){
    toast("Нельзя удалить: за сотрудником числится техника — "+active.length+". Сначала переведите её на склад, на другого сотрудника или спишите.");
    return;
  }
  /* полномочия в «Заявках ИТ» должны быть сняты (или на снятии); сервер проверит то же самое */
  api("/api/persons/"+encodeURIComponent(u.id)+"/requests").then(function(d){
    var keep = d.found ? d.rights.filter(function(x){ return x.keep; }) : [];
    if(keep.length){ showUserBlock(u, d, keep); return; }
    var off = d.found ? d.rights.length : 0;
    var used = itemsOfUser(u.id), iss = cfg.issues.filter(function(x){ return x.userId===u.id; }).length;
    if(!confirm("Удалить сотрудника «"+u.name+"»?"+
      (off?"\nПолномочий на снятии в «Заявках»: "+off+" — заявка на снятие ещё не исполнена.":"")+
      (used?"\nВ "+used+" списанных позициях он останется только в истории.":"")+
      (iss?"\nЗаписей о выданных материалах: "+iss+" — сотрудник в них перестанет отображаться.":""))) return;
    cfg.users = cfg.users.filter(function(x){ return x.id!==u.id; });
    var touched = items.filter(function(i){ return i.owner===u.id; });
    touched.forEach(function(i){ i.owner=""; });
    saveCfg(); if(touched.length) saveItems(touched);
    $("dlgUser").close(); toast("Удалено");
  }, function(e){
    if(e && e.auth) return;
    toast("Не удалось проверить полномочия в «Заявках ИТ» — сотрудник не удалён"+apiWhy(e));
  });
};
function showUserBlock(u, d, keep){
  $("ub_msg").textContent = "В «Заявках ИТ» у «"+u.name+"» действуют полномочия — "+keep.length+
    ". Сначала сделайте в «Заявках» заявку на снятие полномочий, потом удалите сотрудника.";
  $("ub_rights").innerHTML = rightsList(keep, "");
  $("ub_link").hidden = !d.url; if(d.url) $("ub_link").href = d.url;
  $("dlgUserBlock").showModal();
}
$("btnUbClose").onclick = function(){ $("dlgUserBlock").close(); };
$("usersBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var u = byId("users", tr.dataset.u); if(!u) return;
  var may = canDict("employees");
  if(e.target.classList.contains("js-del") && may){ editingUser = u.id; $("btnUserDel").onclick(); return; }
  if(e.target.classList.contains("js-edit") && may){ openUser(u); return; }
  openUserInfo(u);
});
$("btnCollectUsers").onclick = function(){
  var names = {}, touched = [];
  items.forEach(function(it){
    var v = it.owner; if(!v) return;
    if(byId("users", v)) return;                 /* уже ссылка */
    var nm = String(v).trim(); if(!nm) return;
    names[nm.toLowerCase()] = nm;
  });
  var keys = Object.keys(names);
  if(!keys.length){ toast("Новых имён в записях не нашлось"); return; }
  if(!confirm("Создать сотрудников из записей: "+keys.length+"?\nВ карточках вместо текста будет ссылка на справочник.")) return;
  var map = {};
  keys.forEach(function(k){
    var exist = cfg.users.find(function(u){ return u.name.toLowerCase()===k; });
    if(!exist){ exist = {id:uid("u"), name:names[k], position:"", divisionId:"", departmentId:""}; cfg.users.push(exist); }
    map[k] = exist.id;
  });
  items.forEach(function(it){
    var v = it.owner; if(!v || byId("users", v)) return;
    var id = map[String(v).trim().toLowerCase()];
    if(id){ it.owner = id; touched.push(it); }
  });
  saveCfg(); saveItems(touched);
  toast("Готово: сотрудников "+keys.length+", обновлено записей "+touched.length);
};

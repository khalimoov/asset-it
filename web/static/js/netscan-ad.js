/* Опрос сети, Active Directory, вход через домен.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== опрос сети ==================
   Состояние адресов приходит с сервером вместе со всем остальным: это он
   обходит сеть по расписанию, браузер только показывает результат. */
function netOf(ip){ return (cfg.netStatus || {})[ip] || null; }

function netCell(ip){
  var st = netOf(ip);
  if(!st || !st.lastCheck) return '<td class="net-un" title="адрес ещё не опрашивали">—</td>';
  if(st.alive)
    return '<td title="отвечает' + (st.method ? " (" + esc(st.method) + ")" : "") +
           ', проверено ' + esc(fmtWhen(st.lastCheck)) + '">' +
           '<span class="badge b-ok">в сети</span></td>';
  var was = st.lastSeen ? fmtWhen(st.lastSeen) : "";
  return '<td class="net-off" title="' + (was ? "последний раз отвечал " + esc(was)
                                              : "ни разу не отвечал") +
         ', проверено ' + esc(fmtWhen(st.lastCheck)) + '">' +
         (was ? esc(was) : "не отвечал") + '</td>';
}

var pingCfg = null;
function loadPing(){
  if(!can("ip.edit")) return Promise.resolve();
  return api("/api/netscan").then(function(d){
    pingCfg = d.config || {};
    $("pg_every").value = pingCfg.everyMin || 15;
    $("pg_tmo").value   = pingCfg.timeoutMs || 800;
    $("pg_on").checked    = !!pingCfg.enabled;
    $("pg_whole").checked = !!pingCfg.wholePools;
    $("pingTargets").textContent = "Под опрос попадает адресов: " + (d.targets || 0);
    var L = d.last;
    $("pingLast").textContent = L
      ? ("последний обход: " + fmtWhen(L.at) + " — проверено " + L.checked +
         ", в сети " + L.alive + ", за " + L.seconds + " с")
      : "обход ещё не выполнялся";
  }).catch(function(){});
}
function pingPayload(){
  return {enabled:$("pg_on").checked, wholePools:$("pg_whole").checked,
          everyMin:parseInt($("pg_every").value, 10) || 15,
          timeoutMs:parseInt($("pg_tmo").value, 10) || 800};
}
$("btnPing").onclick = function(){
  var c = $("pingCard"); c.hidden = !c.hidden;
  if(!c.hidden) loadPing();
};
$("btnPingSave").onclick = function(){
  $("pg_err").textContent = "";
  api("/api/netscan", pingPayload())
    .then(function(){ toast("Сохранено"); return loadPing(); })
    .catch(function(e){ $("pg_err").textContent = "Не удалось сохранить настройки" + apiWhy(e); });
};
$("btnPingRun").onclick = function(){
  $("pg_err").textContent = "";
  $("btnPingRun").disabled = true; $("btnPingRun").textContent = "Опрашиваю…";
  api("/api/netscan", pingPayload())
    .then(function(){ return api("/api/netscan/run", {}); })
    .then(function(d){
      var t = d.stats || {};
      toast("Проверено " + t.checked + ", в сети " + t.alive);
      return loadState().then(loadPing);
    })
    .catch(function(e){ $("pg_err").textContent = "Опрос не удался" + apiWhy(e); })
    .then(function(){ $("btnPingRun").disabled = false;
                      $("btnPingRun").textContent = "Опросить сейчас"; });
};

/* ================== LDAP (Active Directory) ==================
   Две вкладки:
     «Подключение LDAP»      — одно на всё: сервер, Base DN, служебная учётка. Оно же —
                               вход: пользователь ИТ с источником LDAP входит доменным
                               паролем, пока подключение включено; кто входит, решает
                               администратор поимённо в «Пользователях ИТ»;
     «Загрузка сотрудников»  — у каждого учреждения своя: подразделение AD, признак.
   Пароль служебной учётной записи живёт только на сервере: сюда он не приходит
   никогда, а пустое поле при сохранении означает «оставить прежний». */
var adTab = "ldap";
var AD_TABS = ["ldap", "load"];
function adTabShow(){
  AD_TABS.forEach(function(t){ $("a-" + t).hidden = (t !== adTab); });
  document.querySelectorAll("#adTabs button").forEach(function(b){
    b.classList.toggle("on", b.dataset.at === adTab); });
}
document.querySelectorAll("#adTabs button").forEach(function(b){
  b.onclick = function(){ adTab = b.dataset.at; rememberScreen(); renderAll(); };
});

/* ---------- подключение LDAP ---------- */
var lcCfg = null;
function lcStatus(st){
  var el = $("lc_status");
  if(!st){ el.innerHTML = '<span class="badge b-info">Подключение ещё не проверялось</span>'; return; }
  el.innerHTML = (st.ok ? '<span class="badge b-ok">Подключение успешно</span>'
                        : '<span class="badge b-danger">Ошибка подключения</span>') +
    '<span>Последняя проверка: ' + esc(fmtWhen(st.at)) + '</span>' +
    (st.ok ? (st.server ? '<span>' + esc(st.server) + ' · вход как ' + esc(st.bindAs || "") + '</span>' : '')
           : (st.message ? '<span style="color:var(--danger)">' + esc(st.message) + '</span>' : ''));
}
function lcModeWarn(){ $("lc_modeWarn").hidden = $("lc_mode").value !== "plain"; }
$("lc_mode").onchange = function(){
  /* порт по умолчанию меняется вместе с режимом, если его не вписывали руками */
  var p = $("lc_port").value.trim();
  if(!p || p === "389" || p === "636") $("lc_port").value = this.value === "ldaps" ? "636" : "389";
  lcModeWarn();
};
function loadLdapConn(){
  if(!can("ad.view") && !can("ad.sync")) return Promise.resolve();
  return api("/api/ldap/conn").then(function(d){
    lcCfg = d.config || {};
    $("lc_on").checked   = lcCfg.enabled !== false;
    $("lc_server").value = lcCfg.server || "";
    $("lc_port").value   = lcCfg.port ? String(lcCfg.port) : (lcCfg.mode === "ldaps" ? "636" : "389");
    $("lc_mode").value   = lcCfg.mode || "plain";
    $("lc_base").value   = lcCfg.baseDn || "";
    $("lc_ubase").value  = lcCfg.userBase || "";
    $("lc_user").value   = lcCfg.user || "";
    $("lc_cto").value    = lcCfg.connectTimeout || 5000;
    $("lc_oto").value    = lcCfg.opTimeout || 10000;
    $("lc_pass").value   = "";
    $("lc_passHint").textContent = lcCfg.hasPassword
      ? "Пароль сохранён. Оставьте поле пустым, чтобы не менять его."
      : "Пароль не задан.";
    lcModeWarn();
    lcStatus(d.status);
    $("cntAd").textContent = lcCfg.server && lcCfg.enabled !== false ? "✓" : "";
    var adm = isAdmin();
    ["lc_on","lc_server","lc_port","lc_mode","lc_base","lc_ubase","lc_user","lc_pass","lc_cto","lc_oto"]
      .forEach(function(id){ $(id).disabled = !adm; });
    hide("btnLcSave", adm);
    hide("btnLcTest", adm || can("ad.sync"));
    if(!adm) $("lc_err").textContent = "Подключение меняет только администратор.";
  }).catch(function(){});
}
function lcSave(){
  var o = {enabled:$("lc_on").checked, server:$("lc_server").value.trim(),
           port:parseInt($("lc_port").value, 10) || 0, mode:$("lc_mode").value,
           baseDn:$("lc_base").value.trim(), userBase:$("lc_ubase").value.trim(),
           user:$("lc_user").value.trim(),
           connectTimeout:parseInt($("lc_cto").value, 10) || 5000,
           opTimeout:parseInt($("lc_oto").value, 10) || 10000};
  if($("lc_pass").value) o.password = $("lc_pass").value;
  return api("/api/ldap/conn", o);
}
$("btnLcSave").onclick = function(){
  $("lc_err").textContent = "";
  if($("lc_on").checked && !$("lc_server").value.trim()){ $("lc_err").textContent = "Укажите LDAP сервер"; return; }
  $("btnLcSave").disabled = true;
  lcSave().then(function(){ toast("Настройки LDAP сохранены"); return loadLdapConn(); })
    .catch(function(e){ $("lc_err").textContent = "Не удалось сохранить" + apiWhy(e); })
    .then(function(){ $("btnLcSave").disabled = false; });
};
$("btnLcTest").onclick = function(){
  $("lc_err").textContent = "";
  $("btnLcTest").disabled = true; $("btnLcTest").textContent = "Проверяю…";
  api("/api/ldap/conn/test", {}).then(function(d){
    lcStatus(d.check); toast("Подключение работает");
  }).catch(function(e){
    /* поле status ответа занято кодом HTTP — итог проверки приходит в check */
    if(e && e.check) lcStatus(e.check);
    $("lc_err").textContent = "Проверка не прошла" + apiWhy(e);
  }).then(function(){
    $("btnLcTest").disabled = false; $("btnLcTest").textContent = "Проверить подключение";
  });
};

/* ---------- загрузка сотрудников ---------- */
var adCfg = null;
/* Учреждение-получатель. Настройки загрузки у каждого свои, поэтому выбор здесь
   одновременно и «чьи настройки показываем», и «куда попадут люди». */
var adOrg = "";

function adOrgFill(){
  var sel = $("ad_org");
  sel.innerHTML = orgs.map(function(o){
    return '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>'; }).join("");
  if(!adOrg || !orgs.some(function(o){ return o.id === adOrg; })) adOrg = orgId;
  sel.value = adOrg;
  sel.disabled = orgs.length < 2;
  $("ad_orgHint").textContent = orgs.length < 2
    ? "Учреждение одно — сотрудники попадут в него."
    : "Сотрудники, подразделения и отделы попадут именно в выбранное — проверьте перед загрузкой.";
}
$("ad_org").onchange = function(){
  adOrg = $("ad_org").value;
  loadAdLoad();
};

function loadAdLoad(){
  if(!can("ad.sync")) return Promise.resolve();
  adOrgFill();
  return api("/api/ldap?orgId=" + encodeURIComponent(adOrg)).then(function(d){
    adCfg = d.config || {};
    adOrg = d.orgId || adOrg;
    $("ad_org").value = adOrg;
    $("ad_ou").value     = adCfg.ou || "";
    $("ad_sub").checked  = adCfg.subtree !== false;
    $("ad_attr").value   = adCfg.markAttr || "employeeType";
    $("ad_val").value    = adCfg.markValue || "ok";
    $("ad_skip").checked = adCfg.skipDisabled !== false;
    $("ad_connHint").textContent = d.ready
      ? "Ищем внутри Base DN «" + (d.baseDn || "—") + "» — он задаётся на вкладке «Подключение LDAP»."
      : "Сначала настройте и включите подключение на вкладке «Подключение LDAP».";
    var L = d.last;
    $("adLast").textContent = L
      ? ("Последняя загрузка в «" + orgName(adOrg) + "»: " + fmtWhen(L.at) +
         (L.by ? ", " + L.by : "") + " — найдено " + L.found +
         ", добавлено " + L.added + ", обновлено " + L.updated)
      : ("В «" + orgName(adOrg) + "» загрузка из домена ещё не выполнялась.");
  }).catch(function(){});
}

function adPayload(){
  return {orgId:adOrg, ou:$("ad_ou").value.trim(), subtree:$("ad_sub").checked,
          markAttr:$("ad_attr").value.trim() || "employeeType",
          markValue:$("ad_val").value.trim() || "ok", skipDisabled:$("ad_skip").checked};
}
var AD_LABEL = {btnAdSave:"Сохранить настройки", btnAdTest:"Проверить выборку",
                btnAdSync:"Загрузить сотрудников"};
function adBusy(on, who){
  ["btnAdSave","btnAdTest","btnAdSync"].forEach(function(id){
    $(id).disabled = on;
    $(id).textContent = on && id === who ? "Подождите…" : AD_LABEL[id];
  });
}
function adSave(){
  return api("/api/ldap", adPayload()).then(loadAdLoad);
}
function adShow(title, stats, lines){
  $("adResultCard").hidden = false;
  $("adResultTitle").textContent = title;
  $("adStats").innerHTML = stats || "";
  $("adLog").innerHTML = (lines || []).map(function(l){ return "<li>"+esc(l)+"</li>"; }).join("");
}
function adError(e){
  $("ad_err").textContent = "Не удалось связаться с доменом" + apiWhy(e);
}

$("btnAdSave").onclick = function(){
  $("ad_err").textContent = ""; adBusy(true, "btnAdSave");
  adSave().then(function(){ toast("Настройки сохранены"); })
    .catch(adError).then(function(){ adBusy(false); });
};
$("btnAdTest").onclick = function(){
  $("ad_err").textContent = ""; adBusy(true, "btnAdTest");
  adSave().then(function(){ return api("/api/ldap/test", {orgId:adOrg}); }).then(function(d){
    var lines = (d.sample || []).map(function(x){
      return x.name + " · " + (x.position || "должность не указана") +
             " · " + (x.department || "без отдела") + " · " + (x.company || "без организации") +
             (x.email ? " · " + x.email : "");
    });
    if(!lines.length) lines = ["Подключение есть, но по признаку " +
      ($("ad_attr").value.trim() || "employeeType") + " = " + ($("ad_val").value.trim() || "ok") +
      " в этом подразделении не нашлось ни одной учётной записи.",
      "Проверьте: признак стоит у людей (свойства пользователя → «Редактор атрибутов») " +
      "и подразделение указано верно — где искали, видно строкой выше."];
    adShow("Проверка выборки",
           '<div class="note" style="margin:0">Ищем в: <code>' + esc(d.base || "—") +
           '</code><br>Запрос: <code>' + esc(d.filter) + "</code></div>", lines);
    toast("Подключение работает");
  }).catch(adError).then(function(){ adBusy(false); });
};
$("btnAdSync").onclick = function(){
  $("ad_err").textContent = ""; adBusy(true, "btnAdSync");
  adSave().then(function(){ return api("/api/ldap/sync", {orgId:adOrg}); }).then(function(d){
    var t = d.stats || {};
    adShow("Загрузка завершена — " + orgName(adOrg),
      tile("Найдено в домене", t.found || 0) + tile("Добавлено", t.added || 0) +
      tile("Обновлено", t.updated || 0) + tile("Новых подразделений", t.divisions || 0) +
      tile("Новых отделов", t.departments || 0),
      d.log && d.log.length ? d.log : ["Новых сотрудников и справочников не появилось."]);
    toast("Загружено в «" + orgName(adOrg) + "»: " + (t.found || 0));
    return loadState();
  }).catch(adError).then(function(){ adBusy(false); });
};

/* ---------- проверка входа сотрудника ----------
   Кнопка живёт в «Пользователях ИТ»: вкладка подключения — только подключение.
   Логин и пароль — в обычном окне с полем type="password", а не через prompt():
   тот показывает набранное открытым текстом. Итог показывается в том же окне. */
$("btnAaTest").onclick = function(){
  $("aat_login").value = "";
  $("aat_pass").value = "";
  $("aat_err").textContent = ""; $("aat_out").textContent = "";
  $("dlgAaTest").showModal();
  setTimeout(function(){ $("aat_login").focus(); }, 30);
};
$("btnAaTestCancel").onclick = function(){ $("aat_pass").value = ""; $("dlgAaTest").close(); };
$("btnAaTestGo").onclick = function(){
  var lg = $("aat_login").value.trim(), pw = $("aat_pass").value;
  if(!lg){ $("aat_err").textContent = "Укажите доменный логин"; return; }
  if(!pw){ $("aat_err").textContent = "Введите пароль этой учётной записи"; return; }
  $("aat_pass").value = "";      /* в поле пароль не держим дольше нужного */
  $("aat_err").textContent = ""; $("aat_out").textContent = "Проверяю…";
  api("/api/ldap/login-test", {login:lg, password:pw}).then(function(d){
    var w = d.who || {}, s = d.staff, warn = "";
    $("aat_out").textContent = "Домен принял: " + (w.name || "") + " (" + (w.login || "") + ")" +
      (w.position ? ", " + w.position : "") + ".";
    if(!s) warn = "Но войти он не сможет: в «Пользователях ИТ» его нет. Добавьте его там с источником LDAP.";
    else if(s.first) warn = "Это первая учётная запись — она входит только своим паролем.";
    else if(s.auth !== "ad") warn = "В «Пользователях ИТ» «" + s.name + "» заведён со своим паролем. " +
      "Чтобы входил доменным, откройте его и выберите источник LDAP.";
    else if(!s.active) warn = "Учётная запись «" + s.name + "» в приложении отключена.";
    else $("aat_out").textContent += " Войти сможет.";
    $("aat_err").textContent = warn;
  }).catch(function(e){
    $("aat_out").textContent = "";
    $("aat_err").textContent = (e && e.message) ? e.message : ("Проверка не прошла" + apiWhy(e));
  });
};

function loadAd(){
  loadLdapConn();
  return loadAdLoad();
}

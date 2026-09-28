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
  if(!can("ip.manage")) return Promise.resolve();
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

/* ================== Active Directory ==================
   Пароль служебной учётной записи живёт только на сервере: сюда он не приходит
   никогда, а пустое поле при сохранении означает «оставить прежний». */
var adCfg = null;
/* Учреждение-получатель. Настройки домена у каждого свои, поэтому выбор здесь
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
    : "У каждого учреждения свои настройки домена. Сотрудники, подразделения и отделы " +
      "попадут именно в выбранное — проверьте перед загрузкой.";
}
$("ad_org").onchange = function(){
  adOrg = $("ad_org").value;
  loadAd();
};

/* ---------- вход через домен ---------- */
var aaCfg = null;
function loadAdAuth(){
  if(!can("ad.view")) return Promise.resolve();
  return api("/api/adauth").then(function(d){
    aaCfg = d.config || {};
    var orgOpts = orgs.map(function(o){ return '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>'; }).join("");
    $("aa_org").innerHTML = orgOpts; $("aa_neworg").innerHTML = orgOpts;
    $("aa_role").innerHTML = '<option value="">— без роли (только просмотр) —</option>' +
      (cfg.roles||[]).map(function(r){ return '<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>'; }).join("");
    $("aa_on").checked = !!aaCfg.enabled;
    $("aa_org").value = aaCfg.orgId || orgId;
    $("aa_neworg").value = aaCfg.newOrgId || orgId;
    $("aa_suffix").value = aaCfg.suffix || "";
    $("aa_group").value = aaCfg.group || "";
    $("aa_role").value = aaCfg.roleId || "";
    var adm = isAdmin();
    ["aa_on","aa_org","aa_neworg","aa_suffix","aa_group","aa_role"].forEach(function(id){ $(id).disabled = !adm; });
    hide("btnAaSave", adm); hide("btnAaTest", adm); hide("btnAaProbe", adm);
    $("aa_probe").disabled = !adm;
    $("aa_hint").textContent = aaCfg.enabled ? "Вход через домен включён." : "Вход через домен выключен — заходят только по паролям, выданным администратором.";
  }).catch(function(){});
}
function aaBody(){
  return {enabled:$("aa_on").checked, orgId:$("aa_org").value, newOrgId:$("aa_neworg").value,
          suffix:$("aa_suffix").value.trim(), group:$("aa_group").value.trim(), roleId:$("aa_role").value};
}
$("btnAaSave").onclick = function(){
  $("aa_err").textContent = "";
  api("/api/adauth", aaBody()).then(function(){ toast("Сохранено"); return loadAdAuth(); })
    .catch(function(e){ $("aa_err").textContent = "Не удалось сохранить" + apiWhy(e); });
};
/* Раньше логин и пароль спрашивались через prompt(), а он показывает набранное
   открытым текстом — пароль видел любой, кто стоит рядом. Теперь обычное окно
   с полем type="password". */
$("btnAaTest").onclick = function(){
  $("aat_login").value = me ? (me.login || "") : "";
  $("aat_pass").value = "";
  $("aat_err").textContent = "";
  $("dlgAaTest").showModal();
  setTimeout(function(){ $(($("aat_login").value ? "aat_pass" : "aat_login")).focus(); }, 30);
};
$("btnAaTestCancel").onclick = function(){ $("aat_pass").value = ""; $("dlgAaTest").close(); };
$("btnAaTestGo").onclick = function(){
  var lg = $("aat_login").value.trim(), pw = $("aat_pass").value;
  if(!lg){ $("aat_err").textContent = "Укажите доменный логин"; return; }
  if(!pw){ $("aat_err").textContent = "Введите пароль этой учётной записи"; return; }
  $("aat_pass").value = "";      /* в поле пароль не держим дольше нужного */
  $("dlgAaTest").close();
  $("aa_err").textContent = "";
  /* сначала сохраняем: иначе проверка идёт по тому, что набрано на странице,
     и «проверка прошла» при невключённом входе сбивает с толку */
  api("/api/adauth", aaBody())
    .then(function(){ return api("/api/adauth/test", {login:lg, password:pw, config:aaBody()}); })
    .then(function(d){
      var w = d.who || {};
      toast("Домен принял: " + (w.name || w.login));
      var g = d.group, txt = "Проверка прошла: " + (w.name || "") + " (" + (w.login || "") + ")" +
        (w.position ? ", " + w.position : "") + "; групп: " + ((w.groups || []).length) +
        (g && g.dn ? ". Доступ по группе " + g.dn + " — в ней " + (g.members || 0) + " чел."
                   : ". Группа не задана: вход открыт всем, у кого есть учётка в домене.");
      $("aa_hint").textContent = txt;
      var warn = [];
      if(!d.enabled) warn.push("Вход через домен выключен: поставьте галочку «Разрешить вход " +
        "через домен» и нажмите «Сохранить» — иначе на экране входа доменный пароль не примут.");
      if(d.clash) warn.push("Под логином «" + (w.login || "") + "» уже заведена учётная запись с " +
        "паролем от нас (" + d.clash.name + "). Через домен такие не пускаем — откройте её в " +
        "«Пользователях ИТ» и переключите способ входа на «AD».");
      $("aa_err").textContent = warn.join(" ");
      /* loadAdAuth() здесь не зовём: он пишет в aa_hint свою строку и затирает итог
         проверки, а форма и так совпадает с тем, что только что сохранили */
    })
    .catch(function(e){ $("aa_err").textContent = (e && e.message) ? e.message : ("Проверка не прошла" + apiWhy(e)); });
};

/* Разбор «почему этот человек не заходит». Пароль сотрудника не нужен:
   сервер смотрит служебной учёткой, есть ли он в домене, попадает ли под
   корень поиска, включён ли, состоит ли в группе — и отвечает по шагам. */
$("btnAaProbe").onclick = function(){
  var lg = $("aa_probe").value.trim();
  if(!lg){ $("aa_err").textContent = "Укажите доменный логин сотрудника"; return; }
  $("aa_err").textContent = "";
  $("aa_probe_out").textContent = "Проверяю…";
  api("/api/adauth/probe", {login:lg, config:aaBody()}).then(function(d){
    var r = d.probe || {}, lines = [];
    if(r.found){
      lines.push("В домене найден: " + (r.name || lg) + " — " + (r.dn || ""));
      lines.push("Учётка " + (r.enabled ? "включена" : "ОТКЛЮЧЕНА") +
                 ", групп у него " + (r.groups || 0) +
                 ", в корне поиска " + (r.inBase ? "да" : "НЕТ"));
      if(r.groupWant)
        lines.push("Группа доступа: " + (r.group || "не найдена") +
                   (r.group ? " — состоит: " + (r.inGroup ? "да" : "НЕТ") +
                     "; в ней видно " + (r.membersInBase || 0) + " чел. из корня поиска и " +
                     (r.membersInRoot || 0) + " чел. из всего домена" : ""));
    } else {
      lines.push("В домене не найден: " + lg);
    }
    (d.why || []).forEach(function(w){ lines.push("• " + w); });
    $("aa_probe_out").textContent = lines.join("  ");
    $("aa_probe_out").style.color = d.ok ? "" : "var(--danger, #e05555)";
  }).catch(function(e){
    $("aa_probe_out").textContent = "";
    $("aa_err").textContent = (e && e.message) ? e.message : ("Проверка не прошла" + apiWhy(e));
  });
};

function loadAd(){
  loadAdAuth();
  if(!can("ad.sync")) return Promise.resolve();
  adOrgFill();
  return api("/api/ldap?orgId=" + encodeURIComponent(adOrg)).then(function(d){
    adCfg = d.config || {};
    adOrg = d.orgId || adOrg;
    $("ad_org").value = adOrg;
    $("ad_server").value = adCfg.server || "";
    $("ad_base").value   = adCfg.baseDn || "";
    $("ad_user").value   = adCfg.user || "";
    $("ad_ou").value     = adCfg.ou || "";
    $("ad_sub").checked  = adCfg.subtree !== false;
    $("ad_attr").value   = adCfg.markAttr || "employeeType";
    $("ad_val").value    = adCfg.markValue || "ok";
    $("ad_port").value   = adCfg.port ? String(adCfg.port) : "";
    $("ad_ssl").checked  = !!adCfg.useSsl;
    $("ad_skip").checked = adCfg.skipDisabled !== false;
    $("ad_pass").placeholder = adCfg.hasPassword
      ? "пароль сохранён — оставьте пустым, чтобы не менять"
      : "пароль не задан";
    $("cntAd").textContent = adCfg.server ? "✓" : "";
    var L = d.last;
    $("adLast").textContent = L
      ? ("Последняя загрузка в «" + orgName(adOrg) + "»: " + fmtWhen(L.at) +
         (L.by ? ", " + L.by : "") + " — найдено " + L.found +
         ", добавлено " + L.added + ", обновлено " + L.updated)
      : ("В «" + orgName(adOrg) + "» загрузка из домена ещё не выполнялась.");
  }).catch(function(){});
}

function adPayload(){
  var o = {orgId:adOrg,
           server:$("ad_server").value.trim(), baseDn:$("ad_base").value.trim(),
           ou:$("ad_ou").value.trim(), subtree:$("ad_sub").checked,
           user:$("ad_user").value.trim(), markAttr:$("ad_attr").value.trim() || "employeeType",
           markValue:$("ad_val").value.trim() || "ok",
           port:parseInt($("ad_port").value, 10) || 0,
           useSsl:$("ad_ssl").checked, skipDisabled:$("ad_skip").checked};
  if($("ad_pass").value) o.password = $("ad_pass").value;
  return o;
}
function adBusy(on, who){
  ["btnAdSave","btnAdTest","btnAdSync"].forEach(function(id){ $(id).disabled = on; });
  if(who) $(who).textContent = on ? "Подождите…" : AD_LABEL[who];
  else ["btnAdTest","btnAdSync"].forEach(function(id){ $(id).textContent = AD_LABEL[id]; });
}
var AD_LABEL = {btnAdSave:"Сохранить настройки", btnAdTest:"Проверить подключение",
                btnAdSync:"Загрузить сотрудников"};

function adSave(){
  return api("/api/ldap", adPayload()).then(function(){
    $("ad_pass").value = "";
    return loadAd();
  });
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
    .catch(adError).then(function(){ adBusy(false); $("btnAdSave").textContent = AD_LABEL.btnAdSave; });
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
    adShow("Проверка подключения",
           '<div class="note" style="margin:0">Ищем в: <code>' + esc(d.base || "—") +
           '</code><br>Запрос: <code>' + esc(d.filter) + "</code></div>", lines);
    toast("Подключение работает");
  }).catch(adError).then(function(){ adBusy(false); $("btnAdTest").textContent = AD_LABEL.btnAdTest; });
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
  }).catch(adError).then(function(){ adBusy(false); $("btnAdSync").textContent = AD_LABEL.btnAdSync; });
};

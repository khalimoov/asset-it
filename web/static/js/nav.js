/* Навигация: меню, разделы, вкладки, где человек находится.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== навигация ================== */
var VIEWS = ["dash","all","orgs","notices","repairs","dels","reg","sup","ips","docs","transfers","xhist","users","warehouses","ad","staff","roles","divisions","departments","places","models","acttpl"];
var RTABS = ["dash","items","categories","subcategories","types","specs","presets"];

function renderNav(){
  $("regNav").innerHTML = cfg.registries.map(function(r){
    return '<button data-nav="reg:'+esc(r.id)+'"><span class="ico">'+esc(r.icon||"▣")+'</span>'+
      '<span class="nm" title="'+esc(r.name)+(r.builtin?" · заводской раздел":"")+'">'+esc(r.name)+'</span>'+
      '<span class="cnt">'+(r.kind==="supplies" ? cfg.supplies.length : regItems(r.id).length)+'</span></button>';
  }).join("");
  $("cntIps").textContent  = usedIps().length;
  var un = unseenNotices();
  $("cntNotices").textContent = un ? String(un) : "";
  var openRep = cfg.repairs.filter(function(r){ return !r.to; }).length;
  $("cntRepairs").textContent = openRep ? String(openRep) : "";
  $("cntUsers").textContent = cfg.users.length;
  $("cntStaff").textContent = (cfg.staff||[]).length;
  $("cntRoles").textContent = (cfg.roles||[]).length;
  $("navDocs").hidden = !navAllowed("docs");
  $("cntWh").textContent = (cfg.warehouses || []).length || "";
  $("cntActTpl").textContent = acttpls.length ? String(acttpls.length) : "";
  $("cntDocs").textContent = docs.length ? String(docs.length) : "";
  $("cntXfer").textContent = transfers.length ? String(transfers.length) : "";
  $("navAd").hidden = !navAllowed("ad");
  $("navOrgs").hidden = !navAllowed("orgs");
  $("navAll").hidden = !navAllowed("all");
  $("cntOrgs").textContent = orgs.length ? String(orgs.length) : "";
  $("navDels").hidden = !navAllowed("dels");
  $("navXhist").hidden = !navAllowed("xhist");
  $("cntDels").textContent = dels.length ? String(dels.length) : "";
  $("navStaff").hidden = !navAllowed("staff");
  $("navRoles").hidden = !navAllowed("roles");
  $("cntDivs").textContent  = cfg.divisions.length;
  $("cntPlaces").textContent = cfg.places.length || "";
  $("cntModels").textContent = cfg.models.length || "";
  $("cntDeps").textContent  = cfg.departments.length;
  document.querySelectorAll("aside.side button[data-nav]").forEach(function(b){
    var v = b.dataset.nav;
    b.classList.toggle("on", v === (nav==="reg" ? "reg:"+curReg : nav));
    b.onclick = function(){ go(v); };
  });
}
/* смена раздела: сбрасываем фильтры и выбор области характеристик — они хранят чужие id */
function resetRegState(){
  curSpecScope = "";
  ["fCat","fSub","fType","fStatus","fDiv","fDep","fAttach"].forEach(function(id){ $(id).value = ""; });
  $("q").value = "";
}
function openReg(id, tab){
  if(id !== curReg){ curReg = id; resetRegState(); }
  setTimeout(rememberScreen, 0);
  nav = "reg"; if(tab) regTab = tab;
  renderAll();
}
/* Разделы, закрытые правами, не просто прячем — в них нельзя войти вовсе,
   иначе сотрудник правит форму и получает отказ только при сохранении. */
/* Закрытых страниц немного: пользователи ИТ и роли, AD, журнал удалений и
   «Все учреждения». Остальное видят все — права нужны, чтобы править. */
var NAV_PERM = {staff:"staff.view", roles:"staff.view", dels:"deletions.view", ad:"ad.view"};
function navAllowed(v){
  /* сводка по всем учреждениям — начальнику отдела, а не только администратору */
  if(v === "all") return !!(me && me.seesAllOrgs);
  var need = NAV_PERM[v];
  return !need || can(need);
}
/* Где человек находится — помним на время вкладки. Обновление страницы
   должно оставлять его на том же экране; «Общий дашборд» — только при входе,
   поэтому при входе эта память очищается. */
function rememberScreen(){
  try{ sessionStorage.setItem("it_inv_screen",
    JSON.stringify({nav:nav, reg:curReg, tab:regTab, sup:supTab})); }catch(e){}
}
/* Адреса разделов. Страница одна, но у каждого раздела свой адрес: обновил —
   остался на месте, ссылку можно переслать коллеге, «назад» в браузере
   возвращает на прошлый раздел. Сервер на любой из этих адресов отдаёт ту же
   страницу — список первых частей продублирован в app.py (SPA_ROUTES). */
var ROUTES = {dash:"", all:"overview", orgs:"orgs", notices:"notices", repairs:"repairs",
  dels:"deletions", xhist:"transfer-history", ips:"ips", docs:"invoices", transfers:"transfers",
  users:"employees", warehouses:"warehouses", ad:"ad", staff:"it-staff", roles:"roles",
  divisions:"divisions", departments:"departments", places:"places", models:"models",
  acttpl:"act-templates"};
var SUP_ROUTES = {stock:"fact", wh:"warehouse", receipts:"receipts"};
/* файлом (стенд) адресов нет — там по-прежнему работает память вкладки */
var urlOn = /^https?:$/.test(location.protocol) && !!(window.history && history.pushState);
var urlReplace = true;        /* первый показ и «назад/вперёд»: адрес не добавляем в историю */

function screenPath(){
  if(nav === "reg"){
    var p = "/reg/" + encodeURIComponent(curReg);
    if(isSupplyReg(curReg)) return p + "/" + (SUP_ROUTES[supTab] || SUP_ROUTES.stock);
    return regTab && regTab !== "items" ? p + "/" + regTab : p;
  }
  return "/" + (ROUTES[nav] || "");
}
function parsePath(path){
  var parts = String(path || "/").replace(/^\/+|\/+$/g, "").split("/");
  try{ parts = parts.map(decodeURIComponent); }catch(e){ return null; }
  if(!parts[0]) return {nav:"dash"};
  if(parts[0] === "reg" && parts[1] && parts.length <= 3){
    var v = {nav:"reg", reg:parts[1], tab:"", sup:""};
    if(parts[2]){
      Object.keys(SUP_ROUTES).forEach(function(k){ if(SUP_ROUTES[k] === parts[2]) v.sup = k; });
      if(!v.sup){
        if(RTABS.indexOf(parts[2]) === -1) return null;
        v.tab = parts[2];
      }
    }
    return v;
  }
  if(parts.length > 1) return null;
  var hit = null;
  Object.keys(ROUTES).forEach(function(k){ if(ROUTES[k] === parts[0]) hit = k; });
  return hit ? {nav:hit} : null;
}
/* Открывает то, что записано в адресе. Раздела нет или он закрыт правами — false. */
function applyScreen(v){
  if(!v) return false;
  if(v.nav === "reg"){
    if(!cfg.registries.some(function(r){ return r.id === v.reg; })) return false;
    if(v.reg !== curReg){ curReg = v.reg; resetRegState(); }
    if(isSupplyReg(curReg)){ if(v.sup) supTab = v.sup; }
    else regTab = v.tab || "items";
  } else if(VIEWS.indexOf(v.nav) === -1 || !navAllowed(v.nav)){
    return false;
  }
  nav = v.nav;
  return true;
}
/* После каждой отрисовки адрес догоняет экран. Переход — новая запись в
   истории браузера; первый показ и «назад/вперёд» — замена, без новой записи. */
function syncUrl(){
  if(!urlOn || !me) return;
  /* во вкладке браузера и в истории видно, какой это раздел */
  document.title = ($("ttl").textContent ? $("ttl").textContent + " — " : "") + "Учёт ИТ-отдела";
  var p = screenPath();
  if(p !== location.pathname){
    try{
      if(urlReplace) history.replaceState(null, "", p);
      else history.pushState(null, "", p);
    }catch(e){}
  }
  urlReplace = false;
}
window.addEventListener("popstate", function(){
  if(!urlOn || !me) return;
  if(!applyScreen(parsePath(location.pathname))) nav = "dash";
  urlReplace = true;
  rememberScreen();
  renderAll();
});

function restoreScreen(){
  /* адрес важнее памяти вкладки: по нему человек и пришёл. Раздела из адреса
     нет (удалили, опечатка) или он закрыт правами — дашборд, а не случайный
     прошлый экран из памяти вкладки. */
  if(urlOn){
    if(applyScreen(parsePath(location.pathname))) return;
    nav = "dash";
    toast("Такого раздела нет или он закрыт — открыт дашборд");
    return;
  }
  var v = null;
  try{ v = JSON.parse(sessionStorage.getItem("it_inv_screen") || "null"); }catch(e){}
  if(!v || !v.nav) return;
  if(VIEWS.indexOf(v.nav) === -1 || !navAllowed(v.nav)) return;
  if(v.reg && cfg.registries.some(function(r){ return r.id === v.reg; })) curReg = v.reg;
  if(v.tab && RTABS.indexOf(v.tab) !== -1) regTab = v.tab;
  if(v.sup) supTab = v.sup === "issued" ? "stock" : v.sup;
  nav = v.nav;
}
function forgetScreen(){
  try{ sessionStorage.removeItem("it_inv_screen"); }catch(e){}
}

function go(v){
  if(v.indexOf("reg:")===0){ openReg(v.slice(4)); return; }
  if(!navAllowed(v)){ toast("Раздел закрыт: нет прав"); return; }
  nav = v; rememberScreen(); renderAll();
}
function goTab(t){ regTab = t; rememberScreen(); renderAll(); }
document.querySelectorAll("#regTabs button").forEach(function(b){
  b.onclick = function(){ goTab(b.dataset.rt); };
});
document.querySelectorAll("#supTabs button").forEach(function(b){
  b.onclick = function(){ supTab = b.dataset.st; renderAll(); };
});

function render(){
  if(!navAllowed(nav)) nav = "dash";
  var cur = nav;
  if(nav==="reg") cur = isSupplyReg(curReg) ? "sup" : "reg";
  if(cur==="reg"){
    var L = regLayout(curReg);
    var vis = {dash:L.dash, items:true, categories:true, subcategories:L.subs,
               types:true, specs:L.specs, presets:L.presets};
    RTABS.forEach(function(t){
      var b = document.querySelector('#regTabs button[data-rt="'+t+'"]');
      if(b) b.hidden = !vis[t];
    });
    if(!vis[regTab]) regTab = "items";
    document.body.classList.toggle("nosubs", !L.subs);
    $("specBox").hidden = !L.specs;
  }
  if(cur!=="reg") document.body.classList.remove("nosubs");
  applyPerms();
  VIEWS.forEach(function(v){ $("v-"+v).hidden = (v !== cur); });
  RTABS.forEach(function(t){ $("r-"+t).hidden = (cur!=="reg" || t !== regTab); });
  document.querySelectorAll("#regTabs button").forEach(function(b){ b.classList.toggle("on", b.dataset.rt===regTab); });
  $("s-stock").hidden    = !(cur==="sup" && supTab==="stock");
  $("s-receipts").hidden = !(cur==="sup" && supTab==="receipts");
  $("s-wh").hidden       = !(cur==="sup" && supTab==="wh");
  document.querySelectorAll("#supTabs button").forEach(function(b){ b.classList.toggle("on", b.dataset.st===supTab); });
  $("topActions").hidden = !((cur==="reg" && regTab==="items") || cur==="sup" ||
                             cur==="dash" || cur==="ips" || cur==="repairs" || cur==="dels");
  /* импорт есть только там, куда его осмысленно грузить */
  $("btnImport").hidden = (cur==="dash") || (cur==="ips") || (cur==="repairs") ||
                          (cur==="dels") || (cur==="sup" && supTab!=="stock");
  var TT = {dash:["Общий дашборд","Сводка по всем разделам учёта"],
            notices:["Уведомления","События по ремонту оборудования"],
            repairs:["Ремонты","Что поступало в ремонт, по какой причине и сколько пробыло"],
            dels:["История удалений","Кто, когда и зачем удалил запись — вместе со снимком карточки"],
            xhist:["История передач","Что, когда и кем передавалось между складами — с накладной и без"],
            ips:["IP-адреса","Занятые и зарезервированные адреса по всем разделам"],
            users:["Сотрудники","Общий справочник сотрудников"],
            docs:["Приходные накладные","Скан накладной разбирается на строки и заводится в учёт"],
            transfers:["Накладные по передаче","Что и когда переходило с одного склада на другой; передача делается в карточке"],
            warehouses:["Склады","Номер склада приходит из накладной и хранится в карточке"],
            acttpl:["Шаблоны актов","По ним оформляется АКТ на списание материалов; у каждого учреждения свои"],
            all:["Все учреждения","Сводка по всем сразу: техника, ремонты, люди"],
            orgs:["Учреждения","Каждое ведёт свой учёт; доступ выдаёт администратор"],
            ad:["Active Directory","Сотрудники, подразделения и отделы приходят из домена"],
            staff:["Пользователи ИТ","Кто обслуживает технику; мастера видны при статусе «В ремонте»"],
            roles:["Роли и доступ","Наборы прав, которые назначаются сотрудникам"],
            divisions:["Подразделения","Общий справочник"],
            departments:["Отделы","Общий справочник"],
            places:["Место","Кабинеты, серверные, посты — за ними закрепляют технику без ответственного"],
            models:["Модели","Справочник моделей с фото; в карточке модель выбирается перед типом"]};
  if(nav==="reg"){
    var r = reg();
    $("ttl").textContent = r.name;
    $("subttl").textContent = r.kind==="supplies"
      ? "Приход материалов, списание на сотрудников и установка в оборудование"
      : "Категории → подкатегории → типы, характеристики и записи раздела";
  } else {
    $("ttl").textContent = TT[nav][0];
    $("subttl").textContent = TT[nav][1];
  }
  renderNav();
  syncUrl();
}

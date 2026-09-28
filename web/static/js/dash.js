/* Общий дашборд.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== общий дашборд ================== */
function tile(label, value, drill){
  return '<div class="stat'+(drill?' clickable" data-drill="'+esc(drill):'')+'">'+
    '<b>'+value+'</b><span title="'+esc(label)+'">'+esc(label)+'</span></div>';
}
function barRow(name, count, total, attr){
  var pct = total ? Math.round(count*100/total) : 0;
  return '<tr'+(attr ? ' class="pick" '+attr+' title="открыть карточку"' : '')+'>'+
    cellText(name)+'<td>'+count+'</td>'+
    '<td><div class="bar" title="'+pct+'%"><i style="width:'+pct+'%"></i></div></td></tr>';
}
function renderDash(){
  if(scopeWide()) return renderDashWide();
  $("dashRegsTitle").textContent = "Разделы учёта";
  var assets = assetItems(), total = assets.length;
  var onStock = cfg.supplies.reduce(function(a,m){ return a + Math.max(0, stockLeft(m)); }, 0);
  $("dashStats").innerHTML =
    tile("Всего оборудование", total, "all") +
    tile("В эксплуатации", assets.filter(function(i){ return i.status===ST_USE; }).length, "inuse") +
    tile("В ремонте", assets.filter(function(i){ return i.status===ST_REPAIR; }).length, "repair") +
    tile("Материалов на складе", onStock, "stock") +
    tile("Списаний материалов", cfg.issues.length, "issues") +
    tile("Занятых IP", usedIps().length, "ips");
  $("dashRegs").innerHTML = cfg.registries.map(function(r){
    var sup = r.kind==="supplies";
    var cnt = sup ? cfg.supplies.length : regItems(r.id).length;
    var pct = (!sup && total) ? Math.round(cnt*100/total) : 0;
    return '<tr class="pick" data-reg="'+esc(r.id)+'">'+
      '<td title="'+esc(r.name)+'">'+esc(r.icon||"▣")+' '+esc(r.name)+
        (sup?' <span class="chip">материалы</span>':'')+'</td>'+
      '<td>'+cnt+'</td>'+
      '<td>'+(sup ? '<span class="chip">вне подсчёта оборудования</span>'
                  : '<div class="bar" title="'+pct+'%"><i style="width:'+pct+'%"></i></div>')+'</td>'+
      '<td class="act col-adm"><button class="ic js-cfgreg" title="Настройки раздела">⚙</button>'+
        (r.builtin
          ? '<button class="ic" disabled title="Заводской раздел — удалить нельзя">✕</button>'
          : '<button class="ic btn-danger js-delreg" title="Удалить раздел">✕</button>')+'</td></tr>';
  }).join("");
  var divs = cfg.divisions.map(function(d){
    return {id:d.id, name:d.name, cnt:assets.filter(function(i){ return i.division===d.id; }).length};
  }).sort(function(a,b){ return b.cnt-a.cnt; });
  $("dashDivs").innerHTML = divs.map(function(d){
    return barRow(d.name, d.cnt, total, 'data-div="'+esc(d.id)+'"'); }).join("");
  $("dashDivsEmpty").hidden = divs.length>0;
}
/* Дашборд по нескольким учреждениям: разделов у каждого свои, поэтому
   вместо списка разделов показываем сами учреждения. */
function renderDashWide(){
  var assets = scopePick(cross.items);
  var total = assets.length;
  var byStatus = function(st){
    return assets.filter(function(i){ return i.status === st; }).length; };
  var openRep = scopePick(cross.repairs).filter(function(r){ return !r.to; }).length;

  $("dashStats").innerHTML =
    tile("Всего оборудование", total, "all") +
    tile("В эксплуатации", byStatus(ST_USE), "inuse") +
    tile("В ремонте", byStatus(ST_REPAIR), "repair") +
    tile("Готово к эксплуатации", byStatus(ST_READY)) +
    tile("Списано", byStatus(ST_OFF)) +
    tile("Открытых ремонтов", openRep);

  /* Карточки те же, что и в обычном режиме: разделы и подразделения.
     Одноимённые разделы разных учреждений складываем — названия у них общие. */
  $("dashRegsTitle").textContent = "Разделы учёта";
  var groups = {}, order = [];
  assets.forEach(function(i){
    var nm = i.regName || "без раздела";
    if(!groups[nm]){ groups[nm] = {cnt:0, use:0, rep:0}; order.push(nm); }
    groups[nm].cnt++;
    if(i.status === ST_USE) groups[nm].use++;
    if(i.status === ST_REPAIR) groups[nm].rep++;
  });
  order.sort(function(a,b){ return groups[b].cnt - groups[a].cnt; });
  $("dashRegs").innerHTML = order.map(function(nm){
    var g = groups[nm], pct = total ? Math.round(g.cnt*100/total) : 0;
    return '<tr class="pick" data-regn="'+esc(nm)+'" title="открыть карточку"><td title="'+esc(nm)+'">'+esc(nm)+
      ' <span class="chip">в работе '+g.use+'</span>'+
      (g.rep ? ' <span class="chip">в ремонте '+g.rep+'</span>' : '')+'</td>'+
      '<td>'+g.cnt+'</td>'+
      '<td><div class="bar" title="'+pct+'%"><i style="width:'+pct+'%"></i></div></td>'+
      '<td class="act col-adm"></td></tr>';
  }).join("");

  var divs = {}, dorder = [];
  assets.forEach(function(i){
    var nm = i.divName || "без подразделения";
    if(divs[nm] === undefined){ divs[nm] = 0; dorder.push(nm); }
    divs[nm]++;
  });
  dorder.sort(function(a,b){ return divs[b] - divs[a]; });
  $("dashDivs").innerHTML = dorder.map(function(nm){
    return barRow(nm, divs[nm], total, 'data-divn="'+esc(nm)+'"'); }).join("");
  $("dashDivsEmpty").hidden = dorder.length > 0;
}

function drillRegSummary(list){
  if(scopeWide()){
    /* смотрим несколько учреждений — сводка нужна по ним, а не по разделам */
    var byOrg = {}, ord = [];
    list.forEach(function(i){
      var nm = i.orgName || "—";
      if(byOrg[nm] === undefined){ byOrg[nm] = 0; ord.push(nm); }
      byOrg[nm]++;
    });
    ord.sort(function(a,b){ return byOrg[b] - byOrg[a]; });
    return miniTable(["Учреждение","Позиций"],
                     ord.map(function(nm){ return [nm, byOrg[nm]]; }), "");
  }
  var by = {};
  list.forEach(function(i){ var k = rid(i); by[k] = (by[k]||0) + 1; });
  var rows = cfg.registries.filter(function(r){ return by[r.id]; })
    .map(function(r){ return [(r.icon||"▣")+" "+r.name, by[r.id]]; });
  if(!rows.length) return "";
  return miniTable(["Раздел","Позиций"], rows, "");
}
/* Карточка раздела или подразделения: сверху статусы чипами, ниже список. */
function drillStatusChips(list){
  var by = {}, ord = [];
  list.forEach(function(i){
    var st = i.status || "—";
    if(by[st] === undefined){ by[st] = 0; ord.push(st); }
    by[st]++;
  });
  if(!ord.length) return "";
  ord.sort(function(a,b){ return by[b] - by[a]; });
  return '<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">'+
    ord.map(function(st){ return '<span class="chip">'+esc(st)+': <b>'+by[st]+'</b></span>'; }).join("")+
    '</div>';
}
function drillSort(list){
  var wide = scopeWide();
  var keyOf = function(x){
    return (wide ? (x.orgName||"") : "") + "|" +
           (wide ? (x.regName||"") : ((reg(rid(x))||{}).name||"")) + "|" + (x.inv||"");
  };
  return list.slice().sort(function(a,b){
    var ka = keyOf(a), kb = keyOf(b);
    return ka<kb?-1:ka>kb?1:0;
  });
}
function drillItems(list, repair){
  if(!list.length) return '<div class="note">Пока пусто.</div>';
  /* В широком режиме первой колонкой идёт учреждение: иначе строки разных
     заводов в одном списке не различить. */
  var wide = scopeWide();
  var tail = repair
    ? ["Инв. номер","Тип","Мастер","Отправлен","Дней","Примечание"]
    : ["Инв. номер","Тип","Статус","Сотрудник","Подразделение"];
  var head = (wide ? ["Учреждение","Раздел"] : ["Раздел"]).concat(tail);
  var rows = list.map(function(i){
    var rn = wide ? (i.regName || "") : ((reg(rid(i))||{}).name || "");
    var pre = wide ? [i.orgName || "", rn] : [rn];
    var tn = wide ? (i.typeName || "") : (typeName(i.type) || "");
    return pre.concat(repair
      ? [i.inv||"", tn, staffName(i.masterId)||"— не назначен —",
         fmtDate(i.statusDate)||"—", daysBetween(i.statusDate, ""), i.statusNote||""]
      : [i.inv||"", tn, i.status||"",
         wide ? (i.ownerName||"") : (ownerName(i.owner)||""),
         wide ? (i.divName||"") : (nameById("divisions", i.division)||"")]);
  });
  /* карточку чужого учреждения открыть нельзя: её данных в памяти нет */
  return miniTable(head, rows, "", wide ? null : list.map(function(i){ return i.id; }));
}
function openDrill(key){
  var wide = scopeWide();
  var assets = wide ? scopePick(cross.items) : assetItems();
  var title = "", summary = "", body = "", go = "";
  if(key.indexOf("reg:")===0){
    /* карточка раздела учёта (клик по строке дашборда) */
    var rr = cfg.registries.find(function(x){ return x.id===key.slice(4); });
    if(!rr) return;
    if(rr.kind==="supplies"){
      var mats2 = cfg.supplies.slice()
        .sort(function(a,b){ return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; });
      title = (rr.icon||"▣")+" "+rr.name+" — "+mats2.length;
      summary = '<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">'+
        '<span class="chip">На складе: <b>'+mats2.reduce(function(a,m){ return a+Math.max(0,stockLeft(m)); }, 0)+'</b></span>'+
        '<span class="chip">Выдано: <b>'+cfg.issues.length+'</b></span></div>';
      body = miniTable(["Материал","Единица","Поступило","Выдано","Остаток"],
        mats2.map(function(m){ return [m.name, m.unit||"шт", m.qty||0, issuedCount(m.id), stockLeft(m)]; }),
        "Материалы пока не заведены.");
    } else {
      var rl = drillSort(regItems(rr.id));
      title = (rr.icon||"▣")+" "+rr.name+" — "+rl.length;
      summary = drillStatusChips(rl);
      body = drillItems(rl, false);
    }
    go = rr.id;
  }
  else if(key.indexOf("regn:")===0){
    var rn = key.slice(5);
    var rl2 = drillSort(assets.filter(function(i){ return (i.regName || "без раздела")===rn; }));
    title = rn+" — "+rl2.length;
    summary = drillStatusChips(rl2) + drillRegSummary(rl2);
    body = drillItems(rl2, false);
  }
  else if(key.indexOf("div:")===0){
    var dv = byId("divisions", key.slice(4)); if(!dv) return;
    var dl = drillSort(assets.filter(function(i){ return i.division===dv.id; }));
    title = dv.name+" — "+dl.length;
    summary = drillStatusChips(dl) + drillRegSummary(dl);
    body = drillItems(dl, false);
  }
  else if(key.indexOf("divn:")===0){
    var dn = key.slice(5);
    var dl2 = drillSort(assets.filter(function(i){ return (i.divName || "без подразделения")===dn; }));
    title = dn+" — "+dl2.length;
    summary = drillStatusChips(dl2) + drillRegSummary(dl2);
    body = drillItems(dl2, false);
  }
  else if(key==="all" || key==="inuse" || key==="repair"){
    var list = key==="all" ? assets
      : assets.filter(function(i){ return i.status === (key==="inuse" ? ST_USE : ST_REPAIR); });
    var sortKeyOf = function(x){
      return (wide ? (x.orgName||"") : "") + "|" +
             (wide ? (x.regName||"") : ((reg(rid(x))||{}).name||"")) + "|" + (x.inv||"");
    };
    list = list.slice().sort(function(a,b){
      var ka = sortKeyOf(a), kb = sortKeyOf(b);
      return ka<kb?-1:ka>kb?1:0;
    });
    title = (key==="all" ? "Всё оборудование" : key==="inuse" ? "В эксплуатации" : "В ремонте") +
            " — " + list.length;
    summary = drillRegSummary(list);
    body = drillItems(list, key==="repair");
  }
  else if(key==="stock"){
    var mats = cfg.supplies.filter(function(m){ return stockLeft(m) > 0; })
      .sort(function(a,b){ return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; });
    title = "Материалы на складе — " + mats.reduce(function(a,m){ return a+stockLeft(m); }, 0);
    body = miniTable(["Материал","Единица","Поступило","Выдано","Остаток"],
      mats.map(function(m){ return [m.name, m.unit||"шт", m.qty||0, issuedCount(m.id), stockLeft(m)]; }),
      "На складе пусто.");
  }
  else if(key==="issues"){
    var iss = cfg.issues.slice().sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); });
    title = "Списания материалов — " + iss.length;
    body = miniTable(["Дата","Материал","Кол-во","Кому","Примечание"],
      iss.map(function(x){
        var m = supplyById(x.supplyId)||{};
        return [fmtDate(x.date), m.name||"", x.qty||1, issueTarget(x).name||"", x.note||""];
      }), "Списаний не было.");
  }
  else if(key==="ips"){
    var used = usedIps().slice().sort(function(a,b){ return ipSort(a.ip,b.ip); });
    title = "Занятые IP-адреса — " + used.length;
    body = miniTable(["IP-адрес","Раздел","Сотрудник","Инв. номер","Тип"],
      used.map(function(u){
        var it = u.item;
        return [u.ip, (reg(rid(it))||{}).name||"", ownerName(it.owner)||"", it.inv||"", typeName(it.type)||""];
      }), "Занятых адресов нет.");
  }
  $("drillTitle").textContent = title;
  $("drillSummary").innerHTML = summary;
  $("drillBody").innerHTML = body;
  $("btnDrillGo").hidden = !go;
  $("btnDrillGo").onclick = function(){ $("dlgDrill").close(); openReg(go, "items"); };
  $("dlgDrill").showModal();
}
$("btnDrillClose").onclick = function(){ $("dlgDrill").close(); };
$("dashDivs").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-div],tr[data-divn]"); if(!tr) return;
  openDrill(tr.dataset.div ? "div:"+tr.dataset.div : "divn:"+tr.dataset.divn);
});
$("dashStats").addEventListener("click", function(e){
  var el = e.target.closest("[data-drill]"); if(!el) return;
  openDrill(el.dataset.drill);
});

$("dashRegs").addEventListener("click", function(e){
  var wtr = e.target.closest("tr[data-regn]");
  if(wtr){ openDrill("regn:"+wtr.dataset.regn); return; }
  var tr = e.target.closest("tr[data-reg]"); if(!tr) return;
  var r = cfg.registries.find(function(x){ return x.id===tr.dataset.reg; }); if(!r) return;
  if(e.target.classList.contains("js-cfgreg")){ openRegDlg(r); return; }
  if(e.target.classList.contains("js-delreg")){ deleteRegistry(r); return; }
  openDrill("reg:"+r.id);
});

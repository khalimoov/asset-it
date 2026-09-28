/* IP-адреса: пулы, сетка, карточка адреса, резерв.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== IP-адреса ================== */
function poolById(id){ return cfg.ipPools.find(function(x){ return x.id===id; }) || null; }
function poolOptions(sel){
  return '<option value="">— по назначению пула —</option>' + cfg.ipPools.map(function(x){
    return '<option value="'+esc(x.id)+'"'+(x.id===sel?' selected':'')+'>'+
      esc(x.name)+' ('+esc(x.prefix)+'x) — '+esc(poolTargetText(x))+'</option>';
  }).join("");
}
function poolLabel(id){ var x = poolById(id); return x ? x.name+" ("+x.prefix+"x)" : "—"; }
function regOptions(sel, empty){
  return '<option value="">'+esc(empty)+'</option>' +
    cfg.registries.filter(function(r){ return r.kind!=="supplies"; }).map(function(r){
      return '<option value="'+esc(r.id)+'"'+(r.id===sel?' selected':'')+'>'+esc(r.name)+'</option>';
    }).join("");
}
function catOptionsOf(regId, sel, empty){
  return '<option value="">'+esc(empty)+'</option>' +
    regCats(regId).map(function(c){
      return '<option value="'+esc(c.id)+'"'+(c.id===sel?' selected':'')+'>'+esc(c.name)+'</option>';
    }).join("");
}
/* все пулы, подходящие характеристике: явная привязка, затем пулы категории и раздела */
function poolsForSpec(sp){
  if(!sp || sp.kind!=="ip") return [];
  var out = [];
  if(sp.poolId){ var one = poolById(sp.poolId); if(one) out.push(one); }
  var catId = $("f_cat") ? $("f_cat").value : "";
  var byCat = [], byReg = [];
  cfg.ipPools.forEach(function(x){
    if(out.indexOf(x) !== -1) return;          /* привязанный уже первый в списке */
    if(x.registryId !== curReg) return;
    if(x.categoryId){ if(x.categoryId === catId) byCat.push(x); }
    else byReg.push(x);
  });
  return out.concat(byCat, byReg);
}
function poolForSpec(sp){ return poolsForSpec(sp)[0] || null; }
/* пул, выбранный в самом поле (когда диапазонов несколько) */
function chosenPool(sp){
  var sel = document.querySelector('#specFields [data-poolsel="'+sp.id+'"]');
  if(sel && sel.value) return poolById(sel.value);
  return poolForSpec(sp);
}
function poolTargetText(x){
  var r = cfg.registries.find(function(y){ return y.id===x.registryId; });
  if(!r) return "любой раздел";
  var c = x.categoryId ? nameById("categories", x.categoryId) : "";
  return r.name + (c ? " · "+c : "");
}
function normPrefix(v){
  v = String(v||"").trim().replace(/\.+$/,"");
  return v ? v+"." : "";
}
function validPrefix(pre){
  var m = String(pre||"").replace(/\.$/,"").split(".");
  if(m.length!==3) return false;
  return m.every(function(x){ return /^\d{1,3}$/.test(x) && Number(x)<=255; });
}
function poolOfIp(ip){
  ip = String(ip||"").trim();
  return cfg.ipPools.find(function(x){
    if(!x.prefix || ip.indexOf(x.prefix)!==0) return false;
    return /^\d{1,3}$/.test(ip.slice(x.prefix.length));
  }) || null;
}
function ipSort(a,b){
  var pa = String(a).split("."), pb = String(b).split(".");
  for(var i=0;i<4;i++){ var d = (parseInt(pa[i],10)||0) - (parseInt(pb[i],10)||0); if(d) return d; }
  return 0;
}
/* поле считается адресом, если это вид «IP-адрес» либо в нём лежит настоящий IPv4
   (так подхватываются характеристики, заведённые когда-то как обычный текст) */
function looksLikeIp(sp, v){
  if(sp.kind==="ip") return true;
  if(!RE_IP.test(v)) return false;
  return !!sp.uniq || /ip|адрес/i.test(sp.name||"");
}
function usedIps(){
  var out = [];
  items.forEach(function(it){
    specsOf(it.type).forEach(function(sp){
      if(it.specsNone && it.specsNone[sp.id]) return;
      var v = it.specs && it.specs[sp.id]; if(!v) return;
      v = String(v).trim();
      if(!RE_IP.test(v) || !looksLikeIp(sp, v)) return;
      out.push({ip:v, item:it, spec:sp});
    });
  });
  return out;
}
/* Как подписать резерв: имя из ручных данных, иначе примечание */
function resLabel(r){ return (r && (r.name || r.note)) || ""; }
function ipIndex(){
  var m = {};
  usedIps().forEach(function(u){
    if(!m[u.ip]) m[u.ip] = {ip:u.ip, list:[], res:null};
    m[u.ip].list.push(u);
  });
  cfg.ipReserved.forEach(function(r){
    if(!m[r.ip]) m[r.ip] = {ip:r.ip, list:[], res:null};
    m[r.ip].res = r;
  });
  return m;
}
function poolCounts(x, idx){
  var cap = Math.max(0, (x.to|0)-(x.from|0)+1), busy = 0, res = 0;
  for(var h=(x.from|0); h<=(x.to|0); h++){
    var e = idx[x.prefix+h]; if(!e) continue;
    if(e.list.length) busy++; else if(e.res) res++;
  }
  return {cap:cap, busy:busy, res:res, free:Math.max(0, cap-busy-res)};
}

var IP_BASE = [
  {k:"ip",     t:"IP-адрес"},
  {k:"host",   t:"Последний октет"},
  {k:"pool",   t:"Пул"},
  {k:"regName",t:"Раздел"},
  {k:"owner",  t:"Сотрудник"},
  {k:"div",    t:"Подразделение"},
  {k:"dep",    t:"Отдел"},
  {k:"inv",    t:"Инвентарный номер"},
  {k:"type",   t:"Тип"},
  {k:"status", t:"Статус"},
  {k:"src",    t:"Источник"},
  {k:"note",   t:"Примечание"}
];
var IP_BASE_DEF = ["ip","pool","owner","inv","type"];
function hostOf(ip){ var x = String(ip||"").split("."); return x.length===4 ? x[3] : ""; }
/* значение характеристики по её названию — у разных разделов поля называются одинаково */
function specValueByName(it, name){
  if(!it) return "";
  var nm = String(name||"").trim().toLowerCase(), list = specsOf(it.type);
  for(var i=0;i<list.length;i++){
    if(String(list[i].name||"").trim().toLowerCase()===nm) return specVal(it, list[i]);
  }
  return "";
}
function ipExportRows(scoped){
  var idx = ipIndex(), out = [];
  Object.keys(idx).forEach(function(k){
    var e = idx[k], pl = poolOfIp(k);
    if(scoped){
      if(curPool==="none"){ if(pl) return; }
      else if(!pl || pl.id!==curPool) return;
    }
    e.list.forEach(function(u){
      var it = u.item, r = reg(rid(it)) || {};
      out.push({ip:k, host:hostOf(k), pool:pl?pl.name:"", regName:r.name||"",
        owner:ownerName(it.owner), div:nameById("divisions", it.division),
        dep:nameById("departments", it.department), inv:it.inv||"", type:typeName(it.type),
        status:it.status||"", src:"запись", note:it.notes||"", item:it});
    });
    if(e.res) out.push({ip:k, host:hostOf(k), pool:pl?pl.name:"", regName:"резерв",
      owner:ownerName(e.res.owner), div:nameById("divisions", e.res.divisionId),
      dep:nameById("departments", e.res.departmentId), inv:"", type:e.res.kind||"",
      status:"резерв", src:"резерв",
      note:[e.res.name, e.res.os, e.res.host, e.res.note].filter(Boolean).join(" · "), item:null});
  });
  out.sort(function(a,b){ return ipSort(a.ip, b.ip); });
  var q = scoped ? $("qIp").value.trim().toLowerCase() : "";
  if(q) out = out.filter(function(r){
    return [r.ip,r.pool,r.regName,r.owner,r.inv,r.type,r.note].join(" ").toLowerCase().indexOf(q)!==-1; });
  return out;
}
function specNames(){
  var names = [];
  cfg.specs.forEach(function(sp){
    var nm = String(sp.name||"").trim();
    if(nm && names.indexOf(nm)===-1) names.push(nm);
  });
  return names.sort(function(a,b){ return a.toLowerCase()<b.toLowerCase()?-1:1; });
}
var IP_LABELS = [
  {k:"host",    t:"Имя хоста"},
  {k:"owner",   t:"Сотрудник"},
  {k:"inv",     t:"Инвентарный номер"},
  {k:"type",    t:"Тип"},
  {k:"regName", t:"Раздел"},
  {k:"busy",    t:"Занят / свободен"}
];
/* Как подписать адрес по данным опроса: имя хоста, а если его нет —
   производитель по MAC. У камер и коммутаторов имени обычно нет вовсе,
   зато производитель известен почти всегда. */
function netName(ip){
  var ns = netOf(ip) || {};
  return ns.hostName || ns.vendor || "";
}
function labelTitle(key){
  if(key.indexOf("spec:")===0) return key.slice(5);
  var c = IP_LABELS.find(function(x){ return x.k===key; });
  return c ? c.t : key;
}
function ipLabel(e, key, ip){
  /* Подписи по данным опроса не зависят от того, заведён адрес в учёте
     или нет: устройство в сети есть, и сказать о нём есть что. */
  if(key==="host")   return netName(ip || (e && e.ip)) || (e && e.res && e.res.name) ||
                            (e && e.list.length ? "занят" : "");
  if(!e){
    /* адреса нет в учёте, но опрос его видит — показываем, что нашёл */
    return netName(ip) || "";
  }
  if(e.list.length){
    var it = e.list[0].item;
    if(key==="owner")   return ownerName(it.owner) || netName(e.ip) || "занят";
    if(key==="inv")     return it.inv || "занят";
    if(key==="type")    return typeName(it.type) || "занят";
    if(key==="regName") return (reg(rid(it))||{}).name || "занят";
    if(key==="busy")    return "занят";
    return specValueByName(it, key.slice(5)) || "занят";
  }
  if(e.res){
    var rs = e.res;
    if(key==="owner") return ownerName(rs.owner) || resLabel(rs) || "резерв";
    if(key==="type")  return rs.kind || "резерв";
    if(key==="busy")  return "резерв";
    return "резерв" + (resLabel(rs) ? ": " + resLabel(rs) : "");
  }
  return netName(e.ip) || "";
}
function exportPools(scoped){
  if(!scoped) return cfg.ipPools.slice();
  var cur = poolById(curPool);
  return cur ? [cur] : [];
}
/* карта пула: диапазон режется по N и раскладывается колонками */
function ipMapRows(pools, perCol, labelKey){
  var idx = ipIndex(), rows = [], title = labelTitle(labelKey);
  pools.forEach(function(pl){
    rows.push(["Пул: "+pl.name+" — "+pl.prefix+"0/24, хосты "+pl.from+"–"+pl.to+
               (pl.note ? " ("+pl.note+")" : "")]);
    var all = [];
    for(var h=(pl.from|0); h<=(pl.to|0); h++) all.push(pl.prefix+h);
    var groups = [];
    for(var i=0;i<all.length;i+=perCol) groups.push(all.slice(i, i+perCol));
    var head = [];
    groups.forEach(function(){ head.push("IP-адрес", title); });
    rows.push(head);
    for(var r=0;r<perCol;r++){
      var line = [], any = false;
      groups.forEach(function(g){
        var ip = g[r];
        if(!ip){ line.push("", ""); return; }
        any = true;
        line.push(ip, ipLabel(idx[ip], labelKey, ip));
      });
      if(any) rows.push(line);
    }
    rows.push([""]);
  });
  return rows;
}
/* свободные адреса пулов в виде обычных строк списка */
function freeRows(pools, taken){
  var out = [];
  pools.forEach(function(pl){
    for(var h=(pl.from|0); h<=(pl.to|0); h++){
      var ip = pl.prefix+h;
      if(taken[ip]) continue;
      out.push({ip:ip, host:String(h), pool:pl.name, regName:"", owner:"", div:"", dep:"",
                inv:"", type:"", status:"", src:"", note:"", item:null});
    }
  });
  return out;
}
function openIpExport(){
  var saved = {};
  try{ saved = JSON.parse(localStorage.getItem("it_inv_ipcols")) || {}; }catch(e){}
  var base = saved.base && saved.base.length ? saved.base : IP_BASE_DEF;
  var sel = saved.specs || [];
  $("ipExpScope").checked = saved.scoped !== false;
  $("ipExpBase").innerHTML = IP_BASE.map(function(c){
    return '<label class="chk"><input type="checkbox" data-k="'+c.k+'"'+
      (base.indexOf(c.k)!==-1?' checked':'')+'> '+esc(c.t)+'</label>';
  }).join("");
  var names = specNames();
  $("ipExpSpecs").innerHTML = names.map(function(nm){
    return '<label class="chk"><input type="checkbox" data-name="'+esc(nm)+'"'+
      (sel.indexOf(nm)!==-1?' checked':'')+'> '+esc(nm)+'</label>';
  }).join("");
  $("ipExpNoSpecs").hidden = names.length > 0;
  $("ipExpFree").checked = !!saved.free;
  $("ipMapPer").value = saved.per || 50;
  var lab = $("ipMapLabel"), keep = saved.label || "owner";
  lab.innerHTML = IP_LABELS.map(function(c){
    return '<option value="'+c.k+'">'+esc(c.t)+'</option>'; }).join("") +
    names.map(function(nm){
      return '<option value="spec:'+esc(nm)+'">'+esc(nm)+'</option>'; }).join("");
  lab.value = keep;
  if(!lab.value) lab.value = "owner";
  document.querySelectorAll('input[name="ipmode"]').forEach(function(el){
    el.checked = (el.value === (saved.mode || "list"));
  });
  syncIpMode();
  $("dlgIpExp").showModal();
}
function ipMode(){ return document.querySelector('input[name="ipmode"]:checked').value; }
function syncIpMode(){
  var map = ipMode()==="map";
  $("ipModeMap").hidden = !map;
  $("ipModeList").hidden = map;
  $("ipColsSec").hidden = map;
  $("ipSpecsSec").hidden = map;
  $("ipScopeQ").hidden = map;
}
document.querySelectorAll('input[name="ipmode"]').forEach(function(el){ el.onchange = syncIpMode; });
$("btnIpExpCancel").onclick = function(){ $("dlgIpExp").close(); };
$("btnIpExpGo").onclick = function(){
  var scoped = $("ipExpScope").checked;
  var stamp = new Date().toISOString().slice(0,10);
  if(ipMode()==="map"){
    var pools = exportPools(scoped);
    if(!pools.length){ toast("Для карты нужен пул — выберите его вкладкой или снимите «только выбранный пул»"); return; }
    var per = Math.max(5, Math.min(255, parseInt($("ipMapPer").value,10) || 50));
    var key = $("ipMapLabel").value || "owner";
    try{ localStorage.setItem("it_inv_ipcols", JSON.stringify(
      {mode:"map", scoped:scoped, per:per, label:key,
       base:(JSON.parse(localStorage.getItem("it_inv_ipcols"))||{}).base,
       specs:(JSON.parse(localStorage.getItem("it_inv_ipcols"))||{}).specs})); }catch(e){}
    saveBlock("Карта IP", ipMapRows(pools, per, key), "карта-ip-" + stamp);
    $("dlgIpExp").close();
    return;
  }
  var base = [], specs = [];
  $("ipExpBase").querySelectorAll("input:checked").forEach(function(el){ base.push(el.dataset.k); });
  $("ipExpSpecs").querySelectorAll("input:checked").forEach(function(el){ specs.push(el.dataset.name); });
  if(!base.length && !specs.length){ toast("Отметьте хотя бы одну колонку"); return; }
  var rows = ipExportRows(scoped);
  if($("ipExpFree").checked){
    var taken = {};
    rows.forEach(function(r){ taken[r.ip] = true; });
    rows = rows.concat(freeRows(exportPools(scoped), taken));
    rows.sort(function(a,b){ return ipSort(a.ip, b.ip); });
  }
  if(!rows.length){ toast("Выгружать нечего — в этом виде адресов нет"); return; }
  var head = base.map(function(k){
    var c = IP_BASE.find(function(x){ return x.k===k; }); return c ? c.t : k;
  }).concat(specs);
  var body = rows.map(function(r){
    return base.map(function(k){ return r[k]; })
      .concat(specs.map(function(nm){ return specValueByName(r.item, nm); }));
  });
  try{ localStorage.setItem("it_inv_ipcols", JSON.stringify({mode:"list", base:base,
    specs:specs, scoped:scoped, free:$("ipExpFree").checked,
    per:parseInt($("ipMapPer").value,10)||50, label:$("ipMapLabel").value})); }catch(e){}
  saveTable({sheet:"IP-адреса", head:head, rows:body, textCols:[0]}, "ip-адреса-" + stamp);
  $("dlgIpExp").close();
};

function renderIps(){
  var idx = ipIndex(), keys = Object.keys(idx);
  var used = keys.filter(function(k){ return idx[k].list.length; }).length;
  var conflicts = keys.filter(function(k){ var e=idx[k]; return e.list.length>1 || (e.list.length && e.res); }).length;
  var cap = 0, freeTotal = 0;
  cfg.ipPools.forEach(function(x){ var c = poolCounts(x, idx); cap += c.cap; freeTotal += c.free; });
  $("ipStats").innerHTML = tile("Пулов", cfg.ipPools.length) + tile("Адресов в пулах", cap) +
    tile("Занято", used) + tile("В резерве", cfg.ipReserved.length) +
    tile("Свободно", freeTotal) + tile("Конфликтов", conflicts);

  $("poolsBody").innerHTML = cfg.ipPools.map(function(x, i){
    var c = poolCounts(x, idx);
    return '<tr data-p="'+esc(x.id)+'"><td class="num">'+(i+1)+'</td>'+cellText(x.name + (x.note ? " — "+x.note : ""))+
      '<td class="mono" title="'+esc(x.prefix)+'0/24">'+esc(x.prefix)+'0/24</td>'+
      '<td>'+x.from+'–'+x.to+'</td>'+
      '<td><select class="js-preg">'+regOptions(x.registryId||"", "— любой —")+'</select></td>'+
      '<td><select class="js-pcat"'+(x.registryId?'':' disabled')+'>'+
        catOptionsOf(x.registryId||"", x.categoryId||"", "— любая —")+'</select></td>'+
      '<td>'+c.busy+'</td><td>'+c.res+'</td><td>'+c.free+'</td>'+
      acts(['<button class="ic js-renpool" title="Переименовать">✎</button>',
            '<button class="ic js-rangepool" title="Изменить диапазон хостов">⇔</button>',
            '<button class="ic btn-danger js-delpool" title="Удалить пул">✕</button>'])+'</tr>';
  }).join("");
  $("poolsEmpty").hidden = cfg.ipPools.length>0;
  fillPoolTargets();

  if(curPool!=="none" && !poolById(curPool)) curPool = cfg.ipPools.length ? cfg.ipPools[0].id : "none";
  $("poolTabs").innerHTML = (cfg.ipPools.length
      ? cfg.ipPools.map(function(x){
          return '<button class="pooltab'+(x.id===curPool?' on':'')+'" data-pt="'+esc(x.id)+'">'+esc(x.name)+'</button>';
        }).join("")
      : '<span class="note" style="margin:0">Диапазоны не заданы — нажмите «Диапазоны (пулы) адресов» справа.</span>')
    + '<button class="pooltab'+(curPool==="none"?' on':'')+'" data-pt="none">Вне пулов</button>';

  var cur = poolById(curPool);
  $("gridCard").hidden = !cur;
  if(cur){
    var cells = [], aliveN = 0, checkedN = 0;
    for(var h=(cur.from|0); h<=(cur.to|0); h++){
      var ip = cur.prefix+h, e = idx[ip], cls = "free", lab = "", ttl = ip + " — свободен";
      if(e && e.list.length){
        cls = (e.list.length>1 || e.res) ? "bad" : "busy";
        var it = e.list[0].item;
        lab = ownerName(it.owner) || it.inv || typeName(it.type) || "";
        ttl = ip + " — " + (lab||"занят") + (it.inv ? ", инв. "+it.inv : "");
        if(cls==="bad") ttl += " · конфликт";
      } else if(e && e.res){
        cls = "res"; lab = resLabel(e.res) || "резерв";
        ttl = ip + " — резерв" + (resLabel(e.res) ? ": " + resLabel(e.res) : "") +
              (e.res.kind ? " · " + e.res.kind : "") + (e.res.owner ? " · " + ownerName(e.res.owner) : "");
      }
      /* адреса нет в учёте, но опрос его видит: подписываем именем хоста,
         а если имени нет — производителем по MAC */
      if(!lab){
        lab = netName(ip);
        if(lab) ttl = ip + " — " + lab;
      }
      /* опрос сети: точка в углу и подпись в подсказке */
      var ns = netOf(ip), dot = "";
      /* имя хоста опрос узнаёт сам — показываем сразу в подсказке, не открывая карточку */
      if(ns && ns.hostName) ttl += " · " + ns.hostName;
      if(ns && ns.vendor) ttl += " (" + ns.vendor + ")";
      if(ns && ns.lastCheck){
        checkedN++;
        if(ns.alive){
          aliveN++; cls += " alive"; dot = '<i class="net on"></i>';
          ttl += " · в сети" + (ns.method ? " ("+ns.method+")" : "") +
                 (e && e.list.length ? "" : " — в учёте не числится");
        } else {
          cls += " dead"; dot = '<i class="net"></i>';
          ttl += " · не отвечает" + (ns.lastSeen ? ", был в сети " + fmtWhen(ns.lastSeen) : "");
        }
      }
      cells.push('<div class="ipcell '+cls+'" data-ip="'+esc(ip)+'" title="'+esc(ttl)+'">'+dot+
        '<b>'+h+'</b><small>'+esc(lab||"·")+'</small></div>');
    }
    $("gridTitle").textContent = cur.name + " · " + cur.prefix + "0/24 · хосты " + cur.from + "–" + cur.to +
      (checkedN ? " · в сети " + aliveN + " из " + checkedN + " опрошенных" : "");
    $("ipGrid").innerHTML = cells.join("");
  }

  var q = $("qIp").value.trim().toLowerCase(), data = [];
  keys.forEach(function(k){
    var e = idx[k], pl = poolOfIp(k);
    if(curPool==="none"){ if(pl) return; }
    else if(!pl || pl.id!==curPool) return;
    var bad = e.list.length>1 || (e.list.length && !!e.res);
    e.list.forEach(function(u){
      data.push({ip:k, pool:pl?pl.name:"—", regName:(reg(rid(u.item))||{}).name||"", inv:u.item.inv||"",
        typeName:typeName(u.item.type), owner:ownerName(u.item.owner)||"— не указан —", src:"запись",
        id:u.item.id, regId:rid(u.item), bad:bad});
    });
    if(e.res) data.push({ip:k, pool:pl?pl.name:"—", regName:"резерв", inv:e.res.name||"",
      typeName:e.res.kind||"", owner:ownerName(e.res.owner) || e.res.note || "резерв",
      src:"резерв", id:e.res.id, bad:bad});
  });
  data.sort(function(a,b){ return ipSort(a.ip,b.ip); });
  var shown = data.filter(function(r){
    if(!q) return true;
    return [r.ip,r.pool,r.regName,r.inv,r.typeName,r.owner].join(" ").toLowerCase().indexOf(q)!==-1;
  });
  $("ipsBody").innerHTML = shown.map(function(r, i){
    return '<tr'+(r.src==="запись"?' class="pick" data-item="'+esc(r.id)+'" data-reg="'+esc(r.regId)+'"'
                                 :' class="pick" data-resip="'+esc(r.ip)+'"')+'>'+
      '<td class="num">'+(i+1)+'</td>'+
      '<td class="mono" title="'+esc(r.ip)+'">'+esc(r.ip)+(r.bad?' <span class="badge b-danger">конфликт</span>':'')+'</td>'+
      netCell(r.ip) +
      cellText(r.pool) + cellText(r.regName) + cellText(r.owner) + cellText(r.inv) +
      '<td class="hide-md" title="'+esc(r.typeName)+'">'+esc(r.typeName)+'</td>'+
      acts(r.src==="резерв"
        ? ['<button class="ic btn-danger js-delip" title="Убрать из резерва" data-id="'+esc(r.id)+'">✕</button>']
        : ['<span class="chip">запись</span>'])+'</tr>';
  }).join("");
  var ee = $("ipsEmpty"); ee.hidden = shown.length>0;
  ee.textContent = data.length ? "Ничего не найдено."
    : (cfg.ipPools.length ? "В этом пуле пока нет занятых адресов."
                          : "Создайте пул адресов — и адреса из карточек начнут собираться здесь.");
}
$("qIp").oninput = renderIps;

function fillPoolTargets(){
  var kr = $("poolReg").value;
  $("poolReg").innerHTML = regOptions(kr, "— любой раздел —");
  $("poolReg").value = kr;
  var kc = $("poolCat").value;
  $("poolCat").innerHTML = catOptionsOf($("poolReg").value, kc, "— любая категория —");
  if(kc) $("poolCat").value = kc;
  $("poolCat").disabled = !$("poolReg").value;
}
$("poolReg").onchange = function(){ $("poolCat").value = ""; fillPoolTargets(); };
$("btnAddPool").onclick = function(){
  var nm = $("poolName").value.trim(), pre = normPrefix($("poolPrefix").value);
  var from = Math.max(0, Math.min(255, parseInt($("poolFrom").value,10)||0));
  var to   = Math.max(0, Math.min(255, parseInt($("poolTo").value,10)||0));
  if(!nm){ toast("Введите название пула"); return; }
  if(!validPrefix(pre)){ toast("Подсеть указывается тремя октетами: 192.168.203"); return; }
  if(from>to){ var t=from; from=to; to=t; }
  if(cfg.ipPools.some(function(x){ return x.prefix===pre; })){ toast("Пул с такой подсетью уже есть"); return; }
  if(cfg.ipPools.some(function(x){ return x.name.toLowerCase()===nm.toLowerCase(); })){ toast("Пул с таким названием уже есть"); return; }
  var x = {id:uid("pl"), name:nm, prefix:pre, from:from, to:to, note:$("poolNote").value.trim(),
           registryId:$("poolReg").value, categoryId:$("poolReg").value ? $("poolCat").value : ""};
  cfg.ipPools.push(x); curPool = x.id;
  $("poolName").value=""; $("poolPrefix").value=""; $("poolNote").value="";
  saveCfg(); toast("Пул создан");
};
$("poolName").addEventListener("keydown", function(e){ if(e.key==="Enter") $("btnAddPool").click(); });
$("poolPrefix").addEventListener("keydown", function(e){ if(e.key==="Enter") $("btnAddPool").click(); });

$("poolsBody").addEventListener("change", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var x = poolById(tr.dataset.p); if(!x) return;
  if(e.target.classList.contains("js-preg")){
    x.registryId = e.target.value;
    if(!x.registryId) x.categoryId = "";
    else if(x.categoryId && !regCats(x.registryId).some(function(c){ return c.id===x.categoryId; }))
      x.categoryId = "";
    saveCfg(); return;
  }
  if(e.target.classList.contains("js-pcat")){ x.categoryId = e.target.value; saveCfg(); }
});
$("poolsBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var x = poolById(tr.dataset.p); if(!x) return;
  if(e.target.classList.contains("js-renpool")){
    var nm = prompt("Название пула:", x.name); if(!nm) return;
    x.name = nm.trim();
    var nt = prompt("Для чего используется:", x.note||"");
    if(nt!==null) x.note = String(nt).trim();
    saveCfg(); return;
  }
  if(e.target.classList.contains("js-rangepool")){
    var f = prompt("Хосты — начало диапазона:", String(x.from)); if(f===null) return;
    var t = prompt("Хосты — конец диапазона:", String(x.to)); if(t===null) return;
    var nf = Math.max(0, Math.min(255, parseInt(f,10)||0)), nt2 = Math.max(0, Math.min(255, parseInt(t,10)||0));
    if(nf>nt2){ var tmp=nf; nf=nt2; nt2=tmp; }
    x.from = nf; x.to = nt2; saveCfg(); return;
  }
  if(e.target.classList.contains("js-delpool")){
    var linked = cfg.specs.filter(function(sp){ return sp.poolId===x.id; }).length;
    if(!confirm("Удалить пул «"+x.name+"»?"+
      (linked?"@NL@К нему привязано характеристик: "+linked+" — подстановка префикса у них пропадёт.":"")+
      "@NL@Сами адреса в записях и резерв останутся.")) return;
    cfg.specs.forEach(function(sp){ if(sp.poolId===x.id) sp.poolId=""; });
    (cfg.presets||[]).forEach(function(pr){ (pr.specs||[]).forEach(function(sp){ if(sp.poolId===x.id) sp.poolId=""; }); });
    cfg.ipPools = cfg.ipPools.filter(function(y){ return y.id!==x.id; });
    if(curPool===x.id) curPool = "";
    saveCfg();
  }
});

$("btnPools").onclick = function(){ $("dlgPools").showModal(); };
$("btnPoolsClose").onclick = function(){ $("dlgPools").close(); };
$("poolTabs").addEventListener("click", function(e){
  var b = e.target.closest("[data-pt]"); if(!b) return;
  curPool = b.dataset.pt; renderIps();
});

/* ---- карточка адреса: имя хоста и календарь пингов ---- */
var ipCur = "", ipDaysMap = {}, ipItemId = "", ipMonthKey = "";
var MONTHS = ["январь","февраль","март","апрель","май","июнь",
              "июль","август","сентябрь","октябрь","ноябрь","декабрь"];

function monthKey(d){ return d.getFullYear() + "-" + (d.getMonth()<9?"0":"") + (d.getMonth()+1); }
function monthTitle(key){
  var p = key.split("-");
  return MONTHS[parseInt(p[1],10)-1] + " " + p[0];
}
/* месяцы, попадающие в срок хранения: от сегодня назад на keepDays */
function ipMonthList(keep){
  var out = [], d = new Date(), first = new Date();
  first.setDate(first.getDate() - (keep || 183));
  d = new Date(d.getFullYear(), d.getMonth(), 1);
  var stop = new Date(first.getFullYear(), first.getMonth(), 1);
  while(d >= stop){
    out.push(monthKey(d));
    d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  }
  return out;
}
function renderIpCal(){
  var p = ipMonthKey.split("-"), y = parseInt(p[0],10), mo = parseInt(p[1],10) - 1;
  var firstDay = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
  /* неделя начинается с понедельника: у getDay() воскресенье — ноль */
  var shift = (firstDay.getDay() + 6) % 7;
  var html = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(function(w){
    return '<div class="wd">' + w + '</div>'; }).join("");
  for(var i = 0; i < shift; i++) html += '<div class="day blank"></div>';
  var todayKey = today();
  for(var n = 1; n <= days; n++){
    var key = y + "-" + (mo<9?"0":"") + (mo+1) + "-" + (n<10?"0":"") + n;
    var rec = ipDaysMap[key], cls = "day", ttl = "не проверяли";
    if(!rec) cls += " gap";
    else if(rec.alive){ cls += " up";
      ttl = "отвечал: " + rec.seen + " из " + rec.checks + " проверок"; }
    else { cls += " down"; ttl = "не отвечал, проверок: " + rec.checks; }
    if(key === todayKey) cls += " today";
    html += '<div class="' + cls + '" title="' + esc(key.split("-").reverse().join(".") +
            " — " + ttl) + '">' + n + '</div>';
  }
  /* добиваем до шести недель — иначе окно прыгает при смене месяца */
  for(var t = shift + days; t < 42; t++) html += '<div class="day blank"></div>';
  $("ipCal").innerHTML = html;
}
function ipShift(step){
  var list = ipMonthList(183), i = list.indexOf(ipMonthKey);
  if(i === -1) return;
  var j = i - step;                 /* список идёт от свежего к старому */
  if(j < 0 || j >= list.length) return;
  ipMonthKey = list[j];
  $("ipMonth").value = ipMonthKey;
  renderIpCal();
}
$("btnIpPrev").onclick = function(){ ipShift(-1); };
$("btnIpNext").onclick = function(){ ipShift(1); };
$("ipMonth").onchange = function(){ ipMonthKey = this.value; renderIpCal(); };
$("btnIpClose").onclick = function(){ $("dlgIp").close(); };
$("btnIpItem").onclick = function(){
  var it = items.find(function(x){ return x.id === ipItemId; });
  $("dlgIp").close();
  if(it){ openReg(rid(it), "items"); openDlg(it); }
};
function openIpCard(ip){
  var en = ipIndex()[ip] || {list:[], res:null};
  var it = en.list.length ? en.list[0].item : null;
  ipCur = ip; ipItemId = it ? it.id : "";
  ipDaysMap = {};
  $("ipTitle").textContent = "Адрес " + ip;
  $("btnIpItem").hidden = !it;
  $("ipErr").textContent = "";
  $("ipCal").innerHTML = "";
  var st = (cfg.netStatus || {})[ip] || {};
  var kv = function(k, v){ return '<div><span>'+esc(k)+'</span><b>'+esc(v||"—")+'</b></div>'; };
  /* имя хоста: что вернул обход сети, иначе характеристика «PC-name» из карточки */
  var ipKvFill = function(d){
    d = d || {};
    $("ipKv").innerHTML =
    kv("Имя хоста", d.hostName || st.hostName || (it ? specValueByName(it, "PC-name") : "")) +
    kv("Производитель", d.vendor || st.vendor || "") +
    kv("MAC-адрес", d.mac || st.mac || "") +
    kv("Последний ответ", st.lastSeen ? fmtWhen(st.lastSeen) : "") +
    kv("Оборудование", it ? ((it.inv || "—") + " · " + (typeName(it.type) || ""))
                           : (en.res ? "не привязано · в резерве" : "не привязано")) +
    (it ? kv("Ответственный", ownerName(it.owner)) : "");
  };
  ipKvFill(null);
  fillIpMan(it ? null : (en.res || {}), !it);
  var months = ipMonthList(183);
  $("ipMonth").innerHTML = months.map(function(k){
    return '<option value="'+esc(k)+'">'+esc(monthTitle(k))+'</option>'; }).join("");
  ipMonthKey = months[0];
  $("ipMonth").value = ipMonthKey;
  renderIpCal();
  $("dlgIp").showModal();
  api("/api/ip/history?ip=" + encodeURIComponent(ip)).then(function(d){
    (d.days || []).forEach(function(x){ ipDaysMap[x.d] = x; });
    ipKvFill(d);
    renderIpCal();
  }).catch(function(e){
    $("ipErr").textContent = "История не загрузилась" + apiWhy(e);
  });
}

/* Резерв с данными вручную. Адрес, к которому не привязано оборудование, —
   свободный или уже в резерве — открывает ту же карточку, что и занятый, и в
   ней заполняется всё руками: имя, тип, ОС, где работает, ответственный,
   подразделение, отдел. Так заводятся виртуальные серверы и прочее, чего нет
   в учёте оборудования. Сохранили — адрес в резерве, на сетке он жёлтый. */
var IPM = ["name","kind","os","host","mac","note"];
function fillIpMan(res, show){
  $("ipManBox").hidden = !show;
  var may = can("ip.manage");
  hide("btnIpSave", show && may);
  hide("btnIpUnres", show && may && !!(res && res.id));
  if(!show) return;
  $("btnIpSave").textContent = res.id ? "Сохранить" : "Зарезервировать";
  IPM.forEach(function(k){ $("ipm_"+k).value = res[k] || ""; });
  var kinds = {};
  cfg.ipReserved.forEach(function(r){ if(r.kind) kinds[r.kind] = true; });
  $("ipmKinds").innerHTML = Object.keys(kinds).sort().map(function(k){
    return '<option value="'+esc(k)+'"></option>'; }).join("");
  $("ipm_owner").innerHTML = opts(cfg.users.slice().sort(function(a,b){
    return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; }), "— не указан —");
  $("ipm_owner").value = res.owner || "";
  $("ipm_div").innerHTML = opts(cfg.divisions, "— не указано —");
  $("ipm_div").value = res.divisionId || "";
  fillIpmDeps(res.departmentId || "");
  IPM.concat(["owner","div","dep"]).forEach(function(k){ $("ipm_"+k).disabled = !may; });
}
/* отделы — выбранного подразделения и ещё не размеченные */
function fillIpmDeps(keep){
  var dv = $("ipm_div").value;
  $("ipm_dep").innerHTML = opts(cfg.departments.filter(function(d){
    return !dv || !d.divisionId || d.divisionId === dv; }), "— не указан —");
  $("ipm_dep").value = keep && $("ipm_dep").querySelector('option[value="'+keep+'"]') ? keep : "";
}
$("ipm_div").onchange = function(){ fillIpmDeps($("ipm_dep").value); };
$("ipm_owner").onchange = function(){
  var u = byId("users", this.value); if(!u) return;
  if(!$("ipm_div").value && u.divisionId){ $("ipm_div").value = u.divisionId; fillIpmDeps(""); }
  if(!$("ipm_dep").value && u.departmentId) fillIpmDeps(u.departmentId);
};
$("btnIpSave").onclick = function(){
  var ip = ipCur; if(!ip) return;
  var en = ipIndex()[ip] || {list:[], res:null};
  if(en.list.length){ $("ipErr").textContent = "Адрес уже занят оборудованием"; return; }
  var r = en.res;
  if(!r){ r = {id:uid("ip"), ip:ip}; cfg.ipReserved.push(r); }
  IPM.forEach(function(k){ r[k] = $("ipm_"+k).value.trim(); });
  r.owner = $("ipm_owner").value;
  r.divisionId = $("ipm_div").value;
  r.departmentId = $("ipm_dep").value;
  $("dlgIp").close();
  saveCfg();
  toast("Адрес " + ip + " в резерве" + (r.name ? ": " + r.name : ""));
};
$("btnIpUnres").onclick = function(){
  var en = ipIndex()[ipCur]; if(!en || !en.res) return;
  if(!confirm("Снять резерв с " + ipCur + (resLabel(en.res) ? " («" + resLabel(en.res) + "»)" : "") +
              "?\nРучные данные адреса удалятся.")) return;
  cfg.ipReserved = cfg.ipReserved.filter(function(x){ return x.id!==en.res.id; });
  $("dlgIp").close();
  saveCfg();
};

$("ipGrid").addEventListener("click", function(e){
  var c = e.target.closest("[data-ip]"); if(!c) return;
  /* любой адрес открывает свою карточку: занятый — с историей и переходом к
     оборудованию, незанятый — ещё и с ручными данными резерва */
  openIpCard(c.dataset.ip);
});

$("ipsBody").addEventListener("click", function(e){
  var del = e.target.closest(".js-delip");
  if(del){
    var r = cfg.ipReserved.find(function(x){ return x.id===del.dataset.id; }); if(!r) return;
    if(!confirm("Убрать "+r.ip+" из резерва?")) return;
    cfg.ipReserved = cfg.ipReserved.filter(function(x){ return x.id!==r.id; }); saveCfg(); return;
  }
  var rt = e.target.closest("tr[data-resip]");
  if(rt){ openIpCard(rt.dataset.resip); return; }
  var tr = e.target.closest("tr[data-item]"); if(!tr) return;
  var it = items.find(function(x){ return x.id===tr.dataset.item; }); if(!it) return;
  openReg(tr.dataset.reg, "items"); openDlg(it);
});

/* Приходные накладные и накладные по передаче: приём файла, разбор строк.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== накладные ==================
   Браузер не умеет управлять сканером — такого стандарта нет. Поэтому файл
   приходит перетаскиванием: сканируете привычной программой, а сюда бросаете
   готовый PDF. Дальше сервер кладёт его в архив и распознаёт. */
var docs = [], docsCfg = null, docsOcr = null, curDoc = null;

/* ================== накладные по передаче ================== */
var transfers = [];
function loadTransfers(){
  return api("/api/transfers").then(function(d){
    transfers = d.transfers || [];
    renderTransfers();
    if(nav === "reg" && $("tbody")) renderItems();
  }).catch(function(){});
}
function xferFileLink(t, label){
  return t.hasFile
    ? '<a href="/api/transfers/'+encodeURIComponent(t.id)+'/file" target="_blank" title="'+esc(t.origName||"")+'">'+esc(label||"открыть")+'</a>'
    : '<span class="note" style="margin:0">—</span>';
}
function renderTransfers(){
  if(!$("xferBody")) return;
  /* Здесь — только передачи с документом: без накладной показывать нечего.
     Все передачи подряд — на экране «История передач». */
  var docs = transfers.filter(function(t){ return t.hasFile; });
  var q = ($("qXfer").value || "").trim().toLowerCase();
  var list = docs.filter(function(t){
    return !q || [t.inv, t.typeName, t.fromLabel, t.toLabel, t.note, t.who, t.origName]
      .join(" ").toLowerCase().indexOf(q) !== -1;
  });
  $("xferBody").innerHTML = list.map(function(t, i){
    return xferRow(t, i, true);
  }).join("");
  $("xferEmpty").hidden = docs.length > 0;
  $("cntXfer").textContent = docs.length ? String(docs.length) : "";
  renderXhist();
}
function xferRow(t, i, withFile){
  return '<tr class="pick" data-t="'+esc(t.id)+'"><td class="num">'+(i+1)+'</td>'+
    '<td class="mono" title="'+esc(fmtWhen(t.at))+'">'+esc(fmtWhen(t.at))+'</td>'+
    '<td class="mono">'+esc(t.inv||"—")+'</td>'+
    cellText(t.typeName||"—") + cellText(t.fromLabel||"—") + cellText(t.toLabel||"—") +
    '<td class="hide-md" title="'+esc(t.who||"")+'">'+esc(t.who||"")+'</td>'+
    cellText(t.note||"") +
    '<td>'+(withFile ? xferFileLink(t) : (t.hasFile ? xferFileLink(t, "есть") : '<span class="note" style="margin:0">нет</span>'))+
    (!isAdmin() ? ''
      : (!withFile && t.hasFile)
        ? '<button class="ic" disabled title="Есть накладная: удаляется на экране «Накладные по передаче»">✕</button>'
        : '<button class="ic btn-danger js-xdel" title="Удалить запись о передаче">✕</button>')+'</td></tr>';
}
/* история передач: всё подряд, с документом и без */
function renderXhist(){
  if(!$("xhistBody")) return;
  var q = ($("qXhist").value || "").trim().toLowerCase();
  var list = transfers.filter(function(t){
    return !q || [t.inv, t.typeName, t.fromLabel, t.toLabel, t.note, t.who, t.origName]
      .join(" ").toLowerCase().indexOf(q) !== -1;
  });
  $("xhistBody").innerHTML = list.map(function(t, i){ return xferRow(t, i, false); }).join("");
  $("xhistEmpty").hidden = transfers.length > 0;
  $("cntXhist").textContent = transfers.length ? String(transfers.length) : "";
  var withDoc = transfers.filter(function(t){ return t.hasFile; }).length;
  $("xhistStats").innerHTML = tile("Передач", transfers.length) + tile("С накладной", withDoc) +
    tile("Без накладной", transfers.length - withDoc);
}
$("qXhist").oninput = function(){ renderXhist(); };
/* убрать запись о передаче может только администратор — и только с причиной,
   которая уходит в журнал удалений */
/* Из «Истории передач» нельзя удалить передачу с накладной — только через
   «Накладные по передаче», где документ виден; оттуда запись уходит из обоих списков. */
function askDeleteXfer(t, source){
  if(source === "hist" && t.hasFile){
    toast("У этой передачи есть накладная — удаляйте её на экране «Накладные по передаче»"); return; }
  askDeleteReason("передача инв. " + (t.inv || "—") + " · " + (t.fromLabel || "—") + " → " + (t.toLabel || "—"),
    function(reason){
      api("/api/transfers/delete", {id:t.id, reason:reason, source:source || "docs"})
        .then(function(){ toast("Запись о передаче удалена"); return loadTransfers().then(loadDeletions); })
        .catch(function(e){ toast(e && e.message ? e.message : ("Не удалось удалить" + apiWhy(e))); });
    });
}
$("xhistBody").addEventListener("click", function(e){
  if(e.target.closest("a")) return;
  var tr = e.target.closest("tr[data-t]"); if(!tr) return;
  var t = transfers.find(function(x){ return x.id === tr.dataset.t; }); if(!t) return;
  if(e.target.closest(".js-xdel")){ askDeleteXfer(t, "hist"); return; }
  openXfer(t, "hist");
});
$("qXfer").oninput = function(){ renderTransfers(); };
function openXfer(t, source){
  var kv = function(k, v){ return '<div><span>'+esc(k)+'</span><b>'+(v||"—")+'</b></div>'; };
  $("dlgXferTitle").textContent = "Передача · инв. " + (t.inv || "—") +
    (t.typeName ? " · " + t.typeName : "");
  $("xf_body").innerHTML = '<div class="kv">' +
    kv("Когда", esc(fmtWhen(t.at))) + kv("Кто передал", esc(t.who)) +
    kv("Инвентарный номер", esc(t.inv)) + kv("Тип", esc(t.typeName)) +
    kv("Откуда", esc(t.fromLabel)) + kv("Куда", esc(t.toLabel)) +
    kv("Накладная", t.hasFile ? esc(t.origName || "файл") : "не прикладывали") +
    '</div>' +
    (t.note ? '<div class="sec" style="margin-top:12px"><b>Примечание</b><div style="margin-top:6px">'+esc(t.note)+'</div></div>' : '');
  var it = items.find(function(x){ return x.id === t.itemId; });
  $("btnXfCard").hidden = !it;
  $("btnXfCard").onclick = function(){ $("dlgXfer").close(); if(it) openDlg(it); };
  $("btnXfFile").hidden = !t.hasFile;
  $("dlgXfer").dataset.t = t.id;
  $("dlgXfer").dataset.src = source || "docs";
  $("btnXfDel").hidden = !isAdmin() || (source === "hist" && t.hasFile);
  $("btnXfFile").onclick = function(){
    window.open("/api/transfers/" + encodeURIComponent(t.id) + "/file", "_blank"); };
  $("dlgXfer").showModal();
}
$("xferBody").addEventListener("click", function(e){
  if(e.target.closest("a")) return;
  var tr = e.target.closest("tr[data-t]"); if(!tr) return;
  var t = transfers.find(function(x){ return x.id === tr.dataset.t; }); if(!t) return;
  if(e.target.closest(".js-xdel")){ askDeleteXfer(t, "docs"); return; }
  openXfer(t, "docs");
});
$("btnXfDel").onclick = function(){
  var t = transfers.find(function(x){ return x.id === $("dlgXfer").dataset.t; });
  var src = $("dlgXfer").dataset.src || "docs";
  $("dlgXfer").close();
  if(t) askDeleteXfer(t, src);
};
$("btnXfClose").onclick = function(){ $("dlgXfer").close(); };

function loadDocs(){
  return api("/api/docs").then(function(d){
    docs = d.docs || []; docsCfg = d.config || {}; docsOcr = d.ocr || {};
    $("dc_path").value = docsCfg.path || "";
    $("dc_lang").value = docsCfg.lang || "rus+eng";
    $("dc_dpi").value  = docsCfg.dpi || 300;
    renderDocs();
  }).catch(function(){});
}

/* Когда распознавание в порядке, над списком ничего не пишем — заказчик просил
   оставить только «выберите файл или вставьте сюда». Говорим лишь о неполадках. */
function ocrNote(){
  if(!docsOcr || docsOcr.ready) return "";
  if((docsOcr.missingLibs || []).length)
    return "Распознавание выключено: на сервере не хватает библиотек — " +
           esc(docsOcr.missingLibs.join(", ")) +
           ". Так бывает после обновления: запустите на сервере install.bat, " +
           "он доставит их из папки wheels, интернет не нужен.";
  if(!docsOcr.exe)
    return "Распознавание выключено: на сервере не установлен Tesseract. " +
           "Запустите install-ocr.bat от имени администратора.";
  return "Распознавание установлено, но не хватает языков: " +
         esc((docsOcr.missing || []).join(", ")) + ".";
}

function renderDocs(){
  if(!$("docsBody")) return;
  $("docOcr").innerHTML = ocrNote();
  var ST = {"new":"принята", parsed:"разобрана", applied:"заведена"};
  $("docsBody").innerHTML = docs.map(function(d, i){
    var cnt = (d.rows || []).length;
    return '<tr class="pick" data-doc="'+esc(d.id)+'"><td class="num">'+(i+1)+'</td>'+
      '<td class="mono" title="'+esc(fmtWhen(d.at))+'">'+esc(fmtWhen(d.at))+'</td>'+
      '<td class="mono">'+esc(d.number || "—")+'</td>'+
      cellText(d.origName) +
      '<td>'+cnt+'</td>'+
      '<td><span class="badge '+(d.status==="applied"?"b-ok":"b-info")+'">'+
        esc(ST[d.status] || d.status)+'</span></td>'+
      '<td class="hide-md" title="'+esc(d.who||"")+'">'+esc(d.who||"")+'</td>'+
      acts(can("docs.edit")
        ? ['<button class="ic js-docopen" title="Разобрать">✎</button>',
           '<button class="ic btn-danger js-docdel" title="Удалить накладную">✕</button>']
        : ['<button class="ic js-docopen" title="Посмотреть">👁</button>'])+'</tr>';
  }).join("");
  $("docsEmpty").hidden = docs.length > 0;
}

/* ---------- приём файла ---------- */
/* Распознавание скана занимает от 10 до 40 секунд (подбор поворота, разбор
   таблицы по линейкам), и без индикатора это выглядит как зависание. Поэтому
   файл уходит через XMLHttpRequest — он умеет отдавать ход загрузки, — а дальше
   крутится секундомер: видно, что сервер работает, а не молчит. */
var docWaitTimer = null;
function docWaitStop(){
  if(docWaitTimer){ clearInterval(docWaitTimer); docWaitTimer = null; }
  var dz = $("docDrop");
  dz.classList.remove("busy");
  $("dwBar").classList.remove("ind");
  $("dwBar").firstChild.style.width = "0";
  $("dwJoke").textContent = "";
  $("dwJoke").classList.remove("loud");
  $("dwScore").textContent = "";
  mailGame.stop();
  dz.classList.remove("game");
}
function sendDoc(file){
  if(!file) return;
  $("docErr").textContent = "";
  var dz = $("docDrop"), bar = $("dwBar"), started = Date.now(), stage = "up";
  dz.classList.add("busy");
  $("dwTitle").textContent = "Загружаем файл: " + file.name;
  $("dwSub").textContent = fmtBytes(file.size);
  bar.classList.remove("ind"); bar.firstChild.style.width = "0";
  var isPdf = /\.pdf$/i.test(file.name);
  var ocrStage = function(){
    stage = "ocr";
    $("dwTitle").textContent = "Распознаём документ…";
    bar.classList.add("ind"); bar.firstChild.style.width = "";
    /* скан читается до минуты — пока ждём, конверт гоняется за мышкой */
    if(mailGame.start(dz.querySelector(".spin"), function(n){
      $("dwScore").textContent = "Конверт поймал вас " + n + " " + timesWord(n);
    })){
      dz.classList.add("game");
      $("dwScore").textContent = "Поводите мышкой — конверт попробует вас поймать";
    }
    var tick = function(){
      var s = Math.round((Date.now() - started) / 1000);
      var j = $("dwJoke");
      j.textContent = s < 40 ? "Не кипишуй, ща отсканирую" : "А ВОТ ТЕПЕРЬ МОЖНО КИПИШОВАТЬ";
      j.classList.toggle("loud", s >= 40);
      $("dwSub").textContent = "Прошло " + s + " с. " +
        (docsOcr && docsOcr.ready === false
          ? "Распознавание на сервере выключено — читаем только текстовый слой."
          : (isPdf ? "У PDF с текстовым слоем это мгновенно, скан читается 10–40 секунд — не закрывайте страницу."
                   : "Картинка распознаётся 10–40 секунд: подбираем поворот и читаем таблицу — не закрывайте страницу."));
    };
    tick();
    docWaitTimer = setInterval(tick, 1000);
  };
  var fd = new FormData();
  fd.append("file", file);
  var xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/docs/upload", true);
  xhr.withCredentials = true;
  xhr.upload.onprogress = function(ev){
    if(!ev.lengthComputable || stage !== "up") return;
    var pct = Math.round(ev.loaded * 100 / ev.total);
    bar.firstChild.style.width = pct + "%";
    $("dwSub").textContent = fmtBytes(ev.loaded) + " из " + fmtBytes(ev.total) + " · " + pct + "%";
    if(ev.loaded >= ev.total) ocrStage();
  };
  xhr.upload.onload = function(){ if(stage === "up") ocrStage(); };
  xhr.onerror = function(){
    docWaitStop();
    $("docErr").textContent = "Не удалось принять файл — нет связи с сервером";
  };
  xhr.onload = function(){
    docWaitStop();
    var j = {};
    try { j = JSON.parse(xhr.responseText || "{}"); } catch(e){ j = {}; }
    if(xhr.status === 401){ showLogin(); return; }
    if(xhr.status < 200 || xhr.status >= 300){
      j.status = xhr.status;
      $("docErr").textContent = "Не удалось принять файл" +
        (j && j.message ? " — " + j.message : apiWhy(j));
      return;
    }
    docsOcr = j.ocr || docsOcr;
    var secs = Math.round((Date.now() - started) / 1000);
    toast("Накладная принята" + (secs >= 3 ? " за " + secs + " с" : ""));
    loadDocs().then(function(){ openDoc(j.doc && j.doc.id); })
      .catch(function(e){ $("docErr").textContent = "Не удалось обновить список" + apiWhy(e); });
  };
  xhr.send(fd);
}
function timesWord(n){
  var a = n % 10, b = n % 100;
  return (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? "раза" : "раз";
}
function fmtBytes(n){
  n = n || 0;
  if(n < 1024) return n + " Б";
  if(n < 1024*1024) return Math.round(n/1024) + " КБ";
  return (n/1024/1024).toFixed(1).replace(".", ",") + " МБ";
}
(function(){
  var dz = $("docDrop");
  dz.addEventListener("dragover", function(e){
    e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", function(){ dz.classList.remove("over"); });
  dz.addEventListener("drop", function(e){
    e.preventDefault(); dz.classList.remove("over");
    sendDoc(e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  dz.onclick = function(){ $("docFile").click(); };
  $("docPick").onclick = function(e){ e.preventDefault(); e.stopPropagation(); $("docFile").click(); };
  $("docFile").onchange = function(){ sendDoc($("docFile").files[0]); $("docFile").value = ""; };
  /* «вставьте сюда»: Ctrl+V с файлом или снимком экрана в буфере. Перехватываем
     только файлы — текст по-прежнему вставляется в поля. */
  document.addEventListener("paste", function(e){
    if(nav !== "docs" || !can("docs.edit") || dz.classList.contains("busy")) return;
    var cd = e.clipboardData, file = cd && cd.files && cd.files[0];
    if(!file && cd && cd.items){
      for(var i = 0; i < cd.items.length && !file; i++)
        if(cd.items[i].kind === "file") file = cd.items[i].getAsFile();
    }
    if(!file) return;
    e.preventDefault();
    sendDoc(file);
  });
})();

$("btnDocCfg").onclick = function(){
  var c = $("docCfgCard"); c.hidden = !c.hidden;
};
$("btnDocCfgSave").onclick = function(){
  api("/api/docs/config", {path:$("dc_path").value.trim(), lang:$("dc_lang").value.trim(),
                           dpi:parseInt($("dc_dpi").value, 10) || 300})
    .then(function(){ toast("Сохранено"); return loadDocs(); })
    .catch(function(e){ $("docErr").textContent = "Не удалось сохранить" + apiWhy(e); });
};

/* ---------- разбор строк ---------- */
/* Разделы техники, без расходников. Модель описывает железо: «HP LaserJet»,
   «Seagate 1 ТБ». Заводить её отдельно «для расходников» незачем — материал
   ставится в технику, и модель у него та же, что у железа. */
function assetRegs(){ return cfg.registries.filter(function(r){ return r.kind !== "supplies"; }); }
function targetOptions(sel){
  return '<option value="">— выберите раздел —</option>' +
    cfg.registries.map(function(r){
      return '<option value="'+esc(r.id)+'"'+(sel===r.id?" selected":"")+'>'+esc(r.name)+'</option>';
    }).join("");
}
/* Вторая колонка зависит от первой: для оборудования это тип, для материалов —
   существующий материал или новый по наименованию из накладной. */
/* Для оборудования выбирается категория или подкатегория, а тип заводится
   из наименования материала — так просил заказчик: «наименование должно
   добавиться в Тип». Для материалов выбирается сам материал. */
/* Номенклатурные номера, по которым этот материал уже приходил. В накладной
   названия похожи («Чернила Epson…» нескольких видов), и выбрать нужный
   материал по одному названию трудно — показываем рядом номенклатуру. */
function supplySkus(id){
  var seen = {}, out = [];
  (cfg.receipts || []).forEach(function(r){
    if(r.supplyId === id && r.sku && !seen[r.sku]){ seen[r.sku] = 1; out.push(r.sku); }
  });
  return out.sort();
}
function supplyLabel(m){
  var s = supplySkus(m.id);
  return m.name + (s.length ? " ном. № " + s.join(", ") : "");
}
function secondOptions(row){
  var r = reg(row.target);
  if(!r) return '<option value="">—</option>';
  if(r.kind === "supplies"){
    return '<option value="">создать «'+esc((row.name||"").slice(0,40))+'»</option>' +
      cfg.supplies.map(function(m){
        return '<option value="'+esc(m.id)+'"'+(row.supplyId===m.id?" selected":"")+'>'+
               esc(supplyLabel(m))+'</option>'; }).join("");
  }
  var out = '<option value="">— выберите категорию —</option>';
  cfg.categories.filter(function(c){ return rid(c) === r.id; }).forEach(function(c){
    var v = "cat:" + c.id;
    out += '<option value="'+esc(v)+'"'+(row.catId===v?" selected":"")+'>'+esc(c.name)+'</option>';
    cfg.subcategories.filter(function(g){ return (g.categoryId||"") === c.id; })
      .forEach(function(g){
        var gv = "sub:" + g.id;
        out += '<option value="'+esc(gv)+'"'+(row.catId===gv?" selected":"")+'>'+
               "\u00a0\u00a0\u00a0" + esc(g.name)+'</option>';
      });
  });
  return out;
}
function renderDocRows(){
  var rows = (curDoc && curDoc.rows) || [];
  /* пустое поле после разбора значит «не прочиталось»: говорим об этом прямо,
     иначе человек решит, что в накладной этого и не было */
  var unread = function(v){
    return (v === "" || v === null || v === undefined)
      ? '<span class="unread">Не смог прочитать</span>' : "";
  };
  $("drBody").innerHTML = rows.map(function(r, i){
    var done = !!r.done;
    return '<tr data-r="'+i+'"'+(done ? ' class="row-done" title="уже заведено"' : '')+
      '><td class="num">'+(i+1)+(done ? " ✓" : "")+'</td>'+
      '<td><input class="js-sku" value="'+esc(r.sku||"")+'">'+unread(r.sku)+'</td>'+
      '<td><textarea class="js-name" rows="1" title="'+esc(r.name||"")+'">'+
        esc(r.name||"")+'</textarea>'+unread(r.name)+'</td>'+
      '<td><input class="js-qty" type="number" min="1" value="'+esc(r.qty||"1")+'">'+
        unread(r.qty)+'</td>'+
      '<td><input class="js-cost" inputmode="decimal" value="'+esc(r.cost==null?"":money(r.cost))+
        '" title="цена за единицу из колонки «Цена в валюте»">'+
        unread(r.cost==null?"":r.cost)+'</td>'+
      '<td class="mono js-sum" title="стоимость × количество">'+
        esc(money(lineSum(r.cost, r.qty || 1)) || "—")+'</td>'+
      '<td><select class="js-target">'+targetOptions(r.target)+'</select></td>'+
      '<td><select class="js-second">'+secondOptions(r)+'</select></td>'+
      '<td>'+(done ? '' : '<button class="ic js-rowdel" title="Убрать строку: её не заводить">✕</button>')+
      '</td></tr>';
  }).join("");
  /* высота поля под содержимое: одна строка — одна, длинное имя — две и больше */
  fitNames();
  $("drEmpty").hidden = rows.length > 0;
  var left = rows.filter(function(r){ return !r.done && !r.target; }).length;
  $("dr_count").textContent = rows.length
    ? ("строк: " + rows.length + (left ? ", без раздела: " + left : ", все размечены"))
    : "";
}
/* textarea не умеет расти сам — высоту задаём по содержимому */
function fitName(el){
  el.style.height = "auto";
  el.style.height = (el.scrollHeight + 2) + "px";
}
/* Считаем дважды: сразу и на следующем кадре. При первом заходе окно ещё
   доверстывается (а на узком экране к тому же меняются доли колонок), и
   измеренная высота выходит на строку меньше нужной. */
function fitNames(){
  var run = function(){ document.querySelectorAll("#drBody .js-name").forEach(fitName); };
  run();
  setTimeout(run, 0);
}
/* окно перетащили на другой экран или повернули — доли колонок сменились */
window.addEventListener("resize", function(){
  if($("dlgDoc").open) fitNames();
});
function readDocRows(){
  var out = [];
  document.querySelectorAll("#drBody tr").forEach(function(tr){
    var idx = parseInt(tr.dataset.r, 10);
    var was = (curDoc && curDoc.rows && curDoc.rows[idx]) || {};
    out.push({sku: tr.querySelector(".js-sku").value.trim(),
              name: tr.querySelector(".js-name").value.replace(/\s+/g, " ").trim(),
              qty: tr.querySelector(".js-qty").value || "1",
              cost: numVal(tr.querySelector(".js-cost").value),
              target: tr.querySelector(".js-target").value,
              done: !!was.done,
              catId: "", typeId: "", supplyId: ""});
    var r = out[out.length - 1];
    var second = tr.querySelector(".js-second").value;
    var rg = reg(r.target);
    if(rg && rg.kind === "supplies") r.supplyId = second; else r.catId = second;
  });
  return out;
}
function openDoc(id){
  var d = docs.find(function(x){ return x.id === id; });
  if(!d) return;
  curDoc = {id:d.id, rows:(d.rows || []).slice()};
  var applied = d.status === "applied";
  $("dlgDocTitle").textContent = "Накладная" + (d.number ? " № " + d.number : "") +
    (applied ? " · уже заведена" : "");
  /* По заведённой накладной второй раз проводить нельзя: иначе та же техника
     появится в учёте дважды. Открыть её обратно может только администратор. */
  var mayScan = can("docs.edit");
  $("btnDrApply").hidden = applied || !mayScan;
  $("btnDrReopen").hidden = !(applied && isAdmin());
  $("btnDrDel").hidden = !mayScan;
  $("btnDrAdd").hidden = !mayScan;
  $("btnDrBulk").hidden = !mayScan;
  $("dr_applied").hidden = !applied;
  $("dr_applied").textContent = applied
    ? ("Записи по этой накладной уже заведены" +
       (d.appliedAt ? " " + fmtWhen(d.appliedAt) : "") + "." +
       (isAdmin() ? " Чтобы дописать пропущенное, нажмите «Открыть заново»: " +
                    "заведённые строки повторно не проводятся."
                  : " Чтобы дописать пропущенное, обратитесь к администратору."))
    : "";
  $("dr_num").textContent  = d.number || "—";
  $("dr_numWarn").hidden   = !!d.number;
  /* «Дата» — когда документ отсканировали, её всегда знает сервер.
     «Дата прихода» — дата самого документа из шапки; не прочиталась — вписывают сами. */
  $("dr_date").textContent = d.at ? fmtWhen(d.at) : "—";
  $("dr_recv").value       = d.date || "";
  $("dr_recvWarn").hidden  = !!d.date;
  $("dr_who").textContent  = d.who || "—";
  /* В плохих сканах номер склада не пропечатывается — тогда его вписывают
     руками, иначе техника осядет без склада. Поэтому здесь поле с подсказками,
     а не список: незнакомый номер сервер заведёт сам. */
  $("dr_wh").value = d.warehouse || "";
  $("dr_whList").innerHTML = (cfg.warehouses || []).map(function(w){
    return '<option value="' + esc(w.code || "") + '">' +
           esc((w.code ? w.code + " · " : "") + (w.name || "")) + '</option>'; }).join("");
  $("dr_whHint").textContent = d.warehouse
    ? ((cfg.warehouses || []).some(function(w){ return (w.code||"").trim() === d.warehouse.trim(); })
        ? "" : "Склада " + d.warehouse + " ещё нет — заведётся при сохранении.")
    : "Номер склада в документе не прочитался — впишите его сами.";
  $("dr_file").href = "/api/docs/" + encodeURIComponent(d.id) + "/file";
  $("dr_file").textContent = d.origName || "открыть";
  $("dr_bulk").innerHTML = targetOptions("");
  $("dr_err").textContent = "";
  renderDocRows();
  $("dlgDoc").showModal();
  /* высоту полей считаем после showModal: у закрытого <dialog> размеры нулевые,
     и наименование осталось бы в одну строку */
  fitNames();
}
$("docsBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-doc]"); if(!tr) return;
  if(e.target.closest(".js-docdel")){ askDeleteDoc(tr.dataset.doc); return; }
  openDoc(tr.dataset.doc);
});

/* Ошибочно загруженный документ убирается только с объяснением — запись
   уходит в тот же журнал удалений, что и записи учёта. */
function askDeleteDoc(id){
  var d = docs.find(function(x){ return x.id === id; });
  if(!d) return;
  askDeleteReason("накладная " + (d.number ? "№ " + d.number + " · " : "") +
                  (d.origName || ""), function(reason){
    api("/api/docs/delete", {id:id, reason:reason})
      .then(function(){ toast("Накладная удалена"); return loadDocs(); })
      .catch(function(e){
        toast(e && e.message ? e.message : ("Не удалось удалить" + apiWhy(e)));
      });
  });
}
$("drBody").addEventListener("change", function(e){
  if(!e.target.closest(".js-target")) return;
  curDoc.rows = readDocRows();
  renderDocRows();
});
/* сумму пересчитываем прямо при наборе: перерисовывать всю таблицу на каждую
   цифру нельзя — поле теряло бы курсор */
$("drBody").addEventListener("input", function(e){
  if(e.target.classList.contains("js-name")){ fitName(e.target); return; }
  if(!e.target.classList.contains("js-cost") && !e.target.classList.contains("js-qty")) return;
  var tr = e.target.closest("tr"); if(!tr) return;
  var cell = tr.querySelector(".js-sum"); if(!cell) return;
  cell.textContent = money(lineSum(tr.querySelector(".js-cost").value,
                                   tr.querySelector(".js-qty").value || 1)) || "—";
});
$("drBody").addEventListener("click", function(e){
  var b = e.target.closest(".js-rowdel"); if(!b) return;
  var tr = b.closest("tr"), idx = parseInt(tr.dataset.r, 10);
  curDoc.rows = readDocRows();
  curDoc.rows.splice(idx, 1);
  renderDocRows();
});
$("btnDrBulk").onclick = function(){
  var t = $("dr_bulk").value;
  curDoc.rows = readDocRows().map(function(r){
    if(!r.target) r.target = t;
    return r;
  });
  renderDocRows();
};
$("btnDrAdd").onclick = function(){
  curDoc.rows = readDocRows();
  curDoc.rows.push({sku:"", name:"", qty:"1", target:"", catId:"", typeId:"", supplyId:""});
  renderDocRows();
};
$("btnDrCancel").onclick = function(){ $("dlgDoc").close(); };
$("btnDrReopen").onclick = function(){
  var id = curDoc && curDoc.id;
  if(!id) return;
  if(!confirm("Открыть накладную заново, чтобы дописать пропущенное?\n\n" +
              "Строки, заведённые в прошлый раз, второй раз проведены не будут.")) return;
  api("/api/docs/reopen", {id:id})
    .then(function(){
      toast("Накладная открыта");
      $("dlgDoc").close();
      return loadDocs().then(function(){ openDoc(id); });
    })
    .catch(function(e){ $("dr_err").textContent = "Не удалось открыть" + apiWhy(e); });
};
$("btnDrDel").onclick = function(){
  var id = curDoc && curDoc.id;
  $("dlgDoc").close();
  if(id) askDeleteDoc(id);
};
$("btnDrApply").onclick = function(){
  var all = readDocRows(), rows = all.filter(function(r){ return !r.done; });
  var err = "";
  /* Всё обязательно: раздел, категория и склад — иначе техника заводится
     «в никуда», а потом её не найти. Лишнюю строку убирают крестиком. */
  if(!$("dr_wh").value.trim()) err = "Укажите склад-получатель";
  else if(!rows.length) err = "Все строки уже заведены или убраны";
  else rows.some(function(r, i){
    var n = all.indexOf(r) + 1, rg = reg(r.target);
    if(!r.target){ err = "Строка " + n + ": выберите, куда заводить"; return true; }
    if(rg && rg.kind !== "supplies"){
      if(!r.catId){ err = "Строка " + n + ": выберите категорию"; return true; }
      var bad = invProblem(r.sku);
      if(!r.sku.trim()){ err = "Строка " + n + ": впишите номенклатурный номер"; return true; }
      if(bad){ err = "Строка " + n + ": " + bad; return true; }
    }
    return false;
  });
  if(err){ $("dr_err").textContent = err; return; }
  $("dr_err").textContent = "";
  $("btnDrApply").disabled = true;
  api("/api/docs/apply", {id:curDoc.id, rows:all,
                          date:$("dr_recv").value || "",
                          warehouse:$("dr_wh").value.trim()})
    .then(function(d){
      var m = d.made || {};
      toast("Заведено: оборудования " + (m.items||0) + ", приходов " + (m.receipts||0) +
            (m.already ? ", пропущено уже заведённых: " + m.already : ""));
      $("dlgDoc").close();
      return loadState().then(loadDocs);
    })
    .catch(function(e){ $("dr_err").textContent = "Не удалось завести" + apiWhy(e); })
    .then(function(){ $("btnDrApply").disabled = false; });
};

/* Карточка записи оборудования.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== карточка записи ================== */
function opts(list, empty){
  return '<option value="">'+esc(empty)+'</option>' +
    list.map(function(o){ return '<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>'; }).join("");
}
function refreshFilters(){
  var keep = {c:$("fCat").value, g:$("fSub").value, t:$("fType").value, s:$("fStatus").value,
              d:$("fDiv").value, p:$("fDep").value, m:$("fModel").value};
  $("fModel").innerHTML = opts(regModels(), "Все модели"); $("fModel").value = keep.m;
  $("fModel").hidden = !regModels().length;
  $("fCat").innerHTML = opts(regCats(), "Все категории"); $("fCat").value = keep.c;
  $("fSub").innerHTML = opts(subsOf(keep.c), "Все подкатегории"); $("fSub").value = keep.g;
  $("fType").innerHTML = opts(typesOf(keep.c, $("fSub").value), "Все типы"); $("fType").value = keep.t;
  $("fDiv").innerHTML = opts(cfg.divisions, "Все подразделения"); $("fDiv").value = keep.d;
  $("fDep").innerHTML = depOptions(keep.d, "Все отделы"); $("fDep").value = keep.p;
  $("fStatus").innerHTML = '<option value="">Все статусы</option>' +
    statusesOf().map(function(s){ return '<option>'+esc(s)+'</option>'; }).join("");
  $("fStatus").value = keep.s;
  markFilters();
}
/* подписей у фильтров нет — активные подсвечиваем, чтобы было видно, что список сужен */
function markFilters(){
  var ids = ["fCat","fSub","fType","fModel","fStatus","fDiv","fDep","fAttach"], active = 0;
  ids.forEach(function(id){
    var el = $(id), on = !!el.value;
    el.classList.toggle("act", on);
    if(on) active++;
  });
  if(xferOnly) active++;
  $("btnReset").hidden = !active;
  $("btnReset").textContent = active>1 ? ("Сбросить · "+active) : "Сбросить";
}
function refreshSubSelect(catId, keep){
  var list = subsOf(catId);
  $("f_sub").innerHTML = list.length ? opts(list, "— не указана —") : '<option value="">— подкатегорий нет —</option>';
  if(keep && list.some(function(g){ return g.id===keep; })) $("f_sub").value = keep;
}
function refreshTypeSelect(catId, subId, keep){
  var list = typesOf(catId, subId);
  $("f_type").innerHTML = list.length ? opts(list, "— не указан —") : '<option value="">— здесь типов нет —</option>';
  if(keep && list.some(function(t){ return t.id===keep; })) $("f_type").value = keep;
}
function refreshOwnerSelect(cur){
  var html = opts(cfg.users, "— не указан —");
  if(cur && !byId("users", cur)) html += '<option value="'+esc(cur)+'" selected>'+esc(cur)+' (текстом)</option>';
  $("f_owner").innerHTML = html;
  if(cur) $("f_owner").value = cur;
}
/* Характеристика, которой может быть несколько, живёт слотами. Первый слот —
   это сам id характеристики, дальше к нему приписывается номер: «s1», «s1#2»,
   «s1#3». Так всё, что читает specs[id], продолжает видеть основное значение,
   а лишние строки не мешаются. */
function slotKey(id, n){ return n > 1 ? id + "#" + n : id; }
function slotNum(key){
  var i = String(key).indexOf("#");
  return i === -1 ? 1 : (parseInt(key.slice(i + 1), 10) || 1);
}
function slotLabel(sp, n){ return sp.name + (n > 1 ? " " + n : ""); }
/* какие слоты заведены у характеристики: первый всегда, дальше — по значениям
   и по служебным сведениям (слот могли добавить и ещё не заполнить) */
function slotsOf(sp, values){
  var out = [1];
  for(var n = 2; n <= 40; n++){
    var k = slotKey(sp.id, n);
    if((values && values[k] !== undefined) || curSlots[k]) out.push(n);
  }
  return out;
}
var curSlots = {};      /* {ключ: {src, off}} — откуда строка и когда сняли */

/* Характеристики записи, у которых разрешено несколько значений. */
function multiSpecsOf(it){
  if(!it) return [];
  return specsOf(it.type).filter(function(sp){ return sp.multi; });
}
/* Первый свободный слот характеристики у записи: занятыми считаем и те,
   что «сняты» — место держится за прежней деталью, пока её не уберут. */
function freeSlot(it, specId){
  var vals = (it && it.specs) || {}, meta = (it && it.specSlots) || {};
  for(var n = 1; n <= 40; n++){
    var k = slotKey(specId, n);
    if(!vals[k] && !meta[k]) return n;
  }
  return 0;
}
/* Кладёт значение в свободную строку характеристики. Возвращает подпись
   строки («HDD 2») или пусто, если места не нашлось. */
function fillSlot(it, specId, value, src){
  var sp = cfg.specs.find(function(x){ return x.id === specId; });
  if(!it || !sp || !value) return "";
  var n = freeSlot(it, specId);
  if(!n) return "";
  var key = slotKey(specId, n);
  it.specs = it.specs || {};
  it.specSlots = it.specSlots || {};
  it.specs[key] = String(value);
  it.specSlots[key] = {src: src || ""};
  return slotLabel(sp, n);
}

function specField(s, values, noneMap, status){
  var none = !!(noneMap && noneMap[s.id]);
  var v = (!none && values && values[s.id]) ? values[s.id] : "";
  var must = specReq(s, status);
  var lbl = esc(s.name) + (s.unit ? ', '+esc(s.unit) : '') +
    (must ? ' <span class="req" title="обязательное поле">*</span>' : '') +
    (s.subcategoryId ? ' <span class="chip">станд.</span>' : '') +
    (s.uniq ? ' <span class="chip">не повторяется</span>' : ''), inp;
  var pools = poolsForSpec(s);
  if(s.kind==="list"){
    inp = '<select data-spec="'+esc(s.id)+'"'+(none?' disabled':'')+'><option value=""></option>'+
      (s.options||[]).map(function(o){ return '<option'+(o===v?' selected':'')+'>'+esc(o)+'</option>'; }).join("")+'</select>';
  } else if(pools.length){
    /* адрес вводится последним октетом; если диапазонов несколько — их выбирают тут же */
    var act = pools[0];
    if(v){
      var hit = pools.find(function(x){ return v.indexOf(x.prefix)===0; });
      if(hit) act = hit;
    }
    var host = v ? (v.indexOf(act.prefix)===0 ? v.slice(act.prefix.length) : v) : "";
    var headHtml = pools.length > 1
      ? '<select data-poolsel="'+esc(s.id)+'"'+(none?' disabled':'')+' title="диапазон">'+
          pools.map(function(x){
            return '<option value="'+esc(x.id)+'"'+(x.id===act.id?' selected':'')+
              ' title="'+esc(x.name)+'">'+esc(x.prefix)+'</option>'; }).join("")+
        '</select>'
      : '<span>'+esc(act.prefix)+'</span>';
    inp = '<div class="pre">'+headHtml+
      '<input type="text" inputmode="numeric" data-spec="'+esc(s.id)+'" data-prefix="'+esc(act.prefix)+'"'+
      (none?' disabled':'')+' placeholder="'+act.from+'–'+act.to+'" value="'+esc(host)+'"></div>';
  } else {
    var t = s.kind==="number" ? "number" : s.kind==="date" ? "date" : "text";
    inp = '<input type="'+t+'" data-spec="'+esc(s.id)+'"'+(none?' disabled':'')+
      (PLACE[s.kind] ? ' placeholder="'+PLACE[s.kind]+'"' : '')+' value="'+esc(v)+'">';
  }
  var chk = s.opt ? '<label class="chk"><input type="checkbox" data-none="'+esc(s.id)+'"'+(none?' checked':'')+
    '> нет значения (не используется)</label>' : '';
  return '<div class="field"><label>'+lbl+'</label>'+inp+chk+'<div class="err" data-err="'+esc(s.id)+'"></div></div>';
}
function renderSpecFields(typeId, values, noneMap){
  var list = specsOf(typeId), box = $("specFields"), status = $("f_status").value;
  if(!list.length){
    box.innerHTML = '<div class="note">Для этого типа характеристики не заданы. Добавьте их на вкладке «Характеристики» — для всей подкатегории сразу или только для этого типа.</div>'; return;
  }
  /* поля идут группами: без группы, затем по наборам, из которых они пришли */
  var groups = [], map = {};
  list.forEach(function(sp){
    var g = sp.group || "";
    if(!map[g]){ map[g] = {name:g, items:[]}; groups.push(map[g]); }
    map[g].items.push(sp);
  });
  box.innerHTML = groups.map(function(g){
    var head = "";
    if(g.name){
      var later = g.items.some(function(sp){ return sp.req && !specReq(sp, status); });
      head = '<div class="grphead">'+esc(g.name)+
        (later ? '<span class="chip">при статусе «'+esc(status)+'» можно заполнить позже</span>' : '')+'</div>';
    }
    return head + '<div class="grid3" style="margin-top:8px">' +
      g.items.map(function(sp){
        if(!sp.multi) return specField(sp, values, noneMap, status);
        return slotsOf(sp, values).map(function(n){
          return specSlotField(sp, n, values, noneMap, status);
        }).join("") + specAddBtn(sp);
      }).join("") + '</div>';
  }).join("");
}
/* Добавленная строка: та же разметка, что и у основной, но с другим ключом,
   своей подписью и кнопками «снять» / «вернуть» / «убрать». */
function specSlotField(sp, n, values, noneMap, status){
  if(n === 1) return specField(sp, values, noneMap, status);
  var key = slotKey(sp.id, n), meta = curSlots[key] || {};
  var fake = {};
  for(var k in sp) if(Object.prototype.hasOwnProperty.call(sp, k)) fake[k] = sp[k];
  fake.id = key;
  fake.name = slotLabel(sp, n);
  fake.req = false;               /* обязательной бывает только первая строка */
  fake.uniq = false;
  fake.subcategoryId = "";        /* значок «станд.» у добавленной строки ни к чему */
  var html = specField(fake, values, noneMap, status);
  var marks = meta.src ? '<span class="chip" title="строка появилась от установленной запчасти">⚙</span>' : "";
  if(meta.off){
    marks += '<span class="chip">снято ' + esc(fmtDate(meta.off)) + '</span>' +
             '<button class="btn-sm js-slotback" data-k="' + esc(key) + '">Вернуть</button>';
  } else {
    marks += '<button class="btn-sm js-slotoff" data-k="' + esc(key) + '">Снять</button>';
  }
  marks += '<button class="ic btn-danger js-slotdel" data-k="' + esc(key) + '" title="Убрать строку">✕</button>';
  return html.replace("</div>", '<div class="row" style="margin-top:6px">' + marks + "</div></div>");
}
function specAddBtn(sp){
  return '<div class="field"><label>&nbsp;</label>' +
    '<button class="btn-sm js-slotadd" data-s="' + esc(sp.id) + '">+ ещё ' + esc(sp.name) + '</button></div>';
}
/* Кнопки добавленных строк. Значения перечитываем до перерисовки, иначе
   набранное в соседних полях пропадёт. */
function slotValues(){
  var cur = {};
  document.querySelectorAll("#specFields [data-spec]").forEach(function(el){
    cur[el.dataset.spec] = fieldValue(el); });
  return cur;
}
$("specFields").addEventListener("click", function(e){
  var add = e.target.closest(".js-slotadd");
  var off = e.target.closest(".js-slotoff");
  var back = e.target.closest(".js-slotback");
  var del = e.target.closest(".js-slotdel");
  if(!add && !off && !back && !del) return;
  e.preventDefault();
  var cur = slotValues(), none = currentNone();
  if(add){
    var sp = cfg.specs.find(function(x){ return x.id === add.dataset.s; });
    if(sp){
      var n = 2;
      while(cur[slotKey(sp.id, n)] !== undefined || curSlots[slotKey(sp.id, n)]) n++;
      curSlots[slotKey(sp.id, n)] = {};
      cur[slotKey(sp.id, n)] = "";
    }
  } else if(off){
    /* «снято» — значение остаётся видимым, пока на это место не поставят новое */
    curSlots[off.dataset.k] = curSlots[off.dataset.k] || {};
    curSlots[off.dataset.k].off = today();
  } else if(back){
    if(curSlots[back.dataset.k]) delete curSlots[back.dataset.k].off;
  } else if(del){
    delete curSlots[del.dataset.k];
    delete cur[del.dataset.k];
  }
  renderSpecFields($("f_type").value, cur, none);
});

/* перерисовать поля, сохранив введённое (нужно при смене статуса) */
function refreshSpecFields(){
  var cur = {}, none = currentNone();
  document.querySelectorAll("#specFields [data-spec]").forEach(function(el){ cur[el.dataset.spec]=fieldValue(el); });
  renderSpecFields($("f_type").value, cur, none);
  if($("attLockNote")) lockAttached();
}
function fieldValue(el){
  if(!el) return "";
  var v = String(el.value||"").trim();
  var pre = (el.dataset && el.dataset.prefix) || "";
  return v ? pre + v : "";
}
function currentNone(){
  var m = {};
  document.querySelectorAll("#specFields [data-none]").forEach(function(el){ if(el.checked) m[el.dataset.none]=true; });
  return m;
}
function validateSpecs(){
  var list = specsOf($("f_type").value), bad = [], none = currentNone();
  document.querySelectorAll("#specFields .err").forEach(function(d){ d.textContent=""; });
  document.querySelectorAll("#specFields [data-spec]").forEach(function(el){ el.classList.remove("bad"); });
  list.forEach(function(sp){
    var el = document.querySelector('#specFields [data-spec="'+sp.id+'"]');
    var val = !none[sp.id] ? fieldValue(el) : "";
    var msg = "";
    if(none[sp.id]) msg = "";
    else if(!val){ if(specReq(sp, $("f_status").value)) msg = "Заполните поле" + (sp.opt ? " или отметьте «нет значения»" : ""); }
    else {
      msg = formatError(sp, val);
      if(!msg && sp.kind==="ip"){
        var pls = poolsForSpec(sp);
        if(pls.length){
          var own = pls.find(function(x){ return val.indexOf(x.prefix)===0; });
          if(!own){
            msg = "адрес вне диапазонов раздела: " +
                  pls.map(function(x){ return x.prefix+"x"; }).join(", ");
          } else {
            var hostStr = val.slice(own.prefix.length), hostNum = Number(hostStr);
            if(!/^\d{1,3}$/.test(hostStr)) msg = "последний октет — число от "+own.from+" до "+own.to;
            else if(hostNum < own.from || hostNum > own.to)
              msg = "хост вне диапазона "+own.from+"–"+own.to+" пула «"+own.name+"»";
          }
        } else {
          var alien = poolOfIp(val);
          if(alien) msg = "адрес из пула «"+alien.name+"» — привяжите характеристику к этому пулу или выберите свободный адрес";
        }
      }
      if(!msg && sp.uniq){
        var d = findDuplicate(sp, val, editingId);
        if(d) msg = "Уже занято: " + (d.inv || typeName(d.type) || "другая позиция") +
          (d.owner ? " — "+ownerName(d.owner) : "");
        if(!msg && sp.kind==="ip"){
          var res = cfg.ipReserved.find(function(r){ return r.ip===val; });
          if(res) msg = "адрес в резерве" + (resLabel(res) ? ": "+resLabel(res) : "");
        }
      }
    }
    if(msg){
      bad.push(sp.name + ": " + msg);
      var box = document.querySelector('#specFields [data-err="'+sp.id+'"]');
      if(box) box.textContent = msg;
      if(el) el.classList.add("bad");
    }
  });
  return bad;
}
$("specFields").addEventListener("change", function(e){
  var ps = e.target.dataset && e.target.dataset.poolsel;
  if(ps){
    var pl = poolById(e.target.value);
    var f = document.querySelector('#specFields [data-spec="'+ps+'"]');
    if(pl && f){
      f.dataset.prefix = pl.prefix;
      f.placeholder = pl.from+"–"+pl.to;
    }
    validateSpecs();
    return;
  }
  var id = e.target.dataset && e.target.dataset.none;
  if(id){
    var f = document.querySelector('#specFields [data-spec="'+id+'"]');
    if(f){ f.disabled = e.target.checked; if(e.target.checked) f.value = ""; }
  }
  validateSpecs();
});
$("specFields").addEventListener("input", function(){ validateSpecs(); });

/* набор полей под выбранный статус: приём на склад — количество,
   ремонт — мастер, списание — дата и причина */
/* на складе и в списании техника ничья — поля сотрудника прячем */
/* Статусы, при которых техника ни за кем не числится. «На списание» тоже:
   из подразделения её уже забрали, а решения комиссии ждут месяцами.
   Кто был ответственным — остаётся в истории записи. */
function ownerless(st){ return st===ST_STOCK || st===ST_OFF || st===ST_TOOFF; }
function whCode(id){
  var w = (cfg.warehouses || []).find(function(x){ return x.id === id; });
  return w ? (w.code || w.name || "") : "";
}
function whName(id){
  var w = (cfg.warehouses || []).find(function(x){ return x.id === id; });
  return w ? ((w.code ? w.code + " · " : "") + (w.name || "")) : "";
}
function fillWarehouses(sel){
  $("f_wh").innerHTML = '<option value="">— не указан —</option>' +
    (cfg.warehouses || []).map(function(w){
      return '<option value="'+esc(w.id)+'"'+(sel===w.id?" selected":"")+'>'+
             esc((w.code ? w.code + " · " : "") + (w.name || ""))+'</option>'; }).join("");
  /* у расходных материалов склада нет — они лежат общей кучей */
  $("wrapWh").hidden = isSupplyReg(curReg);
  /* обязателен, только когда есть из чего выбрать (та же проверка — в btnSave) */
  document.querySelector('label[for="f_wh"]').innerHTML = "Склад" +
    ((cfg.warehouses || []).length ? ' <span class="req" title="обязательное поле">*</span>' : '');
}
function syncStatusFields(){
  var st = $("f_status").value, isNew = !editingId;
  var prevIt = editingId ? items.find(function(x){ return x.id===editingId; }) : null;
  var back = !!(prevIt && prevIt.status===ST_REPAIR && st!==ST_REPAIR);   /* вернули из ремонта */
  var noOwner = ownerless(st), holder = $("f_holder").value || "person";
  $("wrapHolder").hidden = noOwner;
  $("wrapOwner").hidden = noOwner || holder !== "person";
  $("wrapDiv").hidden   = noOwner || holder !== "person";
  $("wrapDep").hidden   = noOwner || holder !== "person";
  $("wrapPlace").hidden = noOwner || holder !== "place";
  $("wrapParent").hidden = noOwner || holder !== "item";
  $("wrapHide").hidden   = noOwner || holder !== "item";
  var wantQty = (st===ST_STOCK && isNew), wantRep = (st===ST_REPAIR);
  var wantOff = (st===ST_OFF), wantReady = (st===ST_READY);
  var wantToOff = (st===ST_TOOFF);   /* передали комиссии, ждём решения */
  $("wrapQty").hidden    = !wantQty;
  $("wrapMaster").hidden = !wantRep;
  $("wrapSDate").hidden  = !(wantRep || wantOff || wantReady || wantToOff || back);
  $("wrapSNote").hidden  = !(wantRep || wantOff || wantReady || wantToOff || back);
  $("statusExtra").hidden = !(wantQty || wantRep || wantOff || wantReady || wantToOff || back);
  $("seTitle").textContent = wantReady ? "Отремонтировано, ждёт установки"
    : back ? "Возврат из ремонта"
    : wantQty ? "Приём на склад"
    : wantRep ? "Передача в ремонт" : wantOff ? "Списание"
    : wantToOff ? "Передача на списание — ждём решения комиссии" : "";
  var useMark = (st===ST_USE) ? ' <span class="req" title="обязательное поле">*</span>' : '';
  document.querySelector('label[for="f_owner"]').innerHTML = "Ответственный сотрудник" + useMark;
  document.querySelector('label[for="f_div"]').innerHTML   = "Подразделение" + useMark;
  document.querySelector('label[for="f_dep"]').innerHTML   = "Отдел" + useMark;
  document.querySelector('label[for="f_place"]').innerHTML = "Место" + useMark;
  document.querySelector('label[for="f_parent"]').innerHTML = "Прикрепить к оборудованию" + useMark;
  document.querySelector('label[for="f_sdate"]').textContent =
    (back || wantReady) ? "Дата возврата" : wantToOff ? "Дата передачи" : "Дата";
  document.querySelector('label[for="f_snote"]').textContent =
    (back || wantReady) ? "Что сделали" : "Примечание к статусу";
  if(back){
    /* поля из ремонта заменяем на пустые — сюда пишут результат, а не причину */
    if($("f_snote").value === (prevIt.statusNote||"")) $("f_snote").value = "";
    if(!$("f_sdate").value || $("f_sdate").value === (prevIt.statusDate||"")) $("f_sdate").value = today();
  }
  if(wantRep){
    $("f_master").disabled = !cardEditable;
    var keep = $("f_master").value, ms = masters();
    $("f_master").innerHTML = ms.length
      ? '<option value="">— не назначен —</option>' + ms.map(function(m){
          return '<option value="'+esc(m.id)+'">'+esc(m.name)+(m.position?" — "+esc(m.position):"")+'</option>'; }).join("")
      : '<option value="">— мастера не отмечены в разделе «Пользователи ИТ» —</option>';
    if(keep && ms.some(function(m){ return m.id===keep; })) $("f_master").value = keep;
  }
  if((wantRep || wantOff) && !$("f_sdate").value) $("f_sdate").value = today();
}
$("f_status").onchange = function(){ syncStatusFields(); refreshSpecFields(); validateSpecs(); };
/* Прикреплённое повторяет основное: статус, склад, ремонт и характеристики у
   него не правятся — они приходят от оборудования, к которому оно прикреплено.
   Чтобы что-то менять, сначала открепляют (выбирают «За сотрудником»). */
var cardEditable = true;
function lockAttached(){
  var it = editingId ? items.find(function(x){ return x.id===editingId; }) : null;
  var parent = ($("f_holder").value === "item" && $("f_parent").value)
    ? items.find(function(x){ return x.id===$("f_parent").value; }) : null;
  var lock = !!(it && parent);
  if(lock){
    $("f_status").value = parent.status || $("f_status").value;
    $("f_wh").value = parent.warehouse || "";
  }
  ["f_status","f_wh","f_master","f_sdate","f_snote","f_qty"].forEach(function(id){
    $(id).disabled = !cardEditable || lock;
  });
  document.querySelectorAll("#specFields input, #specFields select, #specFields textarea").forEach(function(el){
    el.disabled = !cardEditable || lock;
  });
  $("attLockNote").hidden = !lock;
  $("attLockNote").textContent = lock
    ? "Прикреплено к инв. " + (parent.inv || "—") + ": статус, склад, ремонт и характеристики берутся " +
      "от него и здесь не меняются. Чтобы править — сначала открепите (выберите «За сотрудником»)."
    : "";
}
$("f_holder").onchange = function(){ syncStatusFields(); lockAttached(); };
$("f_parent").onchange = function(){ lockAttached(); };
$("f_xfer").onchange = function(){
  var on = this.checked;
  $("xferBox").hidden = !on;
  /* пока передаём — склад-отправитель не трогаем, его меняет сама передача */
  $("f_wh").disabled = on;
  if(on){
    /* склады всех учреждений: передача на чужой склад увозит технику в то учреждение */
    var cur = $("f_wh").value;
    var fill = function(list){
      var byOrg = {};
      list.filter(function(w){ return w.id !== cur; }).forEach(function(w){
        (byOrg[w.orgName || ""] = byOrg[w.orgName || ""] || []).push(w); });
      var html = '<option value="">— выберите склад —</option>';
      Object.keys(byOrg).forEach(function(on){
        html += '<optgroup label="'+esc(on || "Учреждение")+'">' + byOrg[on].map(function(w){
          return '<option value="'+esc(w.id)+'">'+esc((w.code ? w.code + " · " : "") + (w.name || ""))+'</option>';
        }).join("") + '</optgroup>';
      });
      $("f_xwh").innerHTML = html;
    };
    fill((cfg.warehouses || []).map(function(w){ return {id:w.id, code:w.code, name:w.name, orgName:""}; }));
    api("/api/warehouses/all").then(function(d){ fill(d.warehouses || []); }).catch(function(){});
  }
};

function openDlg(it){
  if(!regTypes().length && !it){
    if(confirm("В разделе «"+reg().name+"» ещё нет типов. Перейти к настройке категорий?")) goTab("categories");
    return;
  }
  editingId = it ? it.id : null;
  /* у новой записи печатать нечего: ни номера, ни склада ещё нет */
  $("btnNom").hidden = !editingId;
  $("f_cat").innerHTML = opts(regCats(), "— все категории —");
  $("f_cat").value = it ? catOfType(it.type) : "";
  $("f_model").innerHTML = cardModels().length ? opts(cardModels(), "— не указана —")
                                              : '<option value="">— моделей ещё нет —</option>';
  $("f_model").value = it ? (it.model||"") : "";
  $("f_holder").value = it ? (it.holder||"person") : "person";
  $("f_place").innerHTML = cfg.places.length ? opts(cfg.places, "— выберите место —")
                                             : '<option value="">— места ещё не заведены —</option>';
  $("f_place").value = it ? (it.place||"") : "";
  /* прикрепить можно к любой записи этого раздела, кроме самой себя и тех,
     что прикреплены к ней (иначе цепочка замкнётся) */
  var selfId = it ? it.id : "", below = {};
  if(selfId){
    var stack = [selfId];
    while(stack.length){ var cur = stack.pop(); attachedTo(cur).forEach(function(c){ if(!below[c.id]){ below[c.id] = true; stack.push(c.id); } }); }
  }
  $("f_parent").innerHTML = '<option value="">— выберите оборудование —</option>' +
    regItems().filter(function(x){ return x.id !== selfId && !below[x.id]; })
      .sort(function(a,b){ return (a.inv||"").localeCompare(b.inv||""); })
      .map(function(x){
        var who = ownerName(x.owner);
        return '<option value="'+esc(x.id)+'">'+esc((x.inv||"—") + " · " + (typeName(x.type)||"") + (who ? " · " + who : ""))+'</option>';
      }).join("");
  $("f_parent").value = it ? (it.parent||"") : "";
  $("f_hide").checked = !!(it && it.hideAttached);
  var mats = it ? issuesOfItem(it.id) : [];
  $("matBox").hidden = !mats.length;
  $("matList").innerHTML = miniTable(["Дата","Материал","Кол-во","Примечание"],
    mats.map(function(x){ var m = supplyById(x.supplyId)||{};
      return [fmtDate(x.date), m.name||"—", String(x.qty||1), x.note||""]; }), "",
    null, ["18%","36%","13%","33%"]);
  var att = it ? attachedTo(it.id) : [];
  $("attBox").hidden = !att.length;
  $("attList").innerHTML = miniTable(["Инв. номер","Модель","Тип","Статус","В списке"],
    att.map(function(x){ return [x.inv||"", modelName(x.model)||"", typeName(x.type)||"", x.status||"",
                                  x.hideAttached ? "скрыто" : "видно"]; }),
    "", att.map(function(x){ return x.id; }), ["21%","20%","28%","19%","12%"]);
  refreshSubSelect($("f_cat").value, it ? subOfType(it.type) : "");
  refreshTypeSelect($("f_cat").value, $("f_sub").value, it ? it.type : "");
  refreshOwnerSelect(it ? (it.owner||"") : "");
  $("f_div").innerHTML = opts(cfg.divisions, "— не указано —");
  $("f_dep").innerHTML = depOptions("", "— не указан —");
  var sts = statusesOf();
  $("f_status").innerHTML = sts.map(function(s){
    return '<option>'+esc(s)+'</option>';
  }).join("");
  $("f_div").value = it ? (it.division||"") : "";
  fillDeps("f_div", "f_dep", it ? (it.department||"") : "");
  $("dlgTitle").textContent = (it ? "Карточка: " + (it.inv || typeName(it.type) || "") : "Новая запись") + " · " + reg().name;
  $("f_inv").value = it ? (it.inv||"") : "";
  $("f_cost").value = it && it.cost != null ? money(it.cost) : "";
  $("f_recv").value = it ? (it.receivedAt||"") : "";
  $("f_warr").value = it ? (it.warrantyUntil||"") : "";
  showInvHint();
  $("f_status").value = it && it.status ? it.status : sts[0];
  $("f_qty").value = "1";
  $("f_sdate").value = it ? (it.statusDate||"") : "";
  $("f_snote").value = it ? (it.statusNote||"") : "";
  $("f_master").value = "";
  syncStatusFields();
  if(it && it.masterId) $("f_master").value = it.masterId;
  $("f_notes").value = it ? (it.notes||"") : "";
  fillWarehouses(it ? (it.warehouse||"") : "");
  /* передача — только у уже заведённой единицы оборудования: новой сразу
     ставят нужный склад, а у материалов складов нет */
  /* передача — отдельная строка роли: «Накладные по передаче» на правку */
  $("xferWrap").hidden = !it || isSupplyReg(curReg) || !can("transfers.edit");
  $("f_xfer").checked = false; $("xferBox").hidden = true;
  $("f_xnote").value = ""; $("f_xfile").value = "";
  $("f_wh").disabled = false;
  $("btnDel").hidden = !it;
  if($("f_pspec")) $("f_pspec").value = "";
  curSlots = {};
  if(it && it.specSlots){
    for(var sk in it.specSlots)
      if(Object.prototype.hasOwnProperty.call(it.specSlots, sk))
        curSlots[sk] = {src: it.specSlots[sk].src || "", off: it.specSlots[sk].off || ""};
  }
  renderSpecFields($("f_type").value, it ? it.specs : null, it ? it.specsNone : null);
  var reps = it ? cfg.repairs.filter(function(r){ return r.itemId===it.id; })
    .sort(function(a,b){ return (b.from||"").localeCompare(a.from||""); }) : [];
  $("repBox").hidden = !reps.length;
  if(reps.length){
    $("repList").innerHTML = miniTable(["Отправлен","Возвращён","Дней","Мастер","Итог","Примечание"],
      reps.map(function(r){
        return [fmtDate(r.from)||"—", r.to ? fmtDate(r.to) : "в ремонте",
                daysBetween(r.from, r.to), repairMasterName(r), r.result||"",
                [r.note, r.doneNote].filter(Boolean).join(" → ")];
      }), "");
  }
  var h = (it && it.history) || [];
  $("histBox").hidden = !h.length;
  $("hist").innerHTML = h.slice().reverse().map(function(e){
    /* ссылка приходит только у той передачи, к которой прикладывали файл */
    var link = e.transferId
      ? ' <a href="/api/transfers/'+encodeURIComponent(e.transferId)+'/file" target="_blank">открыть накладную</a>' : "";
    return "<li>"+esc(histWhen(e))+(e.who ? ", <b>"+esc(e.who)+"</b>" : "")+" — "+esc(e.t)+link+"</li>";
  }).join("");
  $("lastEdit").textContent = it && it.updatedBy
    ? ("последнее изменение: " + it.updatedBy + (it.updatedAt ? ", " + fmtWhen(it.updatedAt) : ""))
    : "";
  var editable = canEdit(it ? rid(it) : curReg);
  cardEditable = editable;
  $("dlg").querySelectorAll("input,select,textarea").forEach(function(el){
    if(el.closest("#specFields") || el.id.indexOf("f_")===0) el.disabled = !editable;
  });
  if(editable) syncStatusFields();
  lockAttached();
  $("btnSave").hidden = !editable;
  $("btnDel").hidden = !it || !editable;
  if(!editable) $("dlgTitle").textContent += " · только просмотр";
  $("dlg").showModal();
  setTimeout(function(){ if(editable) $("f_inv").focus(); }, 30);
}
$("f_cat").onchange = function(){
  refreshSubSelect(this.value, "");
  refreshTypeSelect(this.value, $("f_sub").value, "");
  renderSpecFields($("f_type").value, null, null);
};
$("f_sub").onchange = function(){
  refreshTypeSelect($("f_cat").value, this.value, "");
  renderSpecFields($("f_type").value, null, null);
};
$("f_type").onchange = function(){
  var cur = {}, none = currentNone();
  document.querySelectorAll("#specFields [data-spec]").forEach(function(el){ cur[el.dataset.spec]=fieldValue(el); });
  renderSpecFields(this.value, cur, none);
};
/* выбрали сотрудника — подставляем его подразделение и отдел, если поля пусты */
$("f_owner").onchange = function(){
  var u = byId("users", this.value); if(!u) return;
  if(!$("f_div").value && u.divisionId){ $("f_div").value = u.divisionId; fillDeps("f_div", "f_dep", $("f_dep").value); }
  if(!$("f_dep").value && u.departmentId) fillDeps("f_div", "f_dep", u.departmentId);
};
$("f_div").onchange = function(){ fillDeps("f_div", "f_dep", $("f_dep").value); };
$("f_dep").onchange = function(){ depPicksDiv("f_div", "f_dep"); };

/* Новые события уходят в historyAdd — автора и время проставляет сервер.
   В history дублируем, чтобы карточка показала запись сразу, не дожидаясь ответа. */
function addHistory(o, text){
  var d = new Date().toLocaleDateString("ru-RU");
  o.history = o.history || [];
  o.historyAdd = o.historyAdd || [];
  o.history.push({d:d, t:text, who: me ? me.name : "", at:new Date().toISOString()});
  o.historyAdd.push({d:d, t:text});
}
/* дата и время события; у старых строк времени нет — только дата */
function histWhen(e){ return e.at ? fmtWhen(e.at) : (e.d || ""); }

/* Номер в учёте бывает двух видов: номенклатурный — 7 цифр, он общий для
   одинаковых единиц (сервер сам допишет /2, /3…), и инвентарный — 10 цифр,
   свой у каждой единицы. Всё остальное — опечатка, и о ней говорим сразу,
   разными словами для разных промахов: так человеку понятнее, что поправить. */
var RE_INV_SUFFIX = new RegExp("/[0-9]+$");
function invKind(v){
  var base = String(v||"").trim().replace(RE_INV_SUFFIX, "");
  if(!base) return "";
  if(!/^[0-9]+$/.test(base)) return "bad";
  return base.length === 7 ? "nom" : base.length === 10 ? "inv" : "bad";
}
function invProblem(v){
  var base = String(v||"").trim().replace(RE_INV_SUFFIX, "");
  if(!base) return "";
  if(!/^[0-9]+$/.test(base)) return "Номер состоит только из цифр: 7 — номенклатурный, 10 — инвентарный";
  var n = base.length;
  if(n < 7)  return "Неправильный номенклатурный номер: в нём 7 цифр, а здесь " + n;
  if(n === 8 || n === 9) return "Что вы хотели написать: номенклатурный (7 цифр) или инвентарный (10 цифр)?";
  if(n > 10) return "Извините, такого инвентарного номера в вашей конторе нет: их 10 цифр, а здесь " + n;
  return "";
}
function showInvHint(){
  var v = $("f_inv").value, h = $("f_invHint"), bad = invProblem(v), k = invKind(v);
  h.style.color = bad ? "var(--danger)" : "";
  h.textContent = bad ? bad
    : k === "nom" ? "номенклатурный номер — у одинаковых единиц сервер допишет /2, /3…"
    : k === "inv" ? "инвентарный номер — свой у каждой единицы" : "";
}
$("f_inv").addEventListener("input", showInvHint);

/* В базу кладём сведения только о тех строках, которые остались: убрали
   строку — ушла и её пометка. */
function slotsToSave(specs){
  var out = {};
  for(var k in curSlots){
    if(!Object.prototype.hasOwnProperty.call(curSlots, k)) continue;
    if(specs[k] === undefined && !curSlots[k].off && !curSlots[k].src) continue;
    var m = {};
    if(curSlots[k].src) m.src = curSlots[k].src;
    if(curSlots[k].off) m.off = curSlots[k].off;
    if(m.src || m.off) out[k] = m;
  }
  return out;
}
function collect(){
  var prev = editingId ? items.find(function(x){ return x.id===editingId; }) : null;
  var specs = {}, none = currentNone();
  document.querySelectorAll("#specFields [data-spec]").forEach(function(el){
    var val = fieldValue(el);
    if(!none[el.dataset.spec] && val!=="") specs[el.dataset.spec] = val;
  });
  var attached = !!(prev && $("f_holder").value === "item" && $("f_parent").value &&
                    items.some(function(x){ return x.id===$("f_parent").value; }));
  var parentWh = function(){ var pp = items.find(function(x){ return x.id===$("f_parent").value; }); return pp ? (pp.warehouse||"") : ""; };
  var o = {
    id: editingId || undefined,
    registryId: prev ? rid(prev) : curReg,
    inv: $("f_inv").value.trim(),
    cost: numVal($("f_cost").value),
    receivedAt: $("f_recv").value || "",
    warrantyUntil: $("f_warr").value || "",
    type: $("f_type").value,
    status: attached ? (prev.status || $("f_status").value) : $("f_status").value,
    owner:      ownerless($("f_status").value) || $("f_holder").value !== "person" ? "" : $("f_owner").value,
    division:   ownerless($("f_status").value) || $("f_holder").value !== "person" ? "" : $("f_div").value,
    department: ownerless($("f_status").value) || $("f_holder").value !== "person" ? "" : $("f_dep").value,
    model:      $("f_model").value,
    holder:     ownerless($("f_status").value) ? "person" : $("f_holder").value,
    place:      $("f_holder").value === "place" ? $("f_place").value : "",
    parent:     $("f_holder").value === "item" ? $("f_parent").value : "",
    hideAttached: $("f_holder").value === "item" && $("f_hide").checked,
    notes: $("f_notes").value.trim(),
    warehouse: isSupplyReg(curReg) ? "" : (attached ? (parentWh() || prev.warehouse || "") : $("f_wh").value),
    masterId:   $("f_status").value===ST_REPAIR ? $("f_master").value : "",
    statusDate: $("wrapSDate").hidden ? "" : $("f_sdate").value,
    statusNote: $("wrapSNote").hidden ? "" : $("f_snote").value.trim(),
    specs: attached ? (prev.specs || {}) : specs,
    specsNone: attached ? (prev.specsNone || {}) : none,
    specSlots: attached ? ((prev && prev.specSlots) || {}) : slotsToSave(specs),
    history: (prev && prev.history) ? prev.history.slice() : []
  };
  var now = new Date().toLocaleDateString("ru-RU");
  if(!prev) addHistory(o, "Добавлено в учёт");
  else {
    var stripped = ownerless(o.status) && !ownerless(prev.status||"") &&
                   (prev.owner || prev.division || prev.department);
    if(stripped){
      addHistory(o, (o.status===ST_TOOFF ? "Передано на списание, снято с сотрудника: "
                                         : "Снято с сотрудника: ")+(ownerName(prev.owner)||"—")+
        (nameById("divisions", prev.division) ? ", "+nameById("divisions", prev.division) : "")+
        (nameById("departments", prev.department) ? ", "+nameById("departments", prev.department) : ""));
    }
    if(prev.status !== o.status){
      var extra = "";
      if(o.status===ST_REPAIR && o.masterId) extra = " (мастер: "+staffName(o.masterId)+")";
      else if(o.status===ST_OFF && o.statusDate) extra = " ("+fmtDate(o.statusDate)+")";
      if(o.statusNote) extra += " — "+o.statusNote;
      addHistory(o, "Статус: "+(prev.status||"—")+" → "+o.status+extra);
    } else if(o.status===ST_REPAIR && (prev.masterId||"") !== o.masterId){
      addHistory(o, "Мастер: "+(staffName(prev.masterId)||"—")+" → "+(staffName(o.masterId)||"—"));
    }
    if(!stripped){
      if((prev.owner||"") !== o.owner) addHistory(o, "Ответственный: "+(ownerName(prev.owner)||"—")+" → "+(ownerName(o.owner)||"—"));
      if((prev.division||"") !== o.division) addHistory(o, "Подразделение: "+(nameById("divisions",prev.division)||"—")+" → "+(nameById("divisions",o.division)||"—"));
      if((prev.department||"") !== o.department) addHistory(o, "Отдел: "+(nameById("departments",prev.department)||"—")+" → "+(nameById("departments",o.department)||"—"));
    }
    if((prev.type||"") !== o.type) addHistory(o, "Тип: "+(typeName(prev.type)||"—")+" → "+(typeName(o.type)||"—"));
    if((prev.model||"") !== o.model) addHistory(o, "Модель: "+(modelName(prev.model)||"—")+" → "+(modelName(o.model)||"—"));
    var hk = function(x){
      var k = x.holder||"person";
      if(k==="place") return "за местом " + (nameById("places", x.place)||"—");
      if(k==="item"){ var pp = items.find(function(y){ return y.id===x.parent; }); return "за оборудованием инв. " + (pp ? pp.inv : "—"); }
      return "за сотрудником";
    };
    if(hk(prev) !== hk(o) && !(ownerless(o.status) && ownerless(prev.status||""))) addHistory(o, "Закреплено: " + hk(prev) + " → " + hk(o));
  }
  return o;
}

$("btnAdd").onclick = function(){ openDlg(null); };
$("btnCancel").onclick = function(){ $("dlg").close(); };
$("btnSave").onclick = function(){
  var o = collect();
  /* прикрепили деталь и указали, какую характеристику она занимает —
     вписываем её в свободную строку основного оборудования */
  var extra = [];
  if($("f_pspec") && $("f_pspec").value && o.holder === "item" && o.parent){
    var parent = items.find(function(x){ return x.id === o.parent; });
    if(parent){
      var sp = cfg.specs.find(function(x){ return x.id === $("f_pspec").value; });
      var val = partValue(o, sp ? sp.name : "");
      var label = fillSlot(parent, $("f_pspec").value, val, "item:" + o.id);
      if(label){
        addHistory(parent, "Установлено: " + label + " — " + val +
                           (o.inv ? " (инв. " + o.inv + ")" : ""));
        extra.push(parent);
      }
    }
  }
  var prevIt = editingId ? items.find(function(x){ return x.id===editingId; }) : null;
  /* Старые записи с номерами другого вида не трогаем: проверяем только то,
     что человек ввёл или поменял сейчас. */
  if(o.inv && (!prevIt || (prevIt.inv||"") !== o.inv)){
    var invErr = invProblem(o.inv);
    if(invErr){ showInvHint(); toast(invErr); $("f_inv").focus(); return; }
  }
  if(!o.inv && !o.type){ toast("Укажите номенклатуру или тип"); return; }
  /* Без категории, типа и склада запись потом не найти и не посчитать —
     заказчик просил сделать их обязательными. Подкатегорию спрашиваем лишь
     там, где она у категории есть. */
  var need = [];
  if(regCats().length && !$("f_cat").value) need.push(["f_cat", "категорию"]);
  else if(regLayout(curReg).subs && subsOf($("f_cat").value).length && !$("f_sub").value) need.push(["f_sub", "подкатегорию"]);
  if(!o.type) need.push(["f_type", "тип"]);
  /* у прикреплённого склад — от основного, его не спрашиваем; пока ни одного
     склада не заведено, выбрать нечего — тогда и не требуем */
  if(!isSupplyReg(curReg) && (cfg.warehouses || []).length && !o.warehouse &&
     !(o.holder === "item" && o.parent)) need.push(["f_wh", "склад"]);
  if(need.length){
    toast("Укажите: " + need.map(function(x){ return x[1]; }).join(", "));
    $(need[0][0]).focus();
    return;
  }
  if(o.status===ST_REPAIR && masters().length && !o.masterId){
    toast("Выберите мастера"); return; }
  if(o.status===ST_USE){
    var miss = [];
    if(o.holder === "place"){
      if(!o.place){ toast("Для статуса «В эксплуатации» укажите место"); $("f_place").focus(); return; }
    } else if(o.holder === "item"){
      if(!o.parent){ toast("Укажите оборудование, к которому прикрепляете"); $("f_parent").focus(); return; }
    } else {
      if(!o.owner)      miss.push("ответственного сотрудника");
      if(!o.division)   miss.push("подразделение");
      if(!o.department) miss.push("отдел");
      if(miss.length){
        toast("Для статуса «В эксплуатации» укажите: " + miss.join(", "));
        $(!o.owner ? "f_owner" : !o.division ? "f_div" : "f_dep").focus();
        return;
      }
    }
  }
  if(o.holder === "item" && !o.parent && !ownerless(o.status)){ toast("Укажите оборудование, к которому прикрепляете"); $("f_parent").focus(); return; }
  if(o.holder === "place" && !o.place && !ownerless(o.status)){ toast("Выберите место"); $("f_place").focus(); return; }
  var bad = validateSpecs();
  if(bad.length){
    toast(bad.length===1 ? bad[0] : "Проверьте характеристики — проблем: "+bad.length);
    var first = document.querySelector("#specFields .bad"); if(first) first.focus();
    return;
  }
  var xfer = null;
  if(editingId && !$("xferWrap").hidden && $("f_xfer").checked){
    if(!$("f_xwh").value){ toast("Выберите склад-получатель"); $("f_xwh").focus(); return; }
    if(!$("f_xnote").value.trim()){ toast("Напишите, почему передаёте"); $("f_xnote").focus(); return; }
    xfer = {toWh:$("f_xwh").value, note:$("f_xnote").value.trim(),
            file:($("f_xfile").files && $("f_xfile").files[0]) || null};
  }
  if(!o.id) o.id = uid();
  var prevItem = editingId ? items.find(function(x){ return x.id===editingId; }) : null;
  if(syncRepairLog(prevItem, o)) saveCfg();
  if(xfer){
    var xid = o.id;
    putLocal(o); renderAll();
    api("/api/items", {items:[o]}).then(function(){
      var fd = new FormData();
      fd.append("itemId", xid); fd.append("toWh", xfer.toWh); fd.append("note", xfer.note);
      if(xfer.file) fd.append("file", xfer.file);
      return fetch("/api/transfer", {method:"POST", body:fd, credentials:"same-origin"})
        .then(function(r){ return r.json().catch(function(){ return {}; })
          .then(function(j){ if(!r.ok){ j.status = r.status; throw j; } return j; }); });
    }).then(function(j){
      /* Прикреплённая техника с основным не уезжает — сервер её открепил.
         На каждую пишем уведомление: иначе смена статуса пройдёт незаметно. */
      var d = (j && j.detached) || [], inv = o.inv ? "инв. " + o.inv : "основное";
      d.forEach(function(x){
        var loc = items.find(function(y){ return y.id === x.id; });
        notify("detach", loc || {id:x.id, inv:x.inv},
               "Откреплено: " + inv + " передано на другой склад, осталось на складе");
      });
      toast(d.length
        ? "Передано на другой склад. Откреплено и осталось на складе: " + d.length
        : "Передано на другой склад");
      return d.length ? saveCfg() : null;
    })
      .catch(function(e){ toast("Передача не выполнена" + (e && e.message ? " — " + e.message : apiWhy(e))); })
      .then(function(){ return loadState().then(loadTransfers); });
    $("dlg").close(); return;
  }
  var qty = (!editingId && o.status===ST_STOCK) ? Math.max(1, parseInt($("f_qty").value,10)||1) : 1;
  if(qty > 1){
    var uf = specsOf(o.type).filter(function(sp){ return sp.uniq && o.specs[sp.id]; });
    if(uf.length){
      toast("Нельзя принять партией: уникальные характеристики заполнены — "+
        uf.map(function(sp){ return sp.name; }).join(", "));
      return;
    }
    var batch = [];
    for(var k=0; k<qty; k++){ var copy = JSON.parse(JSON.stringify(o)); delete copy.id; batch.push(copy); }
    saveItems(batch).then(function(){ toast("Принято на склад: "+qty); });
    $("dlg").close(); return;
  }
  /* основное оборудование, которому досталась строка характеристики,
     сохраняем тем же запросом — иначе правка потеряется */
  if(extra.length) saveItems([o].concat(extra));
  else saveItem(o);
  $("dlg").close();
};
$("attList").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-open]"); if(!tr) return;
  var it = items.find(function(x){ return x.id===tr.dataset.open; });
  if(it){ $("dlg").close(); openDlg(it); }
});
$("btnDel").onclick = function(){
  if(!editingId) return;
  var it = items.find(function(x){ return x.id===editingId; }) || {};
  var what = (it.inv ? "инв. " + it.inv : "без инвентарного номера") +
             (typeName(it.type) ? " · " + typeName(it.type) : "");
  var id = editingId;
  askDeleteReason(what, function(reason){
    var open = openRepairOf(id);
    if(open){ open.to = today(); open.result = "запись удалена"; saveCfg(); }
    deleteItem(id, reason); $("dlg").close();
  });
};
$("tbody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var it = items.find(function(x){ return x.id===tr.dataset.id; }); if(it) openDlg(it);
});
document.querySelectorAll("#tbl th[data-s]").forEach(function(th){
  th.onclick = function(){
    var k = th.dataset.s;
    if(k===sortKey) sortDir=-sortDir; else { sortKey=k; sortDir=1; }
    renderItems();
  };
});

/* Печать «Номенк.» — наклейка на эту единицу оборудования: инвентарный номер,
   название типа и склад. Открывается PDF-ом в новой вкладке: оттуда печатают
   и закрывают, на диск ничего не сохраняется. Данные сервер берёт из базы, а
   не с экрана. Адрес открываем прямо по нажатию — так браузер не примет
   вкладку за всплывающее окно и не заблокирует её. */
$("btnNom").onclick = function(){
  if(!editingId){ toast("Сначала сохраните запись"); return; }
  window.open("/api/items/nomenclature.pdf?ids=" + encodeURIComponent(editingId), "_blank");
};

/* фильтры и поиск списка записей */
$("q").oninput = renderItems;
$("qField").onchange = renderItems;
$("fCat").onchange = function(){ $("fSub").value=""; $("fType").value=""; refreshFilters(); renderItems(); };
$("fSub").onchange = function(){ $("fType").value=""; refreshFilters(); renderItems(); };
$("fType").onchange = renderItems;
/* без своего обработчика выбор модели не действовал, пока не тронешь другой фильтр */
$("fModel").onchange = function(){ markFilters(); renderItems(); };
$("fStatus").onchange = renderItems;
/* фильтр отделов сужается по подразделению: одноимённые отделы разных подразделений не путаются */
$("fDiv").onchange = function(){
  var keep = $("fDep").value;
  $("fDep").innerHTML = depOptions($("fDiv").value, "Все отделы");
  $("fDep").value = keep && $("fDep").querySelector('option[value="'+keep+'"]') ? keep : "";
  renderItems();
};
$("fDep").onchange = renderItems;
$("btnReset").onclick = function(){
  $("fCat").value=""; $("fSub").value=""; $("fType").value=""; $("fStatus").value="";
  $("fDiv").value=""; $("fDep").value=""; $("fModel").value=""; $("fAttach").value="";
  xferOnly = false; refreshFilters(); renderItems();
};
$("btnXferOnly").onclick = function(){ xferOnly = !xferOnly; markFilters(); renderItems(); };
$("fAttach").onchange = renderItems;

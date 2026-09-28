/* Записи раздела: список, фильтры, поиск.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== записи раздела ================== */
function decorated(){
  return regItems().map(function(it){
    var o = Object.assign({}, it);
    o.catId = catOfType(it.type);
    o.catName = nameById("categories", o.catId);
    o.subId = subOfType(it.type);
    o.subName = nameById("subcategories", o.subId);
    o.typeName = typeName(it.type);
    o.modelName = modelName(it.model);
    o.whName = whCode(it.warehouse);
    /* За местом — в колонке ответственного стоит место; за оборудованием —
       показатели того, к чему прикреплено, с пометкой (заказчик так просил:
       «с теми же показателями, что и то оборудование»). */
    var h = holderOf(it);
    if(h.kind === "place"){
      o.ownerName = "⌖ " + (h.placeName || "место не указано");
      o.divName = ""; o.depName = "";
    } else if(h.kind === "item"){
      var pr = h.root;
      o.ownerName = (pr ? ownerName(pr.owner) : "") + (h.parent ? " (за инв. " + (h.parent.inv || "—") + ")" : "");
      o.divName = pr ? nameById("divisions", pr.division) : "";
      o.depName = pr ? nameById("departments", pr.department) : "";
      o.attachedTo = h.parent ? (h.parent.inv || "") : "";
    } else {
      o.ownerName = ownerName(it.owner);
      o.divName = nameById("divisions", it.division);
      o.depName = nameById("departments", it.department);
    }
    return o;
  });
}
/* За кем закреплена единица. Для прикреплённого оборудования поднимаемся к
   корню цепочки (диск → компьютер → сотрудник), не глубже пяти шагов. */
function holderOf(it){
  var kind = it.holder || "person";
  if(kind === "place") return {kind:"place", placeName:nameById("places", it.place)};
  if(kind === "item"){
    var parent = it.parent ? items.find(function(x){ return x.id===it.parent; }) : null;
    if(!parent) return {kind:"person"};
    var root = parent, n = 0;
    while(root && (root.holder||"person")==="item" && root.parent && n < 5){
      var up = items.find(function(x){ return x.id===root.parent; });
      if(!up) break;
      root = up; n++;
    }
    return {kind:"item", parent:parent, root:root};
  }
  return {kind:"person"};
}
/* всё, что прикреплено к записи, и то, что прикреплено к прикреплённому */
function attachedTo(id){
  return items.filter(function(x){ return (x.holder||"person")==="item" && x.parent===id; });
}
/* техника сотрудника: своя плюс прикреплённая к его технике */
function itemsOfPerson(uid){
  return items.filter(function(i){
    if(i.status===ST_OFF) return false;
    var h = holderOf(i);
    if(h.kind === "person") return i.owner===uid;
    if(h.kind === "item") return !!(h.root && (h.root.holder||"person")==="person" && h.root.owner===uid);
    return false;
  });
}
function specVal(it, sp){
  if(it.specsNone && it.specsNone[sp.id]) return "нет";
  var v = it.specs && it.specs[sp.id];
  return v ? String(v) : "";
}
function specText(it){
  return specsOf(it.type).map(function(s){
    var v = specVal(it, s); return v ? s.name+": "+v : "";
  }).filter(Boolean).join("; ");
}
var xferOnly = false;      /* показывать только переданное; живёт до перезагрузки */
var showHiddenAttached = false;   /* выгрузка берёт и скрытое прикреплённое */
function filtered(){
  var q = $("q").value.trim().toLowerCase(), qf = $("qField").value;
  var fc = $("fCat").value, fg = $("fSub").value, ft = $("fType").value,
      fs = $("fStatus").value, fd = $("fDiv").value, fp = $("fDep").value, fm = $("fModel").value;
  var fa = $("fAttach") ? $("fAttach").value : "";
  var list = decorated().filter(function(it){
    /* Прикреплённое с галочкой «убрать из списка» живёт в карточке того, к чему
       прикреплено. Раньше его нельзя было увидеть в списке вовсе — и найти,
       что к чему прикрепили, получалось только перебором карточек. Теперь это
       выбирается фильтром, а в строке стоит метка. */
    var att = it.holder==="item" && !!it.parent, hid = att && !!it.hideAttached;
    if(fa === "att" && !att) return false;
    if(fa === "hid" && !hid) return false;
    if(fa === "own" && att) return false;
    if(hid && !showHiddenAttached && fa !== "all" && fa !== "hid" && fa !== "att") return false;
    if(xferOnly && !it.transferred) return false;
    if(fm && it.model !== fm) return false;
    if(fc && it.catId !== fc) return false;
    if(fg && it.subId !== fg) return false;
    if(ft && it.type !== ft) return false;
    if(fs && it.status !== fs) return false;
    if(fd && it.division !== fd) return false;
    if(fp && it.department !== fp) return false;
    if(!q) return true;
    var hay = qf ? (it[qf] || "")
      : [it.inv,it.catName,it.subName,it.typeName,it.modelName,it.status,it.ownerName,
         it.divName,it.depName,it.notes,specText(it),
         /* по номеру основного тоже ищем: «что прикреплено к 3613501» */
         it.attachedTo ? "прикреплено " + it.attachedTo : ""].join(" ");
    return String(hay).toLowerCase().indexOf(q) !== -1;
  });
  list.sort(function(a,b){
    /* стоимость — число: по строке «9» оказалось бы больше «28769000» */
    if(sortKey === "cost"){
      var na = numVal(a.cost), nb = numVal(b.cost);
      if(na === null && nb === null) return 0;
      if(na === null) return sortDir;
      if(nb === null) return -sortDir;
      return na < nb ? -sortDir : na > nb ? sortDir : 0;
    }
    var x=(a[sortKey]||"").toString().toLowerCase(), y=(b[sortKey]||"").toString().toLowerCase();
    return x<y ? -sortDir : x>y ? sortDir : 0;
  });
  return list;
}
/* Метка «в составе другого»: к чему прикреплено и убрано ли из общего списка.
   Без неё скрытое прикреплённое нигде не видно, а найти его потом трудно. */
function attachMark(it){
  if(!it.attachedTo) return "";
  return ' <span class="chip" title="В составе инв. ' + esc(it.attachedTo) +
    (it.hideAttached ? ", скрыто из общего списка" : "") + '">⛓' +
    (it.hideAttached ? "" : "") + '</span>';
}
function statusBadge(s){
  var c = s===ST_READY ? "b-info"
        : s===ST_TOOFF ? "b-warn"
        : s==="В эксплуатации"||s==="Выдано" ? "b-ok"
        : s==="На складе" ? "b-info"
        : s==="В ремонте" ? "b-warn"
        : s==="Закончилось" ? "b-danger" : "b-mute";
  return '<td title="'+esc(s||"")+'"><span class="badge '+c+'">'+esc(s||"—")+'</span></td>';
}
/* Подсказка к бейджу «передано»: откуда и когда — из последней передачи,
   если список передач уже загружен; без него — просто «передано». */
function xferHint(it){
  var t = null;
  (transfers || []).forEach(function(x){ if(x.itemId === it.id && (!t || x.at > t.at)) t = x; });
  return t ? ("Передано " + fmtWhen(t.at) + " со склада " + (t.fromLabel || "—") +
              " на склад " + (t.toLabel || "—") + (t.note ? ". Примечание: " + t.note : ""))
           : "Передано с другого склада";
}
function statusCell(it){
  if(!it.transferred) return statusBadge(it.status);
  return '<td class="st-x" title="'+esc(it.status||"")+'"><span class="badge b-info">'+esc(it.status||"—")+'</span>'+
         '<span class="badge b-xfer" title="'+esc(xferHint(it))+'">⇢ передано</span></td>';
}
function renderItems(){
  var list = filtered();
  $("tbody").innerHTML = list.map(function(it, i){
    return '<tr class="pick" data-id="'+esc(it.id)+'">'+
      '<td class="num">'+(i+1)+'</td>'+
      '<td class="mono" title="'+esc(it.inv||"")+'">'+esc(it.inv||"")+attachMark(it)+'</td>'+
      '<td class="mono hide-sm" title="'+esc(money(it.cost))+'">'+esc(money(it.cost))+'</td>'+
      cellText(it.catName) +
      '<td class="hide-md" title="'+esc(it.subName||"")+'">'+esc(it.subName||"")+'</td>'+
      cellText(it.typeName) +
      statusCell(it) +
      cellText(it.ownerName) +
      '<td class="mono" title="'+esc(it.whName||"")+'">'+esc(it.whName||"")+'</td>'+
      '<td class="hide-md" title="'+esc(it.divName||"")+'">'+esc(it.divName||"")+'</td>'+
      '<td class="hide-sm" title="'+esc(it.depName||"")+'">'+esc(it.depName||"")+'</td></tr>';
  }).join("");
  var nx = regItems().filter(function(x){ return x.transferred; }).length;
  if(!nx) xferOnly = false;
  $("btnXferOnly").hidden = !nx;
  $("btnXferOnly").textContent = "⇢ Переданные" + (nx ? ": " + nx : "");
  $("btnXferOnly").classList.toggle("on", xferOnly);
  var e = $("itemsEmpty"), total = regItems().length;
  $("itemsCount").textContent = !total ? ""
    : (list.length===total ? "Всего записей: "+total
                           : "Показано: "+list.length+" из "+total);
  markFilters();
  if(!list.length){
    e.hidden=false; $("tbl").style.display="none";
    e.textContent = total ? "Ничего не найдено по текущим фильтрам."
      : "В этом разделе пока пусто. Заведите категории → подкатегории → типы, затем нажмите «+ Добавить запись».";
  } else { e.hidden=true; $("tbl").style.display=""; }
  document.querySelectorAll("#tbl th[data-s]").forEach(function(th){
    th.querySelector(".arr").textContent = th.dataset.s===sortKey ? " ↑".replace("↑", sortDir===1?"↑":"↓") : "";
  });
}

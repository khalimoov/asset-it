/* Справочники раздела: категории, подкатегории, типы, модели, характеристики, наборы.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== категории ================== */
function acts(list){ return '<td class="act">'+list.join("")+'</td>'; }
function renderCategories(){
  $("categoriesBody").innerHTML = regCats().map(function(c, i){
    var tIds = typesOf(c.id).map(function(t){ return t.id; });
    var used = regItems().filter(function(i){ return tIds.indexOf(i.type)!==-1; }).length;
    return '<tr data-id="'+esc(c.id)+'"><td class="num">'+(i+1)+'</td>'+cellText(c.name)+
      '<td>'+subsOf(c.id).length+'</td><td>'+tIds.length+'</td><td>'+used+'</td>'+
      acts(['<button class="ic js-ren" title="Переименовать">✎</button>',
            '<button class="ic btn-danger js-del" title="Удалить">✕</button>'])+'</tr>';
  }).join("");
  $("categoriesEmpty").hidden = regCats().length > 0;
}
function addCategory(){
  var el = $("newCategories"), n = el.value.trim();
  if(!n){ toast("Введите название категории"); return; }
  if(regCats().some(function(c){ return c.name.toLowerCase()===n.toLowerCase(); })){ toast("Такая категория уже есть"); return; }
  cfg.categories.push({id:uid("c"), name:n, registryId:curReg}); el.value=""; saveCfg(); toast("Категория добавлена");
}
document.querySelector('[data-add="categories"]').onclick = addCategory;
$("newCategories").addEventListener("keydown", function(e){ if(e.key==="Enter") addCategory(); });
$("categoriesBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var c = byId("categories", tr.dataset.id); if(!c) return;
  if(e.target.classList.contains("js-ren")){ var n=prompt("Новое название категории:", c.name); if(!n) return; c.name=n.trim(); saveCfg(); }
  if(e.target.classList.contains("js-del")){
    var cnt = typesOf(c.id).length, sub = subsOf(c.id).length;
    if(!confirm("Удалить категорию «"+c.name+"»?"+
        (sub?"\nПодкатегорий внутри: "+sub+" — они останутся, но без категории.":"")+
        (cnt?"\nУ "+cnt+" типов категория станет пустой (сами типы останутся).":""))) return;
    cfg.categories = cfg.categories.filter(function(x){ return x.id!==c.id; });
    cfg.ipPools.forEach(function(x){ if(x.categoryId===c.id) x.categoryId=""; });
    cfg.subcategories.forEach(function(g){ if(g.categoryId===c.id) g.categoryId=""; });
    cfg.types.forEach(function(t){ if(t.categoryId===c.id) t.categoryId=""; });
    saveCfg();
  }
});

/* ================== подкатегории ================== */
function catOptions(sel, empty){
  return '<option value="">'+esc(empty)+'</option>' + regCats().map(function(c){
    return '<option value="'+esc(c.id)+'"'+(c.id===sel?' selected':'')+'>'+esc(c.name)+'</option>'; }).join("");
}
function subOptions(catId, sel, empty){
  return '<option value="">'+esc(empty)+'</option>' + subsOf(catId).map(function(g){
    return '<option value="'+esc(g.id)+'"'+(g.id===sel?' selected':'')+'>'+esc(g.name)+'</option>'; }).join("");
}
function renderSubcategories(){
  var prev = $("newSubCat").value;
  $("newSubCat").innerHTML = catOptions("", regCats().length ? "— без категории —" : "— категории не заведены —");
  if(prev) $("newSubCat").value = prev;
  var sorted = regSubs().slice().sort(function(a,b){
    var ka=(nameById("categories",a.categoryId)+"|"+a.name).toLowerCase(),
        kb=(nameById("categories",b.categoryId)+"|"+b.name).toLowerCase();
    return ka<kb?-1:ka>kb?1:0;
  });
  $("subcategoriesBody").innerHTML = sorted.map(function(g, i){
    var tIds = regTypes().filter(function(t){ return (t.subcategoryId||"")===g.id; }).map(function(t){ return t.id; });
    var used = regItems().filter(function(i){ return tIds.indexOf(i.type)!==-1; }).length;
    return '<tr data-g="'+esc(g.id)+'"><td class="num">'+(i+1)+'</td>'+cellText(g.name)+
      '<td><select class="js-cat">'+catOptions(g.categoryId||"", "— без категории —")+'</select></td>'+
      '<td>'+subSpecs(g.id).length+'</td><td>'+tIds.length+'</td><td>'+used+'</td>'+
      acts(['<button class="ic js-ren" title="Переименовать">✎</button>',
            '<button class="ic js-spec" title="Стандартные характеристики">≡</button>',
            '<button class="ic btn-danger js-del" title="Удалить">✕</button>'])+'</tr>';
  }).join("");
  $("subcategoriesEmpty").hidden = regSubs().length > 0;
}
function addSubcategory(){
  var el = $("newSubcategories"), nm = el.value.trim(), cid = $("newSubCat").value;
  if(!nm){ toast("Введите название подкатегории"); return; }
  if(regSubs().some(function(g){ return g.name.toLowerCase()===nm.toLowerCase() && (g.categoryId||"")===cid; })){
    toast("Такая подкатегория уже есть в этой категории"); return; }
  cfg.subcategories.push({id:uid("g"), name:nm, categoryId:cid, registryId:curReg});
  el.value=""; saveCfg(); toast("Подкатегория добавлена");
}
$("btnAddSub").onclick = addSubcategory;
$("newSubcategories").addEventListener("keydown", function(e){ if(e.key==="Enter") addSubcategory(); });
$("subcategoriesBody").addEventListener("change", function(e){
  if(!e.target.classList.contains("js-cat")) return;
  var g = byId("subcategories", e.target.closest("tr").dataset.g); if(!g) return;
  g.categoryId = e.target.value;
  cfg.types.forEach(function(t){ if(t.subcategoryId===g.id) t.categoryId = g.categoryId; });
  saveCfg();
});
$("subcategoriesBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var g = byId("subcategories", tr.dataset.g); if(!g) return;
  if(e.target.classList.contains("js-ren")){ var nm=prompt("Новое название подкатегории:", g.name); if(!nm) return; g.name=nm.trim(); saveCfg(); }
  if(e.target.classList.contains("js-spec")){ curSpecScope="sub:"+g.id; goTab("specs"); renderSpecs(); }
  if(e.target.classList.contains("js-del")){
    var tCnt = regTypes().filter(function(t){ return (t.subcategoryId||"")===g.id; }).length,
        sCnt = subSpecs(g.id).length;
    if(!confirm("Удалить подкатегорию «"+g.name+"»?"+
        (sCnt?"\nБудут удалены её стандартные характеристики: "+sCnt+".":"")+
        (tCnt?"\nТипов внутри: "+tCnt+" — они останутся, но потеряют стандартные характеристики.":""))) return;
    cfg.types.forEach(function(t){ if(t.subcategoryId===g.id){ t.categoryId = t.categoryId || g.categoryId || ""; t.subcategoryId=""; } });
    cfg.specs = cfg.specs.filter(function(x){ return x.subcategoryId!==g.id; });
    cfg.subcategories = cfg.subcategories.filter(function(x){ return x.id!==g.id; });
    if(curSpecScope==="sub:"+g.id) curSpecScope="";
    saveCfg();
  }
});

/* ================== типы ================== */
function renderTypes(){
  var pc = $("newTypeCat").value, pg = $("newTypeSub").value;
  $("newTypeCat").innerHTML = catOptions("", regCats().length ? "— без категории —" : "— категории не заведены —");
  if(pc) $("newTypeCat").value = pc;
  $("newTypeSub").innerHTML = subOptions($("newTypeCat").value, "", "— без подкатегории —");
  if(pg && subsOf($("newTypeCat").value).some(function(g){ return g.id===pg; })) $("newTypeSub").value = pg;
  var sorted = regTypes().slice().sort(function(a,b){
    var ka=(nameById("categories",catOfType(a.id))+"|"+nameById("subcategories",a.subcategoryId)+"|"+a.name).toLowerCase(),
        kb=(nameById("categories",catOfType(b.id))+"|"+nameById("subcategories",b.subcategoryId)+"|"+b.name).toLowerCase();
    return ka<kb?-1:ka>kb?1:0;
  });
  $("typesBody").innerHTML = sorted.map(function(t, i){
    var used = regItems().filter(function(i){return i.type===t.id;}).length, cid = catOfType(t.id);
    var std = t.subcategoryId ? subSpecs(t.subcategoryId).length : 0, own = ownSpecs(t.id).length;
    return '<tr data-t="'+esc(t.id)+'"><td class="num">'+(i+1)+'</td>'+cellText(t.name)+
      '<td><select class="js-cat">'+catOptions(cid, "— без категории —")+'</select></td>'+
      '<td><select class="js-sub">'+subOptions(cid, t.subcategoryId||"", "— без подкатегории —")+'</select></td>'+
      '<td>'+(std+own)+(std?' <span class="chip">станд. '+std+'</span>':'')+'</td><td>'+used+'</td>'+
      acts(['<button class="ic js-ren" title="Переименовать">✎</button>',
            '<button class="ic js-spec" title="Характеристики типа">≡</button>',
            '<button class="ic btn-danger js-del" title="Удалить">✕</button>'])+'</tr>';
  }).join("");
  $("typesEmpty").hidden = regTypes().length > 0;
}
/* ================== модели ==================
   Модель — справочник раздела, как и тип, но отдельный: в карточке она идёт
   перед типом. Фото хранится на сервере и в состояние не попадает. */
/* Область применения модели: «раздел + категория + подкатегория». Областей
   может быть несколько; у старых моделей их нет — тогда считаем, что модель
   годится всему своему разделу. Категория и подкатегория необязательны:
   пустая означает «любая». */
function modelScopes(m){
  var sc = (m.scopes || []).filter(function(x){ return x.registryId; });
  return sc.length ? sc : [{registryId: rid(m), categoryId:"", subcategoryId:""}];
}
function modelFits(m, regId, catId, subId){
  return modelScopes(m).some(function(x){
    if((x.registryId||"") !== regId) return false;
    /* сужение учитываем только когда есть с чем сравнивать: пока категория
       в карточке не выбрана, прятать модель рано */
    if(x.categoryId && catId && x.categoryId !== catId) return false;
    if(x.subcategoryId && subId && x.subcategoryId !== subId) return false;
    return true;
  });
}
function regModels(id){
  id = id || curReg;
  return cfg.models.filter(function(m){ return modelFits(m, id, "", ""); });
}
function cardModels(){
  return cfg.models.filter(function(m){
    return modelFits(m, curReg, $("f_cat").value || "", $("f_sub").value || "");
  });
}
function modelName(id){ return nameById("models", id); }
var editingModel = null;
function renderModels(){
  if(!$("modelsBody")) return;
  var keepReg = $("newModelReg").value;
  $("newModelReg").innerHTML = assetRegs().map(function(r){
    return '<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>'; }).join("");
  if(keepReg) $("newModelReg").value = keepReg;
  var list = cfg.models.slice().sort(function(a,b){
    var ka = (nameById("registries", rid(a)) + "|" + a.name).toLowerCase(), kb = (nameById("registries", rid(b)) + "|" + b.name).toLowerCase();
    return ka<kb?-1:ka>kb?1:0; });
  var mayEdit = can("dict.edit");
  $("modelsBody").innerHTML = list.map(function(m, i){
    var used = items.filter(function(x){ return x.model===m.id; }).length;
    var pic = m.hasPhoto
      ? '<img class="mthumb js-thumb" data-m="'+esc(m.id)+'" src="/api/models/'+encodeURIComponent(m.id)+'/photo?v='+Date.now()+'" alt="" title="">'
      : '<div class="mthumb-none" title="фото нет">▣</div>';
    return '<tr data-m="'+esc(m.id)+'"><td class="num">'+(i+1)+'</td><td>'+pic+'</td>'+
      '<td class="pick js-open" title="Показать оборудование этой модели">'+esc(m.name)+'</td>'+
      cellText(nameById("registries", rid(m))||"—") +
      cellText(m.note||"")+'<td class="pick js-open">'+used+'</td>'+
      acts(mayEdit
        ? ['<button class="ic js-edit" title="Изменить, фото">✎</button>',
           '<button class="ic btn-danger js-del"'+(used?' disabled title="Модель используется"':' title="Удалить"')+'>✕</button>']
        : [])+'</tr>';
  }).join("");
  $("modelsEmpty").hidden = list.length > 0;
}
$("btnAddModel").onclick = function(){
  var n = $("newModel").value.trim(), rg = $("newModelReg").value;
  if(!rg){ toast("Выберите раздел учёта"); return; }
  if(!n){ toast("Введите название модели"); return; }
  if(regModels(rg).some(function(m){ return m.name.toLowerCase()===n.toLowerCase(); })){ toast("Такая модель уже есть в этом разделе"); return; }
  cfg.models.push({id:uid("mdl"), name:n, note:$("newModelNote").value.trim(), registryId:rg, hasPhoto:false});
  $("newModel").value=""; $("newModelNote").value="";
  $("addModel").hidden = true;
  saveCfg(); toast("Модель добавлена");
};
$("btnShowModel").onclick = function(){
  $("addModel").hidden = !$("addModel").hidden;
  if(!$("addModel").hidden) $("newModel").focus();
};
$("newModel").addEventListener("keydown", function(e){ if(e.key==="Enter") $("btnAddModel").click(); });
$("modelsBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-m]"); if(!tr) return;
  var m = byId("models", tr.dataset.m); if(!m) return;
  if(e.target.closest(".js-del")){
    if(!confirm("Удалить модель «"+m.name+"»?")) return;
    cfg.models = cfg.models.filter(function(x){ return x.id!==m.id; });
    saveCfg(); toast("Удалено"); return;
  }
  if(e.target.closest(".js-edit")){ openModel(m); return; }
  if(e.target.closest(".js-open") || e.target.closest(".js-thumb")){ openModelItems(m); }
});
/* наведение на миниатюру — фото побольше рядом с курсором */
(function(){
  var pop = $("photoPop"), img = $("photoPopImg");
  function move(e){
    var w = pop.offsetWidth || 380, h = pop.offsetHeight || 380;
    var x = e.clientX + 18, y = e.clientY + 18;
    if(x + w > window.innerWidth - 8) x = e.clientX - w - 18;
    if(y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    pop.style.left = x + "px"; pop.style.top = y + "px";
  }
  $("modelsBody").addEventListener("mouseover", function(e){
    var t = e.target.closest(".js-thumb"); if(!t) return;
    img.src = t.src; pop.hidden = false; move(e);
  });
  $("modelsBody").addEventListener("mousemove", function(e){
    if(!pop.hidden && e.target.closest(".js-thumb")) move(e);
  });
  $("modelsBody").addEventListener("mouseout", function(e){
    if(e.target.closest(".js-thumb")) pop.hidden = true;
  });
})();
/* карточка модели: фото, сведения и всё оборудование этой модели */
var curModelItems = null;
function openModelItems(m){
  curModelItems = m.id;
  $("dlgMiTitle").textContent = "Модель: " + m.name;
  $("mi_photo").hidden = !m.hasPhoto;
  if(m.hasPhoto) $("mi_photo").src = "/api/models/"+encodeURIComponent(m.id)+"/photo?v="+Date.now();
  var list = items.filter(function(x){ return x.model===m.id; });
  var kv = function(k, v){ return '<div><span>'+esc(k)+'</span><b>'+esc(v||"—")+'</b></div>'; };
  $("mi_kv").innerHTML = kv("Раздел", nameById("registries", rid(m))) + kv("Примечание", m.note) +
    kv("Единиц", String(list.length)) +
    kv("В эксплуатации", String(list.filter(function(x){ return x.status===ST_USE; }).length)) +
    kv("На складе", String(list.filter(function(x){ return x.status===ST_STOCK; }).length));
  $("mi_count").textContent = list.length ? "всего: " + list.length : "";
  $("mi_items").innerHTML = miniTable(
    ["Инв. номер","Тип","Статус","Ответственный","Склад","Подразделение"],
    list.map(function(x){
      var h = holderOf(x), who = h.kind==="place" ? "⌖ " + (h.placeName||"") : h.kind==="item" ? (h.root ? ownerName(h.root.owner) : "") + (h.parent ? " (за инв. " + (h.parent.inv||"—") + ")" : "") : ownerName(x.owner);
      return [x.inv||"", typeName(x.type)||"", x.status||"", who, whCode(x.warehouse)||"", nameById("divisions", (h.kind==="item" && h.root) ? h.root.division : x.division)||""];
    }),
    "Оборудования этой модели пока нет.", list.map(function(x){ return x.id; }));
  $("btnMiEdit").hidden = !can("dict.edit");
  $("dlgModelItems").showModal();
}
$("mi_items").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-open]"); if(!tr) return;
  var it = items.find(function(x){ return x.id===tr.dataset.open; }); if(!it) return;
  $("dlgModelItems").close();
  if(rid(it) !== curReg) openReg(rid(it), "items");
  openDlg(it);
});
$("btnMiClose").onclick = function(){ $("dlgModelItems").close(); };
$("btnMiEdit").onclick = function(){
  var m = byId("models", curModelItems); $("dlgModelItems").close(); if(m) openModel(m); };
$("btnMiList").onclick = function(){
  var m = byId("models", curModelItems); $("dlgModelItems").close(); if(!m) return;
  openReg(rid(m), "items");
  $("fModel").value = m.id; markFilters(); renderItems();
};
var msDraft = [];
function msRender(){
  /* только разделы техники: у материала модель не своя, он берёт её из железа */
  var regs = assetRegs();
  $("msBody").innerHTML = msDraft.map(function(x, i){
    var cats = cfg.categories.filter(function(c){ return (c.registryId||"") === x.registryId; });
    var subs = cfg.subcategories.filter(function(g){
      return (g.registryId||"") === x.registryId &&
             (!x.categoryId || (g.categoryId||"") === x.categoryId); });
    var pick = function(cls, list, sel, empty){
      return '<select class="'+cls+'"><option value="">'+esc(empty)+'</option>' +
        list.map(function(o){
          return '<option value="'+esc(o.id)+'"'+(o.id===sel?' selected':'')+'>'+esc(o.name)+'</option>';
        }).join("") + '</select>';
    };
    return '<tr data-s="'+i+'"><td class="num">'+(i+1)+'</td>'+
      '<td>'+pick("js-msreg", regs, x.registryId, "— выберите —")+'</td>'+
      '<td>'+pick("js-mscat", cats, x.categoryId, "любая")+'</td>'+
      '<td>'+pick("js-mssub", subs, x.subcategoryId, "любая")+'</td>'+
      '<td class="act"><button class="ic btn-danger js-msdel" title="Убрать область">✕</button></td></tr>';
  }).join("");
  $("msEmpty").hidden = msDraft.length > 0;
}
function msRead(){
  var out = [];
  document.querySelectorAll("#msBody tr").forEach(function(tr){
    out.push({id: msDraft[parseInt(tr.dataset.s, 10)] && msDraft[parseInt(tr.dataset.s, 10)].id || "",
              registryId: tr.querySelector(".js-msreg").value,
              categoryId: tr.querySelector(".js-mscat").value,
              subcategoryId: tr.querySelector(".js-mssub").value});
  });
  return out;
}
$("btnMsAdd").onclick = function(){
  msDraft = msRead();
  msDraft.push({id:"", registryId: rid(byId("models", editingModel) || {}) || curReg,
                categoryId:"", subcategoryId:""});
  msRender();
};
$("msBody").addEventListener("click", function(e){
  if(!e.target.classList.contains("js-msdel")) return;
  var i = parseInt(e.target.closest("tr").dataset.s, 10);
  msDraft = msRead(); msDraft.splice(i, 1); msRender();
});
$("msBody").addEventListener("change", function(e){
  /* сменили раздел или категорию — списки ниже надо пересобрать */
  var i = parseInt(e.target.closest("tr").dataset.s, 10);
  msDraft = msRead();
  if(e.target.classList.contains("js-msreg")){
    msDraft[i].categoryId = ""; msDraft[i].subcategoryId = "";
  } else if(e.target.classList.contains("js-mscat")){
    msDraft[i].subcategoryId = "";
  }
  msRender();
});

function openModel(m){
  editingModel = m.id;
  msDraft = modelScopes(m).map(function(x){
    return {id:x.id||"", registryId:x.registryId||"",
            categoryId:x.categoryId||"", subcategoryId:x.subcategoryId||""};
  });
  msRender();
  $("dlgModelTitle").textContent = "Модель: " + m.name;
  $("m_name").value = m.name; $("m_note").value = m.note||""; $("m_file").value = "";
  $("m_err").textContent = "";
  $("m_photoWrap").hidden = !m.hasPhoto;
  if(m.hasPhoto) $("m_preview").src = "/api/models/"+encodeURIComponent(m.id)+"/photo?v="+Date.now();
  $("btnModelDel").hidden = items.some(function(x){ return x.model===m.id; });
  $("dlgModel").showModal();
}
$("btnModelCancel").onclick = function(){ $("dlgModel").close(); };
$("btnModelDel").onclick = function(){
  var m = byId("models", editingModel); if(!m) return;
  if(!confirm("Удалить модель «"+m.name+"»?")) return;
  cfg.models = cfg.models.filter(function(x){ return x.id!==m.id; });
  $("dlgModel").close(); saveCfg(); toast("Удалено");
};
$("btnModelPhotoDel").onclick = function(){
  var m = byId("models", editingModel); if(!m) return;
  api("/api/models/"+encodeURIComponent(m.id)+"/photo/delete", {})
    .then(function(){ m.hasPhoto = false; $("m_photoWrap").hidden = true; renderModels(); toast("Фото убрано"); })
    .catch(apiError);
};
$("btnModelSave").onclick = function(){
  var m = byId("models", editingModel); if(!m) return;
  var n = $("m_name").value.trim();
  if(!n){ $("m_err").textContent = "Введите название"; return; }
  if(regModels(rid(m)).some(function(x){ return x.id!==m.id && x.name.toLowerCase()===n.toLowerCase(); })){
    $("m_err").textContent = "Такая модель уже есть"; return; }
  m.name = n; m.note = $("m_note").value.trim();
  m.scopes = msRead().filter(function(x){ return x.registryId; });
  /* раздел самой модели держим первым из областей: по нему она попадает
     в выборку состояния, и без него сервер её просто не отдаст */
  if(m.scopes.length) m.registryId = m.scopes[0].registryId;
  var f = $("m_file").files && $("m_file").files[0];
  var p = saveCfg();
  if(f){
    var fd = new FormData(); fd.append("file", f);
    p = p.then(function(){
      return fetch("/api/models/"+encodeURIComponent(m.id)+"/photo", {method:"POST", body:fd, credentials:"same-origin"})
        .then(function(r){ return r.json().catch(function(){ return {}; })
          .then(function(j){ if(!r.ok){ j.status = r.status; throw j; } return j; }); })
        .then(function(){ m.hasPhoto = true; renderModels(); toast("Фото сохранено"); });
    }).catch(function(e){ toast("Фото не загрузилось" + (e && e.message ? " — " + e.message : apiWhy(e))); });
  }
  $("dlgModel").close(); toast("Сохранено");
};

$("btnAddType").onclick = function(){
  var n = $("newType").value.trim();
  if(!n){ toast("Введите название типа"); return; }
  var gid = $("newTypeSub").value, g = byId("subcategories", gid);
  if(regTypes().some(function(t){ return t.name.toLowerCase()===n.toLowerCase() && (t.subcategoryId||"")===gid; })){
    toast("Такой тип уже есть в этой подкатегории"); return; }
  cfg.types.push({id:uid("t"), name:n, subcategoryId:gid, registryId:curReg,
    categoryId: g ? (g.categoryId||"") : $("newTypeCat").value});
  $("newType").value=""; saveCfg(); toast("Тип добавлен");
};
$("newTypeCat").onchange = function(){ $("newTypeSub").innerHTML = subOptions(this.value, "", "— без подкатегории —"); };
$("newType").addEventListener("keydown", function(e){ if(e.key==="Enter") $("btnAddType").click(); });
$("typesBody").addEventListener("change", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var t = byId("types", tr.dataset.t); if(!t) return;
  if(e.target.classList.contains("js-cat")){
    t.categoryId = e.target.value;
    var g = byId("subcategories", t.subcategoryId);
    if(g && (g.categoryId||"") !== t.categoryId) t.subcategoryId = "";
    saveCfg();
  }
  if(e.target.classList.contains("js-sub")){
    t.subcategoryId = e.target.value;
    var g2 = byId("subcategories", t.subcategoryId);
    if(g2) t.categoryId = g2.categoryId||"";
    saveCfg();
  }
});
$("typesBody").addEventListener("click", function(e){
  var tr = e.target.closest("tr"); if(!tr) return;
  var t = byId("types", tr.dataset.t); if(!t) return;
  if(e.target.classList.contains("js-ren")){ var n=prompt("Новое название типа:", t.name); if(!n) return; t.name=n.trim(); saveCfg(); }
  if(e.target.classList.contains("js-spec")){ curSpecScope="type:"+t.id; goTab("specs"); renderSpecs(); }
  if(e.target.classList.contains("js-del")){
    var used = regItems().filter(function(i){ return i.type===t.id; }).length;
    if(!confirm("Удалить тип «"+t.name+"»?"+(used?"\nОн используется в "+used+" позициях.":"")+
                "\nЕго собственные характеристики тоже будут удалены (стандартные останутся у подкатегории).")) return;
    cfg.types = cfg.types.filter(function(x){ return x.id!==t.id; });
    cfg.specs = cfg.specs.filter(function(s){ return s.typeId!==t.id; });
    if(curSpecScope==="type:"+t.id) curSpecScope=""; saveCfg();
  }
});

/* ================== характеристики ================== */
function scopeOptions(){
  var html = "", subs = regSubs(), tps = regTypes();
  if(subs.length){
    html += '<optgroup label="Стандартные — для всей подкатегории">' + subs.map(function(g){
      var c = nameById("categories", g.categoryId);
      return '<option value="sub:'+esc(g.id)+'">'+esc(g.name)+(c?" — "+esc(c):"")+'</option>';
    }).join("") + '</optgroup>';
  }
  if(tps.length){
    html += '<optgroup label="Только для одного типа">' + tps.map(function(t){
      var g = nameById("subcategories", t.subcategoryId) || nameById("categories", t.categoryId);
      return '<option value="type:'+esc(t.id)+'">'+esc(t.name)+(g?" — "+esc(g):"")+'</option>';
    }).join("") + '</optgroup>';
  }
  return html;
}
function kindCell(sp, editable){
  if(!editable) return '<td title="'+esc(KIND[sp.kind]||sp.kind)+'">'+esc(KIND[sp.kind]||sp.kind)+'</td>';
  return '<td><select data-kindsel>'+Object.keys(KIND).map(function(k){
    return '<option value="'+k+'"'+(k===sp.kind?' selected':'')+'>'+esc(KIND[k])+'</option>'; }).join("")+'</select></td>';
}
function unitCell(sp, editable){
  if(sp.kind!=="ip") return '<td title="'+esc(sp.unit||"—")+'">'+esc(sp.unit||"—")+'</td>';
  if(!editable) return '<td title="'+esc(poolLabel(sp.poolId))+'">'+esc(poolLabel(sp.poolId))+'</td>';
  return '<td><select data-poolsel>'+poolOptions(sp.poolId||"")+'</select></td>';
}
function reqChip(sp){
  if(!sp.req) return "";
  var rs = sp.reqStatuses;
  /* «всегда» не пишем: обязательность и так видна по галочке. Подпись
     оставляем только когда она сужена статусами — это не очевидно. */
  if(!rs || !rs.length) return "";
  return '<span class="chip" title="обязательна при: '+esc(rs.join(", "))+'">при: '+esc(rs.join(", "))+'</span>';
}
/* off — унаследованная характеристика, отключённая у этого типа */
function specRow(sp, std, editable, i, inheritType, off){
  return '<tr data-s="'+esc(sp.id)+'"><td class="num">'+((i|0)+1)+'</td>'+
    '<td title="'+esc(sp.name)+(sp.group?" · "+esc(sp.group):"")+'">'+esc(sp.name)+
      (sp.group?' <span class="chip">'+esc(sp.group)+'</span>':'')+'</td>'+
    '<td>'+(std?'<span class="badge b-info">стандартная</span>':'<span class="badge b-mute">только тип</span>')+
      (off?' <span class="badge b-warn">не используется</span>':'')+'</td>'+
    '<td class="rules">'+(editable
      ? '<label class="chk"><input type="checkbox" data-rule="req"'+(sp.req?' checked':'')+'> обяз.</label>'+
        '<label class="chk"><input type="checkbox" data-rule="uniq"'+(sp.uniq?' checked':'')+'> уник.</label>'+
        '<label class="chk"><input type="checkbox" data-rule="opt"'+(sp.opt?' checked':'')+'> «нет значения»</label>'+
        '<label class="chk"><input type="checkbox" data-rule="multi"'+(sp.multi?' checked':'')+'> несколько</label>'+
        reqChip(sp)
      : ((sp.req?'<span class="chip">обяз.</span>'+reqChip(sp):'')+(sp.uniq?'<span class="chip">уник.</span>':'')+
         (sp.opt?'<span class="chip">можно без значения</span>':'')+
         (sp.multi?'<span class="chip">несколько</span>':'') || "—"))+'</td>'+
    kindCell(sp, editable) + unitCell(sp, editable) +
    '<td title="'+esc((sp.options||[]).join(", "))+'">'+
      ((sp.options&&sp.options.length)?sp.options.map(function(o){return '<span class="chip">'+esc(o)+'</span>';}).join(""):"—")+'</td>'+
    acts(editable
      ? ['<button class="ic js-reqcfg" title="Группа и статусы обязательности">⚙</button>',
         '<button class="ic btn-danger js-delspec" title="Удалить">✕</button>']
      : (inheritType
          ? [off
              ? '<button class="btn-sm js-specback" title="Вернуть эту характеристику типу">Вернуть</button>'
              : '<button class="btn-sm btn-danger js-specoff" title="Не использовать у этого типа">Убрать</button>']
          : ['<span class="chip">в подкат.</span>']))+'</tr>';
}
function renderSpecs(){
  syncSpecForm();
  var sel = $("specScope"), prev = curSpecScope || sel.value;
  sel.innerHTML = scopeOptions() || '<option value="">— сначала заведите подкатегории или типы —</option>';
  if(prev && sel.querySelector('option[value="'+prev+'"]')) sel.value = prev;
  curSpecScope = sel.value;
  var lvl = curSpecScope.split(":")[0], id = curSpecScope.slice(lvl.length+1);
  var rows = [], hint = "", emptyMsg = "";
  if(lvl==="sub"){
    var g = byId("subcategories", id) || {};
    var tCnt = regTypes().filter(function(t){ return (t.subcategoryId||"")===g.id; }).length;
    hint = "Эти характеристики автоматически действуют для всех типов подкатегории «"+(g.name||"")+"». Типов внутри: "+tCnt+".";
    rows = subSpecs(id).map(function(sp, i){ return specRow(sp, true, true, i); });
    emptyMsg = "Стандартные характеристики для этой подкатегории ещё не заданы.";
  } else if(lvl==="type"){
    var t = byId("types", id) || {}, gname = nameById("subcategories", t.subcategoryId);
    hint = t.subcategoryId
      ? "Стандартные характеристики подкатегории «"+gname+"» действуют здесь автоматически и меняются только на её уровне. Ниже можно добавить характеристики, уникальные для типа."
      : "У типа нет подкатегории — укажите её на вкладке «Типы», чтобы он получил стандартные характеристики.";
    /* показываем и отключённые: иначе их не вернуть */
    var inh = (t.subcategoryId ? subSpecs(t.subcategoryId) : []);
    rows = inh.map(function(sp, i){
        return specRow(sp, true, false, i, t, specHidden(t, sp.id)); })
      .concat(ownSpecs(id).map(function(sp, i){ return specRow(sp, false, true, inh.length + i); }));
    emptyMsg = "Для этого типа характеристики ещё не заданы.";
  } else {
    emptyMsg = "Сначала заведите подкатегории или типы.";
  }
  $("specHint").textContent = hint;
  $("presetRow").hidden = (lvl !== "sub" && lvl !== "type");
  if(!$("presetRow").hidden){
    var ap = $("applyPreset"), keepP = ap.value, mine = regPresets();
    ap.innerHTML = mine.length
      ? mine.map(function(pr){
          return '<option value="'+esc(pr.id)+'">'+esc(pr.name)+' — характеристик: '+((pr.specs||[]).length)+'</option>'; }).join("")
      : '<option value="">— наборы не созданы —</option>';
    if(keepP && mine.some(function(pr){ return pr.id===keepP; })) ap.value = keepP;
    $("btnApplyPreset").disabled = !mine.length;
    $("btnTagPreset").disabled = !mine.length;
    $("applyHint").textContent = mine.length
      ? (lvl==="sub" ? "станут стандартными для всей подкатегории" : "добавятся только этому типу")
      : "создайте набор на вкладке «Наборы»";
  }
  $("specsBody").innerHTML = rows.join("");
  var se = $("specsEmpty"); se.hidden = rows.length>0; se.textContent = emptyMsg;
}
$("specsBody").addEventListener("click", function(e){
  var off = e.target.closest(".js-specoff"), back = e.target.closest(".js-specback");
  if(!off && !back) return;
  var lvl = curSpecScope.split(":")[0], id = curSpecScope.slice(lvl.length + 1);
  if(lvl !== "type") return;
  var t = byId("types", id); if(!t) return;
  var specId = e.target.closest("tr").dataset.s;
  var sp = cfg.specs.find(function(x){ return x.id === specId; });
  t.hiddenSpecs = hiddenOf(t).slice();
  if(off){
    if(t.hiddenSpecs.indexOf(specId) === -1) t.hiddenSpecs.push(specId);
    toast("«" + (sp ? sp.name : "характеристика") + "» больше не используется у этого типа");
  } else {
    t.hiddenSpecs = t.hiddenSpecs.filter(function(x){ return x !== specId; });
    toast("«" + (sp ? sp.name : "характеристика") + "» снова используется");
  }
  saveCfg();
});
$("specScope").onchange = function(){ curSpecScope=this.value; renderSpecs(); };
function statusChecks(boxId, statuses, checked){
  $(boxId).innerHTML = statuses.map(function(st, i){
    return '<label class="chk"><input type="checkbox" data-st="'+esc(st)+'"'+
      ((!checked || checked.indexOf(st)!==-1) ? ' checked' : '')+'> '+esc(st)+'</label>';
  }).join("");
}
function pickedStatuses(boxId, statuses){
  var out = [];
  $(boxId).querySelectorAll("[data-st]").forEach(function(el){ if(el.checked) out.push(el.dataset.st); });
  return out.length===statuses.length ? [] : out;   /* все отмечены — значит «всегда» */
}
function syncSpecForm(){
  var k = $("newSpecKind").value;
  $("optWrap").hidden = k!=="list";
  $("poolWrap").hidden = k!=="ip";
  if(k==="ip"){ var keep = $("newSpecPool").value; $("newSpecPool").innerHTML = poolOptions(keep); }
  var req = $("newSpecReq").checked;
  $("reqStWrap").hidden = !req;
  if(req && !$("newSpecReqSts").children.length) statusChecks("newSpecReqSts", statusesOf(), null);
}
$("newSpecReq").onchange = syncSpecForm;
$("newSpecKind").onchange = syncSpecForm;
$("btnAddSpec").onclick = function(){
  var lvl = curSpecScope.split(":")[0], id = curSpecScope.slice(lvl.length+1);
  if(lvl!=="sub" && lvl!=="type"){ toast("Сначала выберите подкатегорию или тип"); return; }
  var nm = $("newSpecName").value.trim();
  if(!nm){ toast("Введите название характеристики"); return; }
  if((lvl==="sub" ? subSpecs(id) : specsOf(id)).some(function(sp){ return sp.name.toLowerCase()===nm.toLowerCase(); })){
    toast("Такая характеристика уже есть"); return; }
  var k = $("newSpecKind").value;
  var rec = {id:uid("s"), name:nm, kind:k, unit:$("newSpecUnit").value.trim(),
    options: k==="list" ? $("newSpecOpts").value.split(",").map(function(x){return x.trim();}).filter(Boolean) : [],
    req: $("newSpecReq").checked, uniq: $("newSpecUniq").checked, opt: $("newSpecOpt").checked,
    multi: $("newSpecMulti").checked,
    poolId: k==="ip" ? $("newSpecPool").value : "",
    group: $("newSpecGroup").value.trim(),
    reqStatuses: $("newSpecReq").checked ? pickedStatuses("newSpecReqSts", statusesOf()) : []};
  if(lvl==="sub") rec.subcategoryId = id; else rec.typeId = id;
  cfg.specs.push(rec);
  $("newSpecName").value=""; $("newSpecUnit").value=""; $("newSpecOpts").value="";
  $("newSpecReq").checked=false; $("newSpecUniq").checked=false; $("newSpecOpt").checked=false;
  $("newSpecMulti").checked=false;
  $("newSpecPool").value=""; $("newSpecGroup").value="";
  statusChecks("newSpecReqSts", statusesOf(), null); $("reqStWrap").hidden = true;
  saveCfg(); toast(lvl==="sub" ? "Стандартная характеристика добавлена" : "Характеристика добавлена");
};
$("newSpecName").addEventListener("keydown", function(e){ if(e.key==="Enter") $("btnAddSpec").click(); });
$("specsBody").addEventListener("change", function(e){
  if(!can("registry.manage")){ toast("Настройка характеристик доступна администратору"); renderSpecs(); return; }
  var tr0 = e.target.closest("tr"); if(!tr0) return;
  var target = cfg.specs.find(function(x){ return x.id===tr0.dataset.s; }); if(!target) return;
  if(e.target.hasAttribute("data-kindsel")){
    target.kind = e.target.value;
    if(target.kind==="list" && !(target.options||[]).length){
      var o = prompt("Варианты через запятую:", "");
      target.options = o ? String(o).split(",").map(function(x){ return x.trim(); }).filter(Boolean) : [];
    }
    if(target.kind!=="ip") target.poolId = "";
    saveCfg(); toast("Вид значения изменён"); return;
  }
  if(e.target.hasAttribute("data-poolsel")){ target.poolId = e.target.value; saveCfg(); return; }
  var rule = e.target.dataset && e.target.dataset.rule; if(!rule) return;
  var sp = target;
  sp[rule] = e.target.checked;
  if(rule==="uniq" && e.target.checked){
    var seen = {}, dupes = 0;
    items.forEach(function(it){
      if(it.specsNone && it.specsNone[sp.id]) return;
      var v = it.specs && it.specs[sp.id]; if(!v) return;
      var k = normVal(sp, v); if(seen[k]) dupes++; else seen[k] = 1;
    });
    if(dupes) toast("Внимание: среди заведённых позиций есть повторы — "+dupes);
  }
  saveCfg();
});
var editingReq = null;
$("specsBody").addEventListener("click", function(e){
  if(e.target.classList.contains("js-reqcfg")){
    var sp = cfg.specs.find(function(x){ return x.id===e.target.closest("tr").dataset.s; }); if(!sp) return;
    editingReq = sp.id;
    $("reqTitle").textContent = "Правила: " + sp.name;
    $("req_group").value = sp.group || "";
    statusChecks("req_sts", statusesForSpec(sp), (sp.reqStatuses && sp.reqStatuses.length) ? sp.reqStatuses : null);
    $("reqAllWrap").hidden = !sp.group;
    $("req_all").checked = !!sp.group;
    $("dlgReq").showModal();
    return;
  }
  if(!e.target.classList.contains("js-delspec")) return;
  var sp = cfg.specs.find(function(x){ return x.id===e.target.closest("tr").dataset.s; }); if(!sp) return;
  if(!confirm("Удалить характеристику «"+sp.name+"»?"+
     (sp.subcategoryId?"\nОна исчезнет у всех типов этой подкатегории.":""))) return;
  cfg.specs = cfg.specs.filter(function(x){ return x.id!==sp.id; }); saveCfg();
});
$("btnReqCancel").onclick = function(){ $("dlgReq").close(); };
$("btnReqSave").onclick = function(){
  var sp = cfg.specs.find(function(x){ return x.id===editingReq; }); if(!sp) return;
  var oldGroup = sp.group || "", newGroup = $("req_group").value.trim();
  var rs = pickedStatuses("req_sts", statusesForSpec(sp));
  var targets = [sp];
  if($("req_all").checked && oldGroup){
    targets = cfg.specs.filter(function(x){
      return (x.group||"")===oldGroup && regOfSpec(x)===regOfSpec(sp); });
  }
  targets.forEach(function(x){ x.group = newGroup; x.reqStatuses = rs.slice(); });
  saveCfg(); $("dlgReq").close();
  toast(targets.length>1 ? "Правила применены к группе: "+targets.length : "Правила сохранены");
};

/* для наборов, применённых до появления групп: проставить группу по совпадению названий */
$("btnTagPreset").onclick = function(){
  var lvl = curSpecScope.split(":")[0], id = curSpecScope.slice(lvl.length+1);
  if(lvl!=="sub" && lvl!=="type"){ toast("Сначала выберите подкатегорию или тип"); return; }
  var pr = cfg.presets.find(function(x){ return x.id===$("applyPreset").value; });
  if(!pr || !(pr.specs||[]).length){ toast("В наборе нет характеристик"); return; }
  var names = pr.specs.map(function(t){ return t.name.trim().toLowerCase(); });
  var mine = (lvl==="sub" ? subSpecs(id) : ownSpecs(id)), tagged = 0;
  mine.forEach(function(sp){
    if(names.indexOf(sp.name.trim().toLowerCase())!==-1 && (sp.group||"")!==pr.name){
      sp.group = pr.name; tagged++;
    }
  });
  if(!tagged){ toast("Нечего отмечать — совпадений по названиям нет"); return; }
  saveCfg(); toast("Отмечено группой «"+pr.name+"»: "+tagged);
};

$("btnApplyPreset").onclick = function(){
  var lvl = curSpecScope.split(":")[0], id = curSpecScope.slice(lvl.length+1);
  if(lvl!=="sub" && lvl!=="type"){ toast("Сначала выберите подкатегорию или тип"); return; }
  var pr = cfg.presets.find(function(x){ return x.id===$("applyPreset").value; });
  if(!pr || !(pr.specs||[]).length){ toast("В наборе нет характеристик"); return; }
  var have = (lvl==="sub" ? subSpecs(id) : specsOf(id)), added = 0, skipped = 0;
  pr.specs.forEach(function(t){
    if(have.some(function(sp){ return sp.name.trim().toLowerCase()===t.name.trim().toLowerCase(); })){ skipped++; return; }
    var rec = {id:uid("s"), name:t.name, kind:t.kind, unit:t.unit||"", options:(t.options||[]).slice(),
      req:!!t.req, uniq:!!t.uniq, opt:!!t.opt, multi:!!t.multi, poolId:t.poolId||"",
      group: t.group || pr.name, reqStatuses: (t.reqStatuses||[]).slice()};
    if(lvl==="sub") rec.subcategoryId = id; else rec.typeId = id;
    cfg.specs.push(rec); added++;
  });
  if(!added){ toast("Эти характеристики уже заведены"); return; }
  saveCfg(); toast("Добавлено характеристик: "+added+(skipped?", пропущено: "+skipped:""));
};

/* ================== наборы ================== */
function curPresetObj(){ return cfg.presets.find(function(p){ return p.id===curPreset; }) || null; }
/* Набор принадлежит своему разделу учёта: набор для компьютеров незачем
   показывать в рациях. У наборов, заведённых до этого, раздела нет — они
   остаются общими, пока их не закрепят кнопкой. */
function regPresets(){
  return cfg.presets.filter(function(p){
    return !p.registryId || p.registryId === curReg;
  });
}
function renderPresets(){
  syncPresetForm();
  var mine = regPresets();
  var sel = $("presetSel"), prev = curPreset || sel.value;
  sel.innerHTML = mine.length
    ? mine.map(function(p){
        return '<option value="'+esc(p.id)+'">'+esc(p.name)+' — характеристик: '+((p.specs||[]).length)+
               (p.registryId ? '' : ' · общий')+'</option>'; }).join("")
    : '<option value="">— наборы не созданы —</option>';
  if(prev && mine.some(function(p){ return p.id===prev; })) sel.value = prev;
  curPreset = sel.value;
  var p = curPresetObj(), list = p ? (p.specs||[]) : [];
  $("presetSpecsBody").innerHTML = list.map(function(sp, i){
    return '<tr data-s="'+esc(sp.id)+'"><td class="num">'+(i+1)+'</td>'+cellText(sp.name)+
      '<td class="rules">'+
        '<label class="chk"><input type="checkbox" data-rule="req"'+(sp.req?' checked':'')+'> обяз.</label>'+
        '<label class="chk"><input type="checkbox" data-rule="uniq"'+(sp.uniq?' checked':'')+'> уник.</label>'+
        '<label class="chk"><input type="checkbox" data-rule="opt"'+(sp.opt?' checked':'')+'> «нет значения»</label>'+
        '<label class="chk"><input type="checkbox" data-rule="multi"'+(sp.multi?' checked':'')+'> несколько</label></td>'+
      kindCell(sp, false) + unitCell(sp, false) +
      '<td title="'+esc((sp.options||[]).join(", "))+'">'+
        ((sp.options&&sp.options.length)?sp.options.map(function(o){return '<span class="chip">'+esc(o)+'</span>';}).join(""):"—")+'</td>'+
      acts(['<button class="ic btn-danger js-delpspec" title="Убрать из набора">✕</button>'])+'</tr>';
  }).join("");
  var pe = $("presetsEmpty"); pe.hidden = list.length>0;
  pe.textContent = mine.length ? "В этом наборе ещё нет характеристик."
    : "Наборов пока нет. Создайте набор выше — например «Компьютер» или «Телефон».";
  $("btnRenPreset").disabled = !p; $("btnDelPreset").disabled = !p; $("btnAddPresetSpec").disabled = !p;
  /* общий набор можно закрепить за этим разделом — тогда в других он пропадёт */
  if($("btnPresetHere")) $("btnPresetHere").hidden = !(p && !p.registryId);
}
function addPreset(){
  var el = $("newPresets"), nm = el.value.trim();
  if(!nm){ toast("Введите название набора"); return; }
  /* одноимённые наборы в разных разделах допустимы: это разные наборы */
  if(regPresets().some(function(p){ return p.name.toLowerCase()===nm.toLowerCase(); })){
    toast("Такой набор уже есть в этом разделе"); return; }
  var p = {id:uid("n"), name:nm, specs:[], registryId:curReg};
  cfg.presets.push(p); curPreset = p.id; el.value=""; saveCfg(); toast("Набор создан");
}
document.querySelector('[data-add="presets"]').onclick = addPreset;
$("newPresets").addEventListener("keydown", function(e){ if(e.key==="Enter") addPreset(); });
$("presetSel").onchange = function(){ curPreset=this.value; renderPresets(); };
function syncPresetForm(){
  var k = $("pKind").value;
  $("pOptWrap").hidden = k!=="list";
  $("pPoolWrap").hidden = k!=="ip";
  if(k==="ip"){ var keep = $("pPool").value; $("pPool").innerHTML = poolOptions(keep); }
}
$("pKind").onchange = syncPresetForm;
$("btnRenPreset").onclick = function(){
  var p = curPresetObj(); if(!p) return;
  var nm = prompt("Новое название набора:", p.name); if(!nm) return;
  p.name = nm.trim(); saveCfg();
};
$("btnDelPreset").onclick = function(){
  var p = curPresetObj(); if(!p) return;
  if(!confirm("Удалить набор «"+p.name+"»?\nУже применённые характеристики останутся на месте.")) return;
  cfg.presets = cfg.presets.filter(function(x){ return x.id!==p.id; });
  curPreset = ""; saveCfg(); toast("Набор удалён");
};
$("btnAddPresetSpec").onclick = function(){
  var p = curPresetObj();
  if(!p){ toast("Сначала создайте или выберите набор"); return; }
  var nm = $("pName").value.trim();
  if(!nm){ toast("Введите название характеристики"); return; }
  if((p.specs||[]).some(function(sp){ return sp.name.toLowerCase()===nm.toLowerCase(); })){
    toast("В этом наборе такая характеристика уже есть"); return; }
  var k = $("pKind").value;
  p.specs = p.specs || [];
  p.specs.push({id:uid("ps"), name:nm, kind:k, unit:$("pUnit").value.trim(),
    options: k==="list" ? $("pOpts").value.split(",").map(function(x){return x.trim();}).filter(Boolean) : [],
    req:$("pReq").checked, uniq:$("pUniq").checked, opt:$("pOpt").checked,
    multi:$("pMulti").checked,
    poolId: k==="ip" ? $("pPool").value : ""});
  $("pName").value=""; $("pUnit").value=""; $("pOpts").value="";
  $("pReq").checked=false; $("pUniq").checked=false; $("pOpt").checked=false;
  $("pMulti").checked=false;
  $("pPool").value="";
  saveCfg(); toast("Добавлено в набор");
};
$("pName").addEventListener("keydown", function(e){ if(e.key==="Enter") $("btnAddPresetSpec").click(); });
$("btnPresetHere").onclick = function(){
  var p = curPresetObj(); if(!p) return;
  p.registryId = curReg;
  saveCfg(); toast("Набор «" + p.name + "» закреплён за разделом «" + (reg(curReg)||{}).name + "»");
};
$("presetSpecsBody").addEventListener("change", function(e){
  var rule = e.target.dataset && e.target.dataset.rule; if(!rule) return;
  var p = curPresetObj(); if(!p) return;
  var sp = (p.specs||[]).find(function(x){ return x.id===e.target.closest("tr").dataset.s; }); if(!sp) return;
  sp[rule] = e.target.checked; saveCfg();
});
$("presetSpecsBody").addEventListener("click", function(e){
  if(!e.target.classList.contains("js-delpspec")) return;
  var p = curPresetObj(); if(!p) return;
  var id = e.target.closest("tr").dataset.s;
  var sp = (p.specs||[]).find(function(x){ return x.id===id; }); if(!sp) return;
  if(!confirm("Убрать «"+sp.name+"» из набора «"+p.name+"»?")) return;
  p.specs = p.specs.filter(function(x){ return x.id!==id; }); saveCfg();
});

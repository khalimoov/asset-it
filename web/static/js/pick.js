/* Поле с подсказками вместо длинных списков.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== поле с подсказками ==================
   Длинный список (сотрудники, техника, места) заменён полем ввода: набираешь
   часть имени, номера или типа — ниже подсказки. Сам <select> остаётся, только
   скрыт: прежний код по-прежнему заполняет его, читает и ставит value, слушает
   change — поле лишь показывает выбранное и выбирает за человека. */
var pickCur = null;          /* открытый список: {place, close} */
var SEL_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
function makePick(selId){
  var sel = $(selId); if(!sel || sel._pick) return;
  var inp = document.createElement("input"), list = document.createElement("div");
  inp.id = "pk_" + selId; inp.autocomplete = "off"; inp.spellcheck = false;
  list.className = "pick-list"; list.hidden = true;
  sel.parentNode.insertBefore(inp, sel.nextSibling);
  sel.parentNode.insertBefore(list, inp.nextSibling);
  sel.hidden = true;
  sel._pick = inp;
  /* подпись по-прежнему смотрит на select (её текст меняют по id) — ведём фокус сами */
  var lab = document.querySelector('label[for="'+selId+'"]');
  if(lab) lab.addEventListener("click", function(){ if(!inp.disabled) inp.focus(); });
  sel.focus = function(){ inp.focus(); };
  Object.defineProperty(sel, "value", {configurable:true,
    get: function(){ return SEL_VALUE.get.call(sel); },
    set: function(v){ SEL_VALUE.set.call(sel, v); show(); }});

  function cur(){ var o = sel.options[sel.selectedIndex]; return o && o.value ? o : null; }
  function blank(){ return Array.prototype.find.call(sel.options, function(o){ return !o.value; }); }
  function show(){
    var b = blank();
    inp.placeholder = b ? b.textContent.replace(/^[—\s]+|[—\s]+$/g, "") : "";
    inp.disabled = sel.disabled;
    /* пока человек набирает, его текст не трогаем */
    if(document.activeElement !== inp){ var o = cur(); inp.value = o ? o.textContent : ""; }
  }
  new MutationObserver(show).observe(sel, {childList:true, subtree:true, attributes:true,
                                            attributeFilter:["disabled"]});
  show();

  var hits = [], act = -1;
  function groupOf(o){ return o.parentNode && o.parentNode.tagName === "OPTGROUP" ? o.parentNode.label : ""; }
  function find(q){
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return Array.prototype.filter.call(sel.options, function(o){
      if(!o.value || o.disabled) return false;
      var t = (o.textContent + " " + groupOf(o)).toLowerCase();
      return words.every(function(w){ return t.indexOf(w) !== -1; });
    });
  }
  function paint(){
    Array.prototype.forEach.call(list.querySelectorAll(".pick-it"), function(el){
      var on = +el.dataset.i === act;
      el.classList.toggle("on", on);
      if(on && el.scrollIntoView) el.scrollIntoView({block:"nearest"});
    });
  }
  function place(){
    var r = inp.getBoundingClientRect(), below = window.innerHeight - r.bottom - 10;
    list.style.left = r.left + "px";
    list.style.width = r.width + "px";
    if(below < 160 && r.top > below){
      list.style.top = ""; list.style.bottom = (window.innerHeight - r.top + 2) + "px";
      list.style.maxHeight = Math.min(300, r.top - 10) + "px";
    } else {
      list.style.bottom = ""; list.style.top = (r.bottom + 2) + "px";
      list.style.maxHeight = Math.min(300, below) + "px";
    }
  }
  function open(q){
    var all = find(q), LIM = 60;
    hits = all.slice(0, LIM);
    act = hits.length ? 0 : -1;
    list.innerHTML = hits.length
      ? hits.map(function(o, i){
          var g = groupOf(o);
          return '<div class="pick-it" data-i="'+i+'"><span class="pick-t">'+esc(o.textContent)+'</span>'+
                 (g ? '<span class="pick-g">'+esc(g)+'</span>' : '')+'</div>';
        }).join("") +
        (all.length > LIM ? '<div class="pick-more">ещё '+(all.length-LIM)+' — уточните запрос</div>' : '')
      : '<div class="pick-more">'+(sel.options.length > 1 || cur() ? "ничего не найдено" : esc(inp.placeholder || "список пуст"))+'</div>';
    list.hidden = false;
    place(); paint();
    pickCur = {place:place, close:close};
  }
  function close(){ list.hidden = true; if(pickCur && pickCur.close === close) pickCur = null; }
  function choose(o){
    SEL_VALUE.set.call(sel, o ? o.value : "");
    inp.value = o ? o.textContent : "";
    close();
    sel.dispatchEvent(new Event("change", {bubbles:true}));
  }
  inp.addEventListener("focus", function(){ show(); inp.select(); open(""); });
  inp.addEventListener("input", function(){ open(inp.value.trim()); });
  inp.addEventListener("keydown", function(e){
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      if(list.hidden){ open(inp.value.trim()); return; }
      if(hits.length) act = (act + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      paint();
    } else if(e.key === "Enter"){
      if(!list.hidden && act >= 0){ e.preventDefault(); e.stopPropagation(); choose(hits[act]); }
    } else if(e.key === "Escape" && !list.hidden){
      /* первый Escape закрывает подсказки, а не всё окно */
      e.preventDefault(); e.stopPropagation(); close(); show();
    }
  });
  list.addEventListener("mousedown", function(e){
    e.preventDefault();          /* фокус остаётся в поле, blur не срабатывает */
    var el = e.target.closest(".pick-it");
    if(el) choose(hits[+el.dataset.i]);
  });
  /* ушли из поля: пусто — сбросили выбор; набрано ровно одно из списка — берём его;
     иначе возвращаем прежнее, чтобы в поле не остался текст, которого нет в списке */
  inp.addEventListener("blur", function(){
    close();
    var t = inp.value.trim(), o = cur();
    if(!t){ if(o && blank()) choose(null); else show(); return; }
    if(o && t === o.textContent) return;
    var same = Array.prototype.filter.call(sel.options, function(x){
      return x.value && x.textContent.toLowerCase() === t.toLowerCase(); });
    var all = same.length === 1 ? same : find(t);
    if(all.length === 1) choose(all[0]); else show();
  });
}
document.addEventListener("scroll", function(){ if(pickCur) pickCur.place(); }, true);
window.addEventListener("resize", function(){ if(pickCur) pickCur.place(); });
["isUser", "isItem", "f_owner", "f_place", "f_parent", "ipm_owner"].forEach(makePick);

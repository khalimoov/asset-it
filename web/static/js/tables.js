/* Сортировка по колонкам в таблицах.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== сортировка по колонкам остальных таблиц ==================
   У таблицы записей сортировка своя — по полям, а не по тексту ячейки (иначе
   стоимость «9» оказалась бы больше «28 769 000»). Её не трогаем, а всем
   прочим таблицам хватает сортировки по тому, что видно в ячейке. Числа и
   даты распознаём, чтобы не сравнивать их как строки. */
var tblSort = {};        /* ключ таблицы -> {i:номер колонки, dir:1|-1} */
var sortingNow = false;  /* строки двигаем сами — наблюдатель не должен отвечать на это */

function tblKey(t){ return (t.tBodies[0] && t.tBodies[0].id) || t.id || ""; }
function cellVal(tr, i){
  var td = tr.cells[i];
  if(!td) return "";
  var s = (td.textContent || "").trim();
  var d = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
  if(d) return d[3] + d[2] + d[1];              /* дата — как ггггммдд */
  var n = s.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if(n && /^-?\d+(\.\d+)?$/.test(n)) return parseFloat(n);
  return s.toLowerCase();
}
function applyTblSort(t){
  var st = tblSort[tblKey(t)], tb = t.tBodies[0];
  if(!tb) return;
  var head = t.tHead && t.tHead.rows[0];
  if(head) Array.prototype.forEach.call(head.cells, function(th, i){
    if(th.dataset.s) return;
    var a = th.querySelector(".arr2");
    if(!a){ a = document.createElement("span"); a.className = "arr2"; th.appendChild(a); }
    a.textContent = (st && st.i === i) ? (st.dir === 1 ? " ↑" : " ↓") : "";
  });
  if(!st || tb.rows.length < 2) return;
  var was = Array.prototype.slice.call(tb.rows);
  var rows = was.slice();
  rows.sort(function(a, b){
    var x = cellVal(a, st.i), y = cellVal(b, st.i);
    if(typeof x === "number" && typeof y === "number") return (x - y) * st.dir;
    x = String(x); y = String(y);
    return x < y ? -st.dir : x > y ? st.dir : 0;
  });
  /* Если порядок уже такой — не трогаем строки вовсе. Иначе наблюдатель ниже
     увидит нашу же перестановку, отсортирует снова, и так до бесконечности:
     колбэк MutationObserver приходит позже, флаг к тому времени уже снят. */
  var same = rows.every(function(r, n){ return r === was[n]; });
  if(same) return;
  sortingNow = true;
  rows.forEach(function(r){ tb.appendChild(r); });
  /* колонка «#» — порядковый номер строки, а не данные: перенумеровываем */
  rows.forEach(function(r, n){
    var c = r.cells[0];
    if(c && c.classList.contains("num")) c.textContent = n + 1;
  });
  sortingNow = false;
}
document.addEventListener("click", function(e){
  var th = e.target.closest ? e.target.closest("thead th") : null;
  if(!th || th.dataset.s) return;
  if(th.classList.contains("num") || !(th.textContent || "").trim()) return;  /* «#» и колонка кнопок */
  var t = th.closest("table");
  if(!t || !t.tBodies[0]) return;
  var i = Array.prototype.indexOf.call(th.parentNode.cells, th);
  var k = tblKey(t), st = tblSort[k];
  tblSort[k] = (st && st.i === i) ? {i:i, dir:-st.dir} : {i:i, dir:1};
  applyTblSort(t);
});
/* таблицы перерисовываются из двух десятков мест — вместо правки каждой
   следим за телом таблицы и возвращаем выбранный порядок после перерисовки */
(function(){
  if(!window.MutationObserver) return;
  var mo = new MutationObserver(function(recs){
    if(sortingNow) return;
    var done = {};
    recs.forEach(function(r){
      var t = r.target.closest ? r.target.closest("table") : null;
      if(!t) return;
      var k = tblKey(t);
      if(done[k] || !tblSort[k]) return;
      done[k] = 1;
      applyTblSort(t);
    });
  });
  document.querySelectorAll("table").forEach(function(t){
    if(t.tBodies[0] && !t.querySelector("th[data-s]")) {
      Array.prototype.forEach.call((t.tHead && t.tHead.rows[0] ? t.tHead.rows[0].cells : []), function(th){
        if(!th.classList.contains("num") && (th.textContent || "").trim()) th.classList.add("sortable");
      });
      mo.observe(t.tBodies[0], {childList:true});
    }
  });
})();

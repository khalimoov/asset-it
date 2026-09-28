/* Уведомления.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== уведомления ================== */
var NTC_ICON = {repair:"⚒", ready:"✓", off:"✕", done:"↩", detach:"⇥"};
function renderNotices(){
  var q = $("qNtc").value.trim().toLowerCase();
  var src = scopeWide() ? scopePick(cross.notices) : cfg.notices;
  var list = src.filter(function(x){
    if(!q) return true;
    return [x.text, x.inv, x.typeName, staffName(x.masterId),
            (reg(x.registryId)||{}).name].join(" ").toLowerCase().indexOf(q)!==-1;
  });
  var card = function(x){
    var r = reg(x.registryId) || {};
    return '<div class="ntc'+(x.seen?'':' new')+'" data-n="'+esc(x.id)+'">'+
      '<div class="ico">'+esc(NTC_ICON[x.type]||"•")+'</div>'+
      '<div class="body"><b>'+esc(x.text)+'</b>'+
        '<span>'+esc(scopeWide() ? (x.orgName||"") : (r.name||""))+(x.inv?' · инв. '+esc(x.inv):'')+
          (x.typeName?' · '+esc(x.typeName):'')+'</span></div>'+
      '<div class="when">'+esc(fmtWhen(x.at))+'</div></div>';
  };
  var fresh = list.filter(function(x){ return !x.seen; });
  var seen  = list.filter(function(x){ return x.seen; });
  $("noticesList").innerHTML =
    (fresh.length ? '<div class="grphead">Новые · '+fresh.length+'</div>' + fresh.map(card).join("") : "") +
    (seen.length  ? '<div class="grphead">Прочитанные · '+seen.length+'</div>' + seen.map(card).join("") : "");
  var e = $("noticesEmpty"); e.hidden = list.length>0;
  e.textContent = cfg.notices.length ? "Ничего не найдено." : "Уведомлений пока нет.";
  $("btnNtcRead").disabled = !unseenNotices();
}
$("qNtc").oninput = renderNotices;
$("noticesList").addEventListener("click", function(e){
  var el = e.target.closest("[data-n]"); if(!el) return;
  var x = cfg.notices.find(function(y){ return y.id===el.dataset.n; }); if(!x) return;
  if(!x.seen){ x.seen = true; saveCfg(); }
  if(x.itemId) openItemById(x.itemId);
});
$("btnNtcRead").onclick = function(){
  cfg.notices.forEach(function(x){ x.seen = true; });
  saveCfg(); toast("Все отмечены прочитанными");
};

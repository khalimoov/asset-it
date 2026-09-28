/* Общий рендер и запуск.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== общий рендер ================== */
function renderAll(){
  renderScopePick();
  if(!cfg.registries.some(function(r){ return r.id===curReg; })) curReg = (cfg.registries[0]||{}).id || "equipment";
  render();
  renderDash(); renderRegDash();
  refreshFilters(); renderItems();
  renderCategories(); renderSubcategories(); renderTypes(); renderModels(); renderSpecs(); renderPresets();
  renderSup(); renderIps(); renderUsers(); renderStaff(); renderNotices(); renderRepairs();
  renderRoles(); renderDels(); renderOverview(); renderDocs(); renderWhs();
  Object.keys(SIMPLE).forEach(renderSimple);
}

cfg = normCfg(null);
loadState();

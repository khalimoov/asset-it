/* Выгрузка и загрузка: Excel, CSV.
   Часть страницы «Учёт ИТ-отдела»; порядок файлов задан в web/index.html. */
"use strict";

/* ================== выгрузка в Excel (.xlsx) ==================
   Книга собирается вручную: xlsx — это обычный zip с несколькими xml.
   Внешних библиотек нет намеренно: приложение должно оставаться одним файлом.
   Складываем без сжатия (метод 0) — Excel такие архивы открывает,
   а кода на дефлейт не нужно вовсе. */

function crc32(d){
  var t = crc32.tab;
  if(!t){
    t = crc32.tab = new Int32Array(256);
    for(var i=0;i<256;i++){
      var c = i;
      for(var k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
  }
  var crc = -1;
  for(var j=0;j<d.length;j++) crc = (crc >>> 8) ^ t[(crc ^ d[j]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

/* files: [{name, data:Uint8Array}] → Blob с zip-архивом */
function zipStore(files){
  var enc = new TextEncoder(), parts = [], central = [], offset = 0;
  /* дата в zip хранится в формате MS-DOS: секунды с шагом 2 */
  var now = new Date();
  var dosTime = (now.getHours()<<11) | (now.getMinutes()<<5) | (now.getSeconds()>>1);
  var dosDate = ((now.getFullYear()-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate();

  files.forEach(function(f){
    var name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    var h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);            /* имена в utf-8 */
    h.setUint16(8, 0, true);                 /* без сжатия */
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);

    var c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + sz;
  });

  var cdSize = central.reduce(function(a,x){ return a + x.length; }, 0);
  var end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]),
                  {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}

function xesc(v){
  return String(v==null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"");
}
function colLetter(i){
  var s = "";
  for(i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}
/* Числом пишем только то, что числом и является: инвентарные номера
   и всё с ведущим нулём остаётся текстом, иначе Excel съест нули. */
function asNumber(v, textCol){
  if(textCol) return null;
  var t = String(v == null ? "" : v).trim().replace(",", ".");
  if(!t || t.length > 15 || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  if(/^-?0\d/.test(t)) return null;
  return t;
}

/* t = {sheet, head, rows, band:{from,title}, textCols:[i,...]} */
function xlsxSheet(t){
  var head = t.head, rows = t.rows;
  /* сводный отчёт приходит «рваным» — строки разной длины; дотягиваем до общей ширины */
  var nc = head.length;
  rows.forEach(function(r){ if(r.length > nc) nc = r.length; });
  var band = (!t.plain && t.band && t.band.from < nc - 1) ? t.band : null;
  var hRow = band ? 2 : 1, textCols = t.textCols || [];
  var out = [];

  /* ширина колонок — по самому длинному значению, с разумными пределами */
  var cols = [];
  for(var i=0;i<nc;i++){
    var w = String(head[i] || "").length;
    rows.forEach(function(r){ var v = String(r[i] == null ? "" : r[i]); if(v.length > w) w = v.length; });
    cols.push('<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+
              Math.min(46, Math.max(9, w + 2))+'" customWidth="1"/>');
  }

  function cell(ref, style, val, textCol){
    var num = asNumber(val, textCol);
    if(num !== null) return '<c r="'+ref+'" s="'+style+'"><v>'+num+'</v></c>';
    var txt = String(val == null ? "" : val);
    if(!txt) return '<c r="'+ref+'" s="'+style+'"/>';
    return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+
           xesc(txt)+'</t></is></c>';
  }

  if(band){
    var b = ['<row r="1" ht="18" customHeight="1">'];
    for(var k=0;k<nc;k++)
      b.push('<c r="'+colLetter(k)+'1" s="'+(k >= band.from ? 2 : 1)+'"'+
             (k === band.from ? ' t="inlineStr"><is><t>'+xesc(band.title)+'</t></is></c>' : '/>'));
    out.push(b.join("") + '</row>');
  }
  var h = ['<row r="'+hRow+'" ht="28" customHeight="1">'];
  head.forEach(function(v, i){ h.push(cell(colLetter(i)+hRow, 1, v, true)); });
  out.push(h.join("") + '</row>');

  rows.forEach(function(r, ri){
    var rn = ri + hRow + 1, line = ['<row r="'+rn+'">'];
    for(var i=0;i<nc;i++)
      line.push(cell(colLetter(i)+rn, 3, r[i], textCols.indexOf(i) !== -1));
    out.push(line.join("") + '</row>');
  });

  var last = colLetter(nc - 1), lastRow = rows.length + hRow;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
    (t.plain ? '' :
      '<pane ySplit="'+hRow+'" topLeftCell="A'+(hRow+1)+'" activePane="bottomLeft" state="frozen"/>') +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    '<cols>'+cols.join("")+'</cols>' +
    '<sheetData>'+out.join("")+'</sheetData>' +
    (t.plain ? '' : '<autoFilter ref="A'+hRow+':'+last+Math.max(lastRow, hRow)+'"/>') +
    (band ? '<mergeCells count="1"><mergeCell ref="'+colLetter(band.from)+'1:'+last+'1"/></mergeCells>' : '') +
    '</worksheet>';
}

var XL_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="4"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FFB7B7B7"/></left><right style="thin"><color rgb="FFB7B7B7"/></right>' +
  '<top style="thin"><color rgb="FFB7B7B7"/></top><bottom style="thin"><color rgb="FFB7B7B7"/></bottom>' +
  '<diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function saveXlsx(t, fname){
  var enc = new TextEncoder();
  var name = String(t.sheet || "Лист1").replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31) || "Лист1";
  var f = function(n, x){ return {name:n, data:enc.encode(x)}; };
  var blob = zipStore([
    f("[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>'),
    f("_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'),
    f("xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="'+xesc(name)+'" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    f("xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>'),
    f("xl/styles.xml", XL_STYLES),
    f("xl/worksheets/sheet1.xml", xlsxSheet(t)),
  ]);
  saveBlob(blob, fname);
}

/* ================== выгрузка: один набор данных, два формата ==================
   Кнопки «Экспорт CSV» и «Экспорт Excel» зовут одни и те же сборщики данных,
   а формат выбирает expFmt — чтобы не держать две ветки на каждый отчёт. */
var expFmt = "csv";
function saveTable(t, base){
  if(expFmt === "xlsx") saveXlsx(t, base + ".xlsx");
  else saveCSV(csvLines(t.head, t.rows), base + ".csv");
}
/* отчёты со строками разной длины (сводка, карта пула) */
function saveBlock(sheet, rows, base){
  if(expFmt === "xlsx")
    saveXlsx({sheet:sheet, head:rows[0]||[], rows:rows.slice(1), plain:true}, base + ".xlsx");
  else saveCSV(csvBlock(rows), base + ".csv");
}

/* ================== CSV ================== */
var BASE = [["inv","Инвентарный номер"],["cost","Стоимость"],
  ["catName","Категория"],["subName","Подкатегория"],
  ["modelName","Модель"],["typeName","Тип"],["status","Статус"],["ownerName","Ответственный сотрудник"],
  ["divName","Подразделение"],["depName","Отдел"],["notes","Примечание"]];

/* Каждая характеристика уезжает в собственную колонку: ОЗУ, диск, IP, имя ПК —
   так их видно в Excel по отдельности. Одноимённые характеристики из разных
   подкатегорий сводим в одну колонку, чтобы их не размножилось на пол-листа. */
function specColumns(list, seed){
  var cols = [], byKey = {};
  function add(sp){
    var key = sp.name.trim().toLowerCase() + "|" + (sp.unit||"").trim().toLowerCase();
    var col = byKey[key];
    if(!col){ col = byKey[key] = {title: sp.name + (sp.unit ? ", "+sp.unit : ""), ids: []};
              cols.push(col); }
    if(col.ids.indexOf(sp.id) === -1) col.ids.push(sp.id);
  }
  (seed||[]).forEach(add);
  list.forEach(function(it){ specsOf(it.type).forEach(add); });
  return cols;
}
function colVal(it, col){
  for(var i=0; i<col.ids.length; i++){
    if(it.specsNone && it.specsNone[col.ids[i]]) return "нет";
    var v = it.specs && it.specs[col.ids[i]];
    if(v) return String(v);
  }
  return "";
}

function exportCSV(){
  showHiddenAttached = true;
  var list = filtered(); showHiddenAttached = false;
  var ft = $("fType").value, fg = $("fSub").value;
  var cols = specColumns(list, ft ? specsOf(ft) : fg ? subSpecs(fg) : []);
  var head = BASE.map(function(c){ return c[1]; })
    .concat(cols.map(function(c){ return c.title; }));
  var rows = list.map(function(it){
    return BASE.map(function(c){ return it[c[0]] == null ? "" : String(it[c[0]]); })
      .concat(cols.map(function(c){ return colVal(it, c); }));
  });
  saveTable({sheet: reg().name, head: head, rows: rows, textCols: [0],
             band: {from: BASE.length, title: "Характеристики"}}, fileName(""));
}

/* имя файла без расширения — его добавит saveTable по выбранному формату */
function fileName(suffix){
  return reg().name.replace(/[^\wа-яА-ЯёЁ]+/g,"-").toLowerCase() +
         (suffix ? "-"+suffix : "") + "-" + new Date().toISOString().slice(0,10);
}
function saveBlob(blob, fname){
  try{
    var a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); },1500);
  }catch(e){ toast("Экспорт недоступен в этом окне"); }
}
function saveCSV(body, fname){
  var data = "﻿" + body;
  if(downloads){
    downloads.save({filename:fname, data:data}).then(function(){ toast("Файл сохранён"); })
      .catch(function(){ toast("Сохранение отменено"); });
    return;
  }
  saveBlob(new Blob([data],{type:"text/csv;charset=utf-8"}), fname);
}
function csvBlock(rows){
  var sep=";", q=function(v){ return '"'+String(v==null?"":v).replace(/"/g,'""')+'"'; };
  return rows.map(function(r){ return r.map(q).join(sep); }).join("\r\n");
}
function parseDateCell(v){
  v = String(v||"").trim(); if(!v) return "";
  var m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if(m) return m[3]+"-"+m[2]+"-"+m[1];
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}
function csvLines(head, rows){
  var sep=";", q=function(v){ return '"'+String(v==null?"":v).replace(/"/g,'""')+'"'; };
  return [head.map(q).join(sep)].concat(rows.map(function(r){ return r.map(q).join(sep); })).join("\r\n");
}

/* ---------- расходные материалы: склад и выдачи ---------- */
function exportSupplies(){
  var head, rows, suffix;
  if(supTab==="receipts"){
    head = ["Дата","Материал","Кол-во","Единица","Примечание"];
    rows = cfg.receipts.slice()
      .sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); })
      .map(function(x){
        var m = supplyById(x.supplyId) || {};
        return [fmtDate(x.date), m.name||"", x.qty||0, m.unit||"", x.note||""];
      });
    suffix = "поступления";
  } else {
    head = ["Материал","Единица","Поступило","Выдано","Остаток","Примечание"];
    rows = cfg.supplies.slice()
      .sort(function(a,b){ return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; })
      .map(function(m){ return [m.name, m.unit||"шт", m.qty||0, issuedCount(m.id), stockLeft(m), m.note||""]; });
    suffix = "склад";
    /* на «Таблице факт» под остатками лежат выдачи — выгружаем их тем же листом */
    if(supTab==="stock"){
      var iss = cfg.issues.slice()
        .sort(function(a,b){ return (b.date||"").localeCompare(a.date||""); })
        .map(function(x){
          var t = issueTarget(x), m = supplyById(x.supplyId) || {};
          return [fmtDate(x.date), m.name||"", x.qty||1, t.name||"", t.div, t.dep, x.note||""];
        });
      if(!rows.length && !iss.length){ toast("Выгружать нечего — список пуст"); return; }
      saveBlock("факт", [head].concat(rows, [[], ["Выдано и установлено"],
        ["Дата","Материал","Кол-во","Кому","Подразделение","Отдел","Примечание"]], iss), fileName("факт"));
      return;
    }
  }
  if(!rows.length){ toast("Выгружать нечего — список пуст"); return; }
  saveTable({sheet: suffix, head: head, rows: rows}, fileName(suffix));
}

function importSupplies(text){
  var rows = parseCSV(text);
  if(rows.length<2){ toast("В файле нет данных"); return; }
  var head = rows[0].map(function(h){ return h.trim().toLowerCase(); });
  var find = function(names){
    for(var i=0;i<names.length;i++){ var k = head.indexOf(names[i]); if(k!==-1) return k; }
    return -1;
  };
  var iName = find(["материал","название","наименование"]);
  var iUnit = find(["единица","ед","ед. изм."]);
  var iQty  = find(["поступило","количество","кол-во","приход"]);
  var iNote = find(["примечание","комментарий"]);
  var iDate = find(["дата","дата поступления"]);
  if(iName===-1){ toast("Нужна колонка «Материал»"); return; }
  var added = 0, updated = 0;
  rows.slice(1).forEach(function(r){
    var nm = (r[iName]||"").trim(); if(!nm) return;
    var qty = iQty===-1 ? 0 : Math.max(0, parseInt(String(r[iQty]||"").replace(/[^0-9-]/g,""), 10) || 0);
    var unit = iUnit===-1 ? "" : (r[iUnit]||"").trim();
    var note = iNote===-1 ? "" : (r[iNote]||"").trim();
    var m = cfg.supplies.find(function(x){ return x.name.toLowerCase()===nm.toLowerCase(); });
    if(unit && cfg.units.indexOf(unit) === -1) cfg.units.push(unit);
    if(m){
      if(unit) m.unit = unit;
      if(note) m.note = note;
      updated++;                      /* количество не трогаем — оно складывается из приходов */
    } else {
      m = {id:uid("m"), name:nm, unit:unit||"шт", qty:0, note:note};
      cfg.supplies.push(m);
      if(qty > 0) cfg.receipts.push({id:uid("rc"), supplyId:m.id, qty:qty,
        date: (iDate===-1 ? "" : parseDateCell(r[iDate])) || today(),
        note: note || "загружено из файла"});
      recalcSupply(m);
      added++;
    }
  });
  saveCfg();
  toast("Материалов добавлено: "+added+", обновлено: "+updated+
    (updated ? ". Остатки у существующих не менялись — количество вносится приходом." : ""));
}

function parseCSV(text){
  text = text.replace(/^﻿/,"");
  var h = text.split("\n")[0], sep = h.split(";").length > h.split(",").length ? ";" : ",";
  var rows=[], row=[], cur="", inQ=false;
  for(var i=0;i<text.length;i++){
    var ch=text[i];
    if(inQ){ if(ch==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else inQ=false; } else cur+=ch; }
    else if(ch==='"') inQ=true;
    else if(ch===sep){ row.push(cur); cur=""; }
    else if(ch==="\n"){ row.push(cur); rows.push(row); row=[]; cur=""; }
    else if(ch!=="\r") cur+=ch;
  }
  if(cur.length||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(function(r){ return r.some(function(c){ return c.trim()!==""; }); });
}
function findOrAdd(key, name, extra){
  if(!name) return "";
  var f = cfg[key].find(function(x){ return x.name.toLowerCase()===name.toLowerCase(); });
  if(f) return f.id;
  var o = Object.assign({id:uid(key[0]), name:name}, extra||{});
  cfg[key].push(o); return o.id;
}
function importCSV(text){
  var rows = parseCSV(text);
  if(rows.length<2){ toast("В файле нет данных"); return; }
  var head = rows[0].map(function(h){ return h.trim().toLowerCase(); });
  var map = {};
  BASE.forEach(function(c){
    var i = head.indexOf(c[1].toLowerCase()); if(i===-1) i = head.indexOf(c[0]);
    if(i!==-1) map[c[0]] = i;
  });
  if(map.inv===undefined && map.typeName===undefined){ toast("Нужна колонка «Инвентарный номер» или «Тип»"); return; }
  var queue = [], sts = statusesOf();
  rows.slice(1).forEach(function(r){
    var g = function(k){ return map[k]!==undefined ? (r[map[k]]||"").trim() : ""; };
    var inv = g("inv"), tn = g("typeName");
    if(!inv && !tn) return;
    var catName = g("catName"), catId = "";
    if(catName){
      var c = regCats().find(function(x){ return x.name.toLowerCase()===catName.toLowerCase(); });
      if(!c){ c = {id:uid("c"), name:catName, registryId:curReg}; cfg.categories.push(c); }
      catId = c.id;
    }
    var sn = g("subName"), subId = "";
    if(sn){
      var sub = regSubs().find(function(x){
        return x.name.toLowerCase()===sn.toLowerCase() && (!catId || (x.categoryId||"")===catId); });
      if(!sub){ sub = {id:uid("g"), name:sn, categoryId:catId, registryId:curReg}; cfg.subcategories.push(sub); }
      else if(!sub.categoryId && catId) sub.categoryId = catId;
      subId = sub.id;
    }
    var typeId = "";
    if(tn){
      var t = regTypes().find(function(x){ return x.name.toLowerCase()===tn.toLowerCase(); });
      if(!t){ t = {id:uid("t"), name:tn, categoryId:catId, subcategoryId:subId, registryId:curReg}; cfg.types.push(t); }
      else {
        if(!t.categoryId && catId) t.categoryId = catId;
        if(!t.subcategoryId && subId) t.subcategoryId = subId;
      }
      typeId = t.id;
    }
    var own = g("ownerName"), ownerId = "";
    if(own){
      var u = cfg.users.find(function(x){ return x.name.toLowerCase()===own.toLowerCase(); });
      if(!u){ u = {id:uid("u"), name:own, position:"", divisionId:"", departmentId:""}; cfg.users.push(u); }
      ownerId = u.id;
    }
    /* Характеристики берём из одноимённых колонок — тех самых, что пишет экспорт. */
    var specs = {}, specsNone = {};
    specsOf(typeId).forEach(function(sp){
      var i = head.indexOf((sp.name+(sp.unit ? ", "+sp.unit : "")).toLowerCase());
      if(i === -1) i = head.indexOf(sp.name.toLowerCase());
      if(i === -1) return;
      var v = (r[i]||"").trim();
      if(!v) return;
      if(v.toLowerCase() === "нет" && sp.opt) specsNone[sp.id] = true;
      else specs[sp.id] = v;
    });
    var row = {
      registryId: curReg, inv: inv, cost: numVal(g("cost")), type: typeId,
      status: sts.indexOf(g("status"))!==-1 ? g("status") : sts[0],
      owner: ownerId,
      division: findOrAdd("divisions", g("divName")),
      department: findOrAdd("departments", g("depName")),
      notes: g("notes"), specs: specs, specsNone: specsNone
    };
    addHistory(row, "Импортировано из CSV");
    queue.push(row);
  });
  saveCfg();
  saveItems(queue).then(function(){ toast("Импортировано записей: "+queue.length); });
}
function exportDashboard(){
  var assets = assetItems(), rows = [];
  var onStock = cfg.supplies.reduce(function(a,m){ return a + Math.max(0, stockLeft(m)); }, 0);
  rows.push(["Сводка по учёту ИТ-отдела", new Date().toLocaleDateString("ru-RU")]);
  rows.push([""]);
  rows.push(["ИТОГИ"]);
  rows.push(["Показатель","Значение"]);
  rows.push(["Всего оборудование", assets.length]);
  rows.push(["Разделов учёта", cfg.registries.length]);
  rows.push(["Материалов на складе", onStock]);
  rows.push(["Поступлений материалов", cfg.receipts.length]);
  rows.push(["Списаний материалов", cfg.issues.length]);
  rows.push(["Сотрудников", cfg.users.length]);
  rows.push(["Пользователей ИТ", (cfg.staff||[]).length]);
  rows.push(["Подразделений", cfg.divisions.length]);
  rows.push(["Отделов", cfg.departments.length]);
  rows.push(["Занятых IP", usedIps().length]);
  rows.push(["Пулов IP", cfg.ipPools.length]);

  rows.push([""]);
  rows.push(["РАЗДЕЛЫ УЧЁТА"]);
  rows.push(["Раздел","Тип","Позиций","Категорий","Типов","Доля от оборудования, %"]);
  cfg.registries.forEach(function(r){
    var sup = r.kind==="supplies";
    var cnt = sup ? cfg.supplies.length : regItems(r.id).length;
    var pct = (!sup && assets.length) ? Math.round(cnt*100/assets.length) : "";
    rows.push([r.name, sup ? "склад материалов" : "учёт техники", cnt,
               regCats(r.id).length, regTypes(r.id).length, pct]);
  });

  rows.push([""]);
  rows.push(["ОБОРУДОВАНИЕ ПО СТАТУСАМ"]);
  rows.push(["Раздел","Статус","Позиций"]);
  cfg.registries.forEach(function(r){
    if(r.kind==="supplies") return;
    var list = regItems(r.id);
    statusesOf(r.id).forEach(function(st){
      rows.push([r.name, st, list.filter(function(i){ return i.status===st; }).length]);
    });
  });

  rows.push([""]);
  rows.push(["ПО ПОДРАЗДЕЛЕНИЯМ"]);
  rows.push(["Подразделение","Позиций","Сотрудников"]);
  cfg.divisions.forEach(function(d){
    rows.push([d.name,
      assets.filter(function(i){ return i.division===d.id; }).length,
      cfg.users.filter(function(u){ return u.divisionId===d.id; }).length]);
  });

  rows.push([""]);
  rows.push(["ПО ОТДЕЛАМ"]);
  rows.push(["Отдел","Позиций","Сотрудников"]);
  cfg.departments.forEach(function(d){
    rows.push([d.name,
      assets.filter(function(i){ return i.department===d.id; }).length,
      cfg.users.filter(function(u){ return u.departmentId===d.id; }).length]);
  });

  rows.push([""]);
  rows.push(["РАСХОДНЫЕ МАТЕРИАЛЫ"]);
  rows.push(["Материал","Единица","Поступило","Выдано","Остаток"]);
  cfg.supplies.slice().sort(function(a,b){ return a.name.toLowerCase()<b.name.toLowerCase()?-1:1; })
    .forEach(function(m){ rows.push([m.name, m.unit||"шт", m.qty||0, issuedCount(m.id), stockLeft(m)]); });

  saveBlock("Сводка", rows, "сводка-" + new Date().toISOString().slice(0,10));
}
function runExport(fmt){
  expFmt = fmt;
  if(nav==="repairs") exportRepairs();
  else if(nav==="dels") exportDels();
  else if(nav==="ips") openIpExport();
  else if(nav==="dash") exportDashboard();
  else if(isSupplyReg(curReg)) exportSupplies();
  else exportCSV();
}
$("btnExport").onclick = function(){ runExport("csv"); };
$("btnExcel").onclick  = function(){ runExport("xlsx"); };
$("btnImport").onclick = function(){
  var inp = document.createElement("input"); inp.type="file"; inp.accept=".csv,text/csv";
  inp.onchange = function(){
    var f = inp.files && inp.files[0]; if(!f) return;
    var fr = new FileReader();
    fr.onload = function(){
      var txt = String(fr.result);
      isSupplyReg(curReg) ? importSupplies(txt) : importCSV(txt);
    };
    fr.readAsText(f,"utf-8");
  };
  inp.click();
};

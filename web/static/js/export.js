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

function importSupplies(rows){
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
/* Одноимённые отделы бывают в разных подразделениях — ищем в своём. Нет там —
   берём неразмеченный и приписываем к подразделению, нет и его — заводим. */
function findDep(name, divId){
  if(!name) return "";
  var low = name.toLowerCase();
  var same = cfg.departments.filter(function(d){ return d.name.toLowerCase()===low; });
  var d = same.find(function(x){ return divId && x.divisionId===divId; }) ||
          same.find(function(x){ return !x.divisionId || !byId("divisions", x.divisionId); }) ||
          (!divId ? same[0] : null);
  if(d){ if(divId && !d.divisionId) d.divisionId = divId; return d.id; }
  d = {id:uid("d"), name:name, divisionId:divId||""};
  cfg.departments.push(d); return d.id;
}
/* В колонке ответственного выгрузка пишет не только людей: «⌖ место» у
   закреплённого за местом и «Имя (за инв. …)» у прикреплённого. Место
   сотрудником не заводим, хвост про прикрепление отрезаем. */
function importOwner(name){
  name = String(name||"").replace(/\s*\(за инв\.[^)]*\)\s*$/, "").trim();
  if(!name || name.charAt(0) === "⌖") return "";
  var u = cfg.users.find(function(x){ return x.name.toLowerCase()===name.toLowerCase(); });
  if(!u){ u = {id:uid("u"), name:name, position:"", divisionId:"", departmentId:""}; cfg.users.push(u); }
  return u.id;
}
/* Модель берём только из справочника: опечатка не должна плодить модели */
function importModel(name){
  if(!name) return null;
  var low = name.toLowerCase(), hit = function(m){ return m.name.toLowerCase()===low; };
  return cfg.models.filter(function(m){ return rid(m)===curReg; }).find(hit) || cfg.models.find(hit) || null;
}
/* Тип по названию; нет — заводим вместе с категорией и подкатегорией из строки */
function importType(g){
  var tn = g("typeName"); if(!tn) return "";
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
  var t = regTypes().find(function(x){ return x.name.toLowerCase()===tn.toLowerCase(); });
  if(!t){ t = {id:uid("t"), name:tn, categoryId:catId, subcategoryId:subId, registryId:curReg}; cfg.types.push(t); }
  else {
    if(!t.categoryId && catId) t.categoryId = catId;
    if(!t.subcategoryId && subId) t.subcategoryId = subId;
  }
  return t.id;
}
/* Ячейка характеристики — колонка с тем же заголовком, что пишет выгрузка */
function specCell(r, head, sp){
  var i = head.indexOf((sp.name+(sp.unit ? ", "+sp.unit : "")).toLowerCase());
  if(i === -1) i = head.indexOf(sp.name.toLowerCase());
  return i === -1 ? "" : String(r[i]==null ? "" : r[i]).trim();
}
/* Номер для сверки. Первой единице номенклатуры сервер хвост не пишет, а в
   таблице его дописывают: «3613500/1» и «3613500» — одна и та же единица. */
function invKey(v){
  return String(v==null ? "" : v).replace(/\s+/g, "").replace(/\/1$/, "");
}
/* В выгрузке Excel над заголовками стоит полоса «Характеристики» — заголовок
   ищем в первых строках, а не берём первую не глядя. */
function headRow(rows){
  for(var i=0; i<Math.min(rows.length, 5); i++){
    var h = rows[i].map(function(x){ return String(x==null ? "" : x).trim().toLowerCase(); });
    if(h.indexOf("инвентарный номер")!==-1 || h.indexOf("тип")!==-1 || h.indexOf("inv")!==-1) return i;
  }
  return 0;
}

/* Загрузка записей раздела из CSV или Excel. Выгрузку правят в Excel и
   заливают обратно, поэтому строка с номером, который в разделе уже есть,
   правит эту запись, а не заводит новую. Каждую запись берём один раз:
   скопированная строка с тем же номером — это ещё одна единица, сервер
   допишет ей следующий хвост /N. Пустая ячейка ничего не стирает, ячейка
   как в выгрузке ничего не меняет. */
function importRows(rows){
  var hr = headRow(rows);
  if(rows.length < hr + 2){ toast("В файле нет данных"); return; }
  var head = rows[hr].map(function(h){ return String(h==null ? "" : h).trim().toLowerCase(); });
  var map = {};
  BASE.forEach(function(c){
    var i = head.indexOf(c[1].toLowerCase()); if(i===-1) i = head.indexOf(c[0]);
    if(i!==-1) map[c[0]] = i;
  });
  if(map.inv===undefined && map.typeName===undefined){ toast("Нужна колонка «Инвентарный номер» или «Тип»"); return; }
  var sts = statusesOf(), queue = [], added = 0, updated = 0, same = 0;
  var badInv = [], noModel = {}, shown = {}, byInv = {}, used = {};
  decorated().forEach(function(o){ shown[o.id] = o; });
  regItems().forEach(function(it){
    var k = invKey(it.inv); if(!k) return;
    (byInv[k] = byInv[k] || []).push(it);
  });
  var low = function(v){ return String(v==null ? "" : v).trim().toLowerCase(); };

  rows.slice(hr + 1).forEach(function(r, ri){
    var g = function(k){ return map[k]!==undefined ? String(r[map[k]]==null ? "" : r[map[k]]).trim() : ""; };
    var inv = g("inv"), tn = g("typeName");
    if(!inv && !tn) return;
    var prev = inv ? (byInv[invKey(inv)] || []).find(function(x){ return !used[x.id]; }) : null;
    var mn = g("modelName"), model = importModel(mn);
    if(mn && !model) noModel[mn] = true;

    if(!prev){
      /* номер с ошибкой сервер отверг бы вместе со всей партией — такую строку
         пропускаем и называем, остальные загружаем */
      if(inv && invProblem(inv)){ badInv.push(hr + ri + 2); return; }
      var typeId = importType(g), st = g("status");
      var status = sts.indexOf(st)!==-1 ? st : sts[0], free = ownerless(status);
      var specs = {}, specsNone = {};
      specsOf(typeId).forEach(function(sp){
        var v = specCell(r, head, sp); if(!v) return;
        if(v.toLowerCase() === "нет" && sp.opt) specsNone[sp.id] = true;
        else specs[sp.id] = v;
      });
      var divId = free ? "" : findOrAdd("divisions", g("divName"));
      var row = {
        registryId: curReg, inv: inv, cost: numVal(g("cost")), type: typeId,
        status: status, model: model ? model.id : "",
        owner: free ? "" : importOwner(g("ownerName")),
        division: divId,
        department: free ? "" : findDep(g("depName"), divId),
        notes: g("notes"), specs: specs, specsNone: specsNone
      };
      addHistory(row, "Добавлено импортом из файла");
      queue.push(row); added++;
      return;
    }

    used[prev.id] = true;
    var o = JSON.parse(JSON.stringify(prev)), was = shown[prev.id] || {}, ch = [];
    delete o.historyAdd;
    if(tn && low(tn) !== low(was.typeName)){
      o.type = importType(g);
      ch.push("Тип: "+(was.typeName||"—")+" → "+(typeName(o.type)||"—"));
    }
    if(model && model.id !== (prev.model||"")){
      o.model = model.id; ch.push("Модель: "+(was.modelName||"—")+" → "+model.name);
    }
    var cost = numVal(g("cost"));
    if(cost !== null && cost !== numVal(prev.cost)){
      o.cost = cost; ch.push("Стоимость: "+(prev.cost==null ? "—" : prev.cost)+" → "+cost);
    }
    var st2 = g("status");
    if(st2 && st2 !== prev.status && sts.indexOf(st2)!==-1){
      o.status = st2; ch.push("Статус: "+(prev.status||"—")+" → "+st2);
    }
    if(ownerless(o.status)){
      /* на складе и на списании за сотрудником не числится — как в карточке */
      if(!ownerless(prev.status||"") && (prev.owner || prev.division || prev.department)){
        o.owner = o.division = o.department = "";
        ch.push("Снято с сотрудника: "+(ownerName(prev.owner)||"—"));
      }
    } else if((prev.holder||"person") === "person"){
      /* за местом и за оборудованием ответственный и отдел — чужие, не трогаем */
      var own = g("ownerName");
      if(own && low(own) !== low(was.ownerName)){
        var ownId = importOwner(own);
        if(ownId && ownId !== (prev.owner||"")){
          o.owner = ownId; ch.push("Ответственный: "+(ownerName(prev.owner)||"—")+" → "+ownerName(ownId));
        }
      }
      var dn = g("divName");
      if(dn && low(dn) !== low(was.divName)){
        o.division = findOrAdd("divisions", dn);
        ch.push("Подразделение: "+(was.divName||"—")+" → "+dn);
      }
      var pn = g("depName");
      if(pn && (low(pn) !== low(was.depName) || o.division !== (prev.division||""))){
        var depId = findDep(pn, o.division);
        if(depId !== (prev.department||"")){
          o.department = depId; ch.push("Отдел: "+(was.depName||"—")+" → "+pn);
        }
      }
    }
    var nt = g("notes");
    if(nt && nt !== (prev.notes||"")){ o.notes = nt; ch.push("Примечание"); }
    o.specs = o.specs || {}; o.specsNone = o.specsNone || {};
    specsOf(o.type).forEach(function(sp){
      var v = specCell(r, head, sp); if(!v) return;
      if(v.toLowerCase() === "нет" && sp.opt){
        if(!o.specsNone[sp.id]){ o.specsNone[sp.id] = true; delete o.specs[sp.id]; ch.push(sp.name+": нет"); }
      } else if(o.specsNone[sp.id] || v !== String(o.specs[sp.id]==null ? "" : o.specs[sp.id])){
        o.specs[sp.id] = v; delete o.specsNone[sp.id]; ch.push(sp.name+": "+v);
      }
    });
    if(!ch.length){ same++; return; }
    addHistory(o, "Изменено импортом из файла: " + ch.join("; "));
    queue.push(o); updated++;
  });

  saveCfg();
  var msg = "Добавлено: "+added+", обновлено: "+updated+(same ? ", без изменений: "+same : "");
  if(badInv.length) msg += ". Пропущены строки с неверным номером: "+badInv.slice(0,5).join(", ")+(badInv.length>5 ? "…" : "");
  var nm = Object.keys(noModel);
  if(nm.length) msg += ". Нет в справочнике моделей: "+nm.slice(0,3).join(", ")+(nm.length>3 ? "…" : "");
  if(!queue.length){ toast(msg); return; }
  saveItems(queue).then(function(){ toast(msg); });
}

/* ================== чтение .xlsx ==================
   Excel пересохраняет книгу со сжатием (deflate) — разжимает сам браузер
   (DecompressionStream), своей распаковки не держим. */
function unzipEntries(buf){
  var dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  var eocd = -1;
  for(var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--)
    if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  if(eocd < 0) throw new Error("not a zip");
  var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), out = {};
  for(var k=0; k<n; k++){
    if(dv.getUint32(p, true) !== 0x02014b50) break;
    var nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    var name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    /* размеры берём из центрального каталога: в локальном заголовке их может не быть */
    var start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    out[name] = {method: dv.getUint16(p + 10, true), data: u8.subarray(start, start + dv.getUint32(p + 20, true))};
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}
function unzipText(e){
  if(!e) return Promise.resolve("");
  if(e.method === 0) return Promise.resolve(new TextDecoder().decode(e.data));
  try{
    var s = new Blob([e.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(s).text();
  }catch(err){ return Promise.reject(err); }
}
function xmlTags(node, name){ return Array.prototype.slice.call(node.getElementsByTagNameNS("*", name)); }
function xmlDoc(t){ return new DOMParser().parseFromString(t || "<x/>", "application/xml"); }
function colIndex(ref){
  var m = /^[A-Z]+/.exec(ref || ""), n = 0;
  if(!m) return -1;
  for(var i=0; i<m[0].length; i++) n = n * 26 + m[0].charCodeAt(i) - 64;
  return n - 1;
}
function sheetRows(doc, ss){
  var rows = [];
  xmlTags(doc, "row").forEach(function(row){
    var line = [], next = 0;
    xmlTags(row, "c").forEach(function(c){
      var k = colIndex(c.getAttribute("r")); if(k < 0) k = next;
      next = k + 1;
      var t = c.getAttribute("t"), v = xmlTags(c, "v")[0], val = v ? v.textContent : "";
      if(t === "s") val = ss[parseInt(val, 10)] || "";
      else if(t === "inlineStr") val = xmlTags(c, "t").map(function(x){ return x.textContent; }).join("");
      line[k] = val;
    });
    for(var i=0; i<line.length; i++) if(line[i] === undefined) line[i] = "";
    if(line.some(function(x){ return String(x).trim() !== ""; })) rows.push(line);
  });
  return rows;
}
/* Строки первого листа книги — тем же видом, что отдаёт parseCSV */
function readXlsx(buf){
  var z = unzipEntries(buf), path = "xl/worksheets/sheet1.xml";
  return Promise.all([unzipText(z["xl/workbook.xml"]), unzipText(z["xl/_rels/workbook.xml.rels"]),
                      unzipText(z["xl/sharedStrings.xml"])]).then(function(a){
    /* первый лист по порядку в книге — не обязательно sheet1.xml */
    var sh = xmlTags(xmlDoc(a[0]), "sheet")[0];
    var rel = sh ? (sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
                    sh.getAttribute("r:id")) : "";
    xmlTags(xmlDoc(a[1]), "Relationship").forEach(function(r){
      if(rel && r.getAttribute("Id") === rel){
        var t = r.getAttribute("Target") || "";
        path = t.charAt(0) === "/" ? t.slice(1) : "xl/" + t;
      }
    });
    var ss = xmlTags(xmlDoc(a[2]), "si").map(function(si){
      return xmlTags(si, "t").filter(function(t){ return t.parentNode.localName !== "rPh"; })
        .map(function(t){ return t.textContent; }).join("");
    });
    if(!z[path]) throw new Error("no sheet");
    return unzipText(z[path]).then(function(x){ return sheetRows(xmlDoc(x), ss); });
  });
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
/* CSV из Excel бывает в кодировке Windows («CSV (разделители — точка с запятой)»):
   прочитанное как UTF-8 тогда полно знаков-заглушек — перечитываем как cp1251 */
function readCsvFile(f){
  return new Promise(function(ok){
    var fr = new FileReader();
    fr.onload = function(){
      var txt = String(fr.result);
      if(txt.indexOf(String.fromCharCode(0xFFFD)) === -1) return ok(parseCSV(txt));
      var fr2 = new FileReader();
      fr2.onload = function(){ ok(parseCSV(String(fr2.result))); };
      fr2.readAsText(f, "windows-1251");
    };
    fr.readAsText(f, "utf-8");
  });
}
$("btnImport").onclick = function(){
  var inp = document.createElement("input"); inp.type="file";
  inp.accept = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  inp.onchange = function(){
    var f = inp.files && inp.files[0]; if(!f) return;
    var rows;
    if(/\.xlsx$/i.test(f.name)){
      rows = f.arrayBuffer().then(readXlsx);
    } else if(/\.xls$/i.test(f.name)){
      toast("Старый формат .xls не читается — сохраните файл как .xlsx или CSV"); return;
    } else rows = readCsvFile(f);
    rows.then(function(r){ isSupplyReg(curReg) ? importSupplies(r) : importRows(r); },
              function(){ toast("Не удалось прочитать файл — сохраните его как .xlsx или CSV (UTF-8) и загрузите снова"); });
  };
  inp.click();
};

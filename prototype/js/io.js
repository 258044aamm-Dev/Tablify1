/* ============================================================================
   io.js — real import/export plumbing:
     · CSV / TSV parsing (quotes, embedded commas and newlines)
     · HTML <table> parsing for pastes from Sheets/Excel
     · type inference + per-column overrides
     · export to TSV / CSV / Markdown / JSON and a REAL minimal .xlsx
       (a stored-entry ZIP with inline strings — Excel opens it)
   ========================================================================== */
window.TF = window.TF || {};

TF.io = (function () {
  "use strict";
  var D = TF.data;

  /* ── parsing ───────────────────────────────────────────────────────────── */
  function parseDelimited(text, delim) {
    var rows = [], row = [], field = "", i = 0, inQuotes = false;
    text = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    while (i < text.length) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ""; i++; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    row.push(field);
    rows.push(row);
    while (rows.length && rows[rows.length - 1].every(function (c) { return c === ""; })) rows.pop();
    return rows;
  }
  function parseCSV(text) { return parseDelimited(text, ","); }
  function parseTSV(text) { return parseDelimited(text, "\t"); }

  function parseHTMLTable(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var table = doc.querySelector("table");
    if (!table) return null;
    var out = [];
    Array.prototype.forEach.call(table.querySelectorAll("tr"), function (tr) {
      var row = [];
      Array.prototype.forEach.call(tr.querySelectorAll("th,td"), function (cell) {
        row.push((cell.textContent || "").trim());
      });
      if (row.length) out.push(row);
    });
    return out.length ? out : null;
  }

  /* ── inference ─────────────────────────────────────────────────────────── */
  function looksNumeric(s) { return s !== "" && !isNaN(Number(String(s).replace(/[$€£,%\s]/g, ""))); }
  function looksDate(s) { return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(String(s).trim()); }
  function looksBool(s) { return /^(true|false|yes|no|✓|x)$/i.test(String(s).trim()); }
  function looksEmail(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s).trim()); }
  function looksUrl(s) { return /^https?:\/\//i.test(String(s).trim()); }
  function looksDuration(s) { return /^\d+:[0-5]\d(:[0-5]\d)?$/.test(String(s).trim()) || /^\d+(m|h|s)$/.test(String(s).trim()); }

  function inferColumnType(values) {
    var present = values.filter(function (v) { return String(v).trim() !== ""; });
    if (!present.length) return "text";
    var all = function (fn) { return present.every(fn); };
    if (all(looksBool)) return "checkbox";
    if (all(looksDuration)) return "duration";
    if (all(looksDate)) return "date";
    if (all(looksUrl)) return "url";
    if (all(looksEmail)) return "email";
    if (all(looksNumeric)) return "number";
    var distinct = {};
    present.forEach(function (v) { distinct[String(v).trim()] = 1; });
    var n = Object.keys(distinct).length;
    if (n <= Math.max(3, Math.round(present.length * 0.35)) && n <= 12) return "singleSelect";
    if (all(function (v) { return String(v).length > 40; })) return "longText";
    return "text";
  }

  /* matrix → a proposed schema + rows. Real inference, overridable per column. */
  function analyzeMatrix(matrix, hasHeader) {
    if (!matrix || !matrix.length) return { columns: [], rows: [], hasHeader: !!hasHeader };
    var width = matrix.reduce(function (n, r) { return Math.max(n, r.length); }, 0);
    var header = hasHeader ? matrix[0] : null;
    var body = hasHeader ? matrix.slice(1) : matrix;
    var columns = [];
    for (var c = 0; c < width; c++) {
      var colValues = body.map(function (r) { return r[c] == null ? "" : String(r[c]); });
      var type = inferColumnType(colValues);
      var name = header && header[c] != null && String(header[c]).trim() !== "" ? String(header[c]).trim() : "Column " + (c + 1);
      columns.push({
        index: c, name: name, type: type, empty: colValues.every(function (v) { return v === ""; }),
        samples: colValues.filter(function (v) { return v !== ""; }).slice(0, 3),
        distinct: (function () { var s = {}; colValues.forEach(function (v) { if (v !== "") s[v] = 1; }); return Object.keys(s).length; })(),
      });
    }
    return { columns: columns, rows: body, hasHeader: !!hasHeader, width: width };
  }

  /* analyzed import → fields + rows ready for the store */
  function toTable(analysis) {
    var fields = analysis.columns.filter(function (c) { return !c.skip; }).map(function (c, i) {
      var f = { id: "f_imp_" + c.index, name: uniqueName(c.name, analysis.columns, c), type: c.type, width: 150 };
      if (c.type === "singleSelect" || c.type === "multiSelect") {
        var seen = {}, opts = [];
        analysis.rows.forEach(function (r) {
          var v = r[c.index] == null ? "" : String(r[c.index]).trim();
          if (!v) return;
          v.split(",").map(function (s) { return s.trim(); }).forEach(function (part) {
            if (!part || seen[part]) return;
            seen[part] = 1;
            opts.push({ id: "o_imp_" + c.index + "_" + opts.length, name: part, color: D.COLORS[opts.length % D.COLORS.length] });
          });
        });
        f.options = opts;
        if (!opts.length) f.options = [{ id: "o_imp_empty", name: "New", color: "blue" }];
        f._autoCreate = false;
      }
      if (c.type === "currency") f.symbol = "$";
      if (c.type === "rating") f.max = 5;
      return f;
    });
    if (fields.length) fields[0].primary = true;

    var rows = analysis.rows.map(function (r) {
      var cells = {};
      analysis.columns.forEach(function (c) {
        if (c.skip) return;
        var fid = "f_imp_" + c.index;
        var field = fields.filter(function (f) { return f.id === fid; })[0];
        if (!field) return;
        var raw = r[c.index] == null ? "" : String(r[c.index]);
        cells[fid] = raw === "" ? D.clone(D.descriptor(field.type).default) : D.fromPlain(field, raw);
      });
      return { id: "r_imp_" + Math.random().toString(36).slice(2, 9), cells: cells };
    });
    return { fields: fields, rows: rows };
  }
  function uniqueName(name, all, self) {
    var used = {};
    all.forEach(function (c) { if (c !== self && c.name) used[c.name.toLowerCase()] = 1; });
    if (!used[name.toLowerCase()]) return name;
    var n = 2;
    while (used[(name + " " + n).toLowerCase()]) n++;
    return name + " " + n;
  }

  /* append semantics: match incoming columns to existing fields by name */
  function appendPlan(analysis, fields) {
    var mapping = {}, newColumns = [];
    analysis.columns.forEach(function (c) {
      if (c.skip) return;
      var existing = null;
      for (var i = 0; i < fields.length; i++) if (fields[i].name.trim().toLowerCase() === c.name.trim().toLowerCase()) existing = fields[i];
      if (existing) mapping[c.index] = existing.id;
      else newColumns.push(c);
    });
    return { mapping: mapping, newColumns: newColumns };
  }

  /* ── building export text ──────────────────────────────────────────────── */
  function toTSV(matrix) {
    return matrix.map(function (row) {
      return row.map(function (cell) {
        var s = cell == null ? "" : String(cell);
        return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join("\t");
    }).join("\n");
  }
  function toCSV(matrix) {
    return matrix.map(function (row) {
      return row.map(function (cell) {
        var s = cell == null ? "" : String(cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\n");
  }
  function toMarkdown(fields, rows) {
    var head = "| " + fields.map(function (f) { return f.name; }).join(" | ") + " |";
    var sep = "| " + fields.map(function () { return "---"; }).join(" | ") + " |";
    var body = rows.map(function (r) {
      return "| " + fields.map(function (f) { return String(D.toPlain(f, r.cells[f.id])).replace(/\|/g, "\\|"); }).join(" | ") + " |";
    }).join("\n");
    return [head, sep, body].join("\n");
  }
  function toJSON(fields, rows) {
    return JSON.stringify(rows.map(function (r) {
      var o = {};
      fields.forEach(function (f) { o[f.name] = D.isEmptyValue(r.cells[f.id]) ? null : D.toPlain(f, r.cells[f.id]); });
      return o;
    }), null, 2);
  }

  /* ── real .xlsx writer (stored entries, inline strings) ─────────────────── */
  var CRC_TABLE = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0 ^ -1;
    for (var i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xFF];
    return (c ^ -1) >>> 0;
  }
  function utf8(str) { return new TextEncoder().encode(str); }
  function xmlEsc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]; });
  }
  function colName(i) {
    var s = "";
    i += 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function sheetXml(matrix) {
    var rows = matrix.map(function (row, r) {
      var cells = row.map(function (v, c) {
        var ref = colName(c) + (r + 1);
        if (v == null || v === "") return '<c r="' + ref + '"/>';
        if (typeof v === "number" && isFinite(v)) return '<c r="' + ref + '"><v>' + v + "</v></c>";
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + "</t></is></c>";
      }).join("");
      return '<row r="' + (r + 1) + '">' + cells + "</row>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows + "</sheetData></worksheet>";
  }
  function buildXlsx(matrix) {
    var files = [
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tablify" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ["xl/worksheets/sheet1.xml", sheetXml(matrix)],
    ];
    var chunks = [], central = [], offset = 0;
    files.forEach(function (pair) {
      var nameBytes = utf8(pair[0]), data = utf8(pair[1]), crc = crc32(data);
      var local = new Uint8Array(30 + nameBytes.length + data.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
      local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
      chunks.push(local);
      central.push({ nameBytes: nameBytes, crc: crc, size: data.length, offset: offset });
      offset += local.length;
    });
    var centralStart = offset, centralChunks = [];
    central.forEach(function (e) {
      var head = new Uint8Array(46 + e.nameBytes.length);
      var dv = new DataView(head.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
      dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true); dv.setUint16(14, 0, true);
      dv.setUint32(16, e.crc, true); dv.setUint32(20, e.size, true); dv.setUint32(24, e.size, true);
      dv.setUint16(28, e.nameBytes.length, true); dv.setUint16(30, 0, true); dv.setUint16(32, 0, true);
      dv.setUint16(34, 0, true); dv.setUint16(36, 0, true); dv.setUint32(38, 0, true); dv.setUint32(42, e.offset, true);
      head.set(e.nameBytes, 46);
      centralChunks.push(head);
      offset += head.length;
    });
    var centralSize = offset - centralStart;
    var eocd = new Uint8Array(22), dv2 = new DataView(eocd.buffer);
    dv2.setUint32(0, 0x06054b50, true); dv2.setUint16(8, files.length, true); dv2.setUint16(10, files.length, true);
    dv2.setUint32(12, centralSize, true); dv2.setUint32(16, centralStart, true);
    var all = chunks.concat(centralChunks, [eocd]);
    var total = all.reduce(function (n, a) { return n + a.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (a) { out.set(a, pos); pos += a.length; });
    return out;
  }

  /* ── clipboard + files ─────────────────────────────────────────────────── */
  function copyRich(tsv, html) {
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      try {
        var item = new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([html || tsvToHtml(tsv)], { type: "text/html" }),
        });
        navigator.clipboard.write([item]);
        return "rich";
      } catch (e) { void e; }
    }
    return copyText(tsv);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
      return "plain";
    }
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { void e; }
    document.body.removeChild(ta);
    return ok ? "plain" : "failed";
  }
  function tsvToHtml(tsv) {
    var rows = tsv.split("\n").map(function (r) { return r.split("\t"); });
    return "<table>" + rows.map(function (r) {
      return "<tr>" + r.map(function (c) {
        return "<td>" + String(c).replace(/[&<>]/g, function (x) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[x]; }) + "</td>";
      }).join("") + "</tr>";
    }).join("") + "</table>";
  }
  function download(filename, data, mime) {
    var blob = data instanceof Uint8Array ? new Blob([data], { type: mime }) : new Blob([data], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  /* ── high level: matrix for a set of rows/fields ───────────────────────── */
  function matrixFor(fields, rows, includeHeader) {
    var out = [];
    if (includeHeader) out.push(fields.map(function (f) { return f.name; }));
    rows.forEach(function (r) {
      out.push(fields.map(function (f) { return D.toPlain(f, r.cells[f.id]); }));
    });
    return out;
  }

  return {
    parseCSV: parseCSV, parseTSV: parseTSV, parseHTMLTable: parseHTMLTable, parseDelimited: parseDelimited,
    inferColumnType: inferColumnType, analyzeMatrix: analyzeMatrix, toTable: toTable, appendPlan: appendPlan,
    toTSV: toTSV, toCSV: toCSV, toMarkdown: toMarkdown, toJSON: toJSON,
    buildXlsx: buildXlsx, crc32: crc32,
    copyRich: copyRich, copyText: copyText, tsvToHtml: tsvToHtml, download: download, matrixFor: matrixFor,
  };
})();

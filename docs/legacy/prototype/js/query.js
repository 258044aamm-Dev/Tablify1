/* ============================================================================
   query.js — ONE filter system: an AST, a parser for the query-string DSL that
   airtable-tabula already documents, an evaluator, comparators and grouping.
   Replaces the old build's three overlapping filter systems (docs/02 §Query).
   ========================================================================== */
window.TF = window.TF || {};

TF.query = (function () {
  "use strict";
  var D = TF.data;

  /* ── operators per field type (mirrors airtable-tabula's query.ts) ───────── */
  function operatorsFor(field) { return TF.data.descriptor(field && field.type).ops.slice(); }
  function operatorLabel(op) { return D.OP_LABELS[op] || op; }

  function valueNeedsInput(op) {
    return ["contains","equals","gt","lt","before","after","is","isNot","isAnyOf","containsAny","containsAll"].indexOf(op) !== -1;
  }

  /* ── comparison ─────────────────────────────────────────────────────────── */
  function compareValues(field, a, b) {
    if (D.isEmptyValue(a) && D.isEmptyValue(b)) return 0;
    if (D.isEmptyValue(a)) return -1;
    if (D.isEmptyValue(b)) return 1;
    switch (field.type) {
      case "number": case "currency": case "percent": case "duration": case "rating": case "autoNumber":
        return Number(a) - Number(b);
      case "checkbox":
        return (a ? 1 : 0) - (b ? 1 : 0);
      case "date": case "datetime": case "createdTime": case "lastModifiedTime":
        return new Date(a).getTime() - new Date(b).getTime();
      case "singleSelect": {
        var oa = field.options ? field.options.findIndex(function (o) { return o.id === a; }) : -1;
        var ob = field.options ? field.options.findIndex(function (o) { return o.id === b; }) : -1;
        if (oa !== -1 || ob !== -1) return oa - ob;
        return String(a).localeCompare(String(b));
      }
      case "multiSelect": case "attachment": {
        var la = Array.isArray(a) ? a : [], lb = Array.isArray(b) ? b : [];
        if (la.length !== lb.length) return la.length - lb.length;
        return String(la.join(",")).localeCompare(String(lb.join(",")));
      }
      default: return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    }
  }

  function textOf(field, v) {
    if (field.type === "singleSelect") { var o = D.findOption(field, v); return o ? o.name : String(v == null ? "" : v); }
    if (field.type === "multiSelect") {
      var list = Array.isArray(v) ? v : [];
      return list.map(function (id) { var o = D.findOption(field, id); return o ? o.name : id; }).join(" ");
    }
    return D.toPlain(field, v);
  }

  /* ── matching ───────────────────────────────────────────────────────────── */
  function matches(value, op, operand, field) {
    var empty = D.isEmptyValue(value);
    switch (op) {
      case "isEmpty": return empty;
      case "isNotEmpty": return !empty;
      case "isTrue": return value === true;
      case "isFalse": return !value;
    }
    if (empty) return false;
    switch (op) {
      case "contains":
        if (field.type === "multiSelect") return Array.isArray(value) && value.indexOf(operand) !== -1;
        if (field.type === "attachment") return Array.isArray(value) && value.some(function (f) { return String(f).toLowerCase().indexOf(String(operand).toLowerCase()) !== -1; });
        return textOf(field, value).toLowerCase().indexOf(String(operand).toLowerCase()) !== -1;
      case "equals": case "is": case "isAnyOf": {
        if (Array.isArray(operand)) return operand.some(function (o) { return matches(value, "is", o, field); });
        if (field.type === "number" || field.type === "currency" || field.type === "percent" || field.type === "duration" || field.type === "rating" || field.type === "autoNumber") return Number(value) === Number(operand);
        if (field.type === "checkbox") return boolFrom(operand) === !!value;
        if (field.type === "singleSelect") {
          var opt = D.findOption(field, value);
          var name = opt ? opt.name : value;
          return String(name).toLowerCase() === String(operand).toLowerCase() || String(value) === String(operand);
        }
        return textOf(field, value).toLowerCase() === String(operand).toLowerCase();
      }
      case "isNot": {
        if (field.type === "singleSelect") return !matches(value, "is", operand, field);
        return textOf(field, value).toLowerCase() !== String(operand).toLowerCase();
      }
      case "containsAny": {
        var want = Array.isArray(operand) ? operand : String(operand).split(",");
        if (field.type === "multiSelect") return Array.isArray(value) && want.some(function (w) { return value.indexOf(w) !== -1; });
        return want.some(function (w) { return textOf(field, value).toLowerCase().indexOf(String(w).trim().toLowerCase()) !== -1; });
      }
      case "containsAll": {
        var all = Array.isArray(operand) ? operand : String(operand).split(",");
        if (field.type === "multiSelect") return Array.isArray(value) && all.every(function (w) { return value.indexOf(w) !== -1; });
        return all.every(function (w) { return textOf(field, value).toLowerCase().indexOf(String(w).trim().toLowerCase()) !== -1; });
      }
      case "gt": return compareValues(field, value, operand) > 0;
      case "lt": return compareValues(field, value, operand) < 0;
      case "before": return new Date(value).getTime() < new Date(operand).getTime();
      case "after": return new Date(value).getTime() > new Date(operand).getTime();
    }
    return false;
  }
  function boolFrom(v) { return v === true || v === "true" || v === "yes" || v === 1 || v === "1"; }

  /* ── AST ────────────────────────────────────────────────────────────────── */
  function and(children) { return { kind: "and", children: children.filter(Boolean) }; }
  function or(children) { return { kind: "or", children: children.filter(Boolean) }; }
  function not(child) { return { kind: "not", child: child }; }
  function cmp(fieldId, op, value) { return { kind: "cmp", fieldId: fieldId, op: op, value: value }; }

  function evaluate(node, row, fields) {
    if (!node) return true;
    if (node.kind === "and") return node.children.every(function (c) { return evaluate(c, row, fields); });
    if (node.kind === "or") return node.children.some(function (c) { return evaluate(c, row, fields); });
    if (node.kind === "not") return !evaluate(node.child, row, fields);
    if (node.kind === "cmp") {
      var field = fields.filter(function (f) { return f.id === node.fieldId; })[0];
      if (!field) return true;                       // unknown field: don't hide rows
      return matches(row.cells[field.id], node.op, node.value, field);
    }
    return true;
  }

  /* ── the filter builder's flat model ↔ AST ──────────────────────────────── */
  function buildFromConditions(logic, conditions) {
    var nodes = conditions.filter(function (c) { return c.fieldId; }).map(function (c) {
      return cmp(c.fieldId, c.op, c.value);
    });
    if (!nodes.length) return null;
    if (nodes.length === 1) return nodes[0];
    return logic === "or" ? or(nodes) : and(nodes);
  }

  /* ── query-string DSL (docs: field:value, field:~text, field:>n, field:!v,
        field:a,b, field:empty, "quoted name":v ; whitespace = AND, OR = union) */
  function tokenize(input) {
    var tokens = [], buf = "", quote = false;
    for (var i = 0; i < input.length; i++) {
      var ch = input[i];
      if (ch === '"') { quote = !quote; buf += ch; continue; }
      if (!quote && /\s/.test(ch)) { if (buf) { tokens.push(buf); buf = ""; } continue; }
      buf += ch;
    }
    if (buf) tokens.push(buf);
    return tokens;
  }

  function findFieldByName(fields, name) {
    var n = String(name).trim().toLowerCase();
    for (var i = 0; i < fields.length; i++) if (fields[i].name.toLowerCase() === n) return fields[i];
    return null;
  }

  /* one token → {node} or {error} */
  function parseToken(token, fields) {
    /* empty(field) / notEmpty(field): the shorthand the query box advertises */
    var fn = token.match(/^(empty|notEmpty)\(\s*("([^"]*)"|[^)]+)\s*\)$/i);
    if (fn) {
      var fnName = (fn[3] != null ? fn[3] : fn[2]).trim();
      var fnField = findFieldByName(fields, fnName);
      if (!fnField) return { error: 'Unknown field "' + fnName + '"' };
      if (operatorsFor(fnField).indexOf("isEmpty") === -1) return { error: '"' + fnField.name + '" has no empty state' };
      return { node: cmp(fnField.id, /^not/i.test(fn[1]) ? "isNotEmpty" : "isEmpty", null), field: fnField };
    }
    /* field:value, and the colon-less comparisons field>value / < / ~ */
    var m = token.match(/^("([^"]*)"|[^:<>~]+)([:<>~])(.*)$/);
    if (!m) return { error: 'Expected field:value — got "' + token + '"' };
    var name = (m[2] != null ? m[2] : m[1]).trim();
    var rest = m[3] === ':' ? m[4] : m[3] + m[4];
    var field = findFieldByName(fields, name);
    if (!field) return { error: 'Unknown field "' + name + '"' };

    if (rest === "empty") {
      if (operatorsFor(field).indexOf("isEmpty") === -1) return { error: '"' + field.name + '" has no empty state' };
      return { node: cmp(field.id, "isEmpty", null) };
    }
    if (/^>(.*)$/.test(rest)) return { node: cmp(field.id, "gt", coerce(field, RegExp.$1)), field: field };
    if (/^<(.*)$/.test(rest)) return { node: cmp(field.id, "lt", coerce(field, RegExp.$1)), field: field };
    if (/^~(.*)$/.test(rest)) {
      var needle = RegExp.$1;
      /* on a select, “~done” means “an option whose name contains done” */
      if (field.type === "singleSelect" || field.type === "multiSelect") {
        var hits = (field.options || []).filter(function (o) { return String(o.name).toLowerCase().indexOf(String(needle).toLowerCase()) !== -1; })
          .map(function (o) { return o.id; });
        if (!hits.length) return { error: 'No option matching "' + needle + '" on ' + field.name };
        return { node: cmp(field.id, field.type === "multiSelect" ? "containsAny" : "isAnyOf", hits), field: field };
      }
      return { node: cmp(field.id, "contains", needle), field: field };
    }
    if (/^!(.*)$/.test(rest)) {
      var neg = RegExp.$1;
      if (/^empty$/i.test(neg)) {
        if (operatorsFor(field).indexOf("isEmpty") === -1) return { error: '"' + field.name + '" has no empty state' };
        return { node: cmp(field.id, "isNotEmpty", null), field: field };
      }
      if (field.type === "singleSelect") {
        var oid = optionId(field, neg);
        if (oid == null) return { error: 'No option "' + neg + '" on ' + field.name };
        return { node: cmp(field.id, "isNot", oid), field: field };
      }
      return { node: cmp(field.id, "contains", neg) , field: field, negated: true };
    }
    if (rest.indexOf(",") !== -1) {
      var parts = rest.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (field.type === "singleSelect" || field.type === "multiSelect") {
        var ids = parts.map(function (p) { return optionId(field, p); }).filter(function (v) { return v != null; });
        if (ids.length !== parts.length) return { error: "Unknown option on " + field.name };
        return { node: cmp(field.id, field.type === "multiSelect" ? "containsAny" : "isAnyOf", ids), field: field };
      }
      return { node: cmp(field.id, "containsAny", parts), field: field };
    }
    var op = defaultOp(field);
    if (field.type === "singleSelect") {
      var oid2 = optionId(field, rest);
      if (oid2 == null) return { error: 'No option "' + rest + '" on ' + field.name };
      return { node: cmp(field.id, "is", oid2), field: field };
    }
    return { node: cmp(field.id, op, coerce(field, rest)), field: field };
  }

  function defaultOp(field) {
    if (field.type === "multiSelect") return "contains";
    if (field.type === "checkbox") return "isTrue";
    if (field.type === "date" || field.type === "datetime" || field.type === "createdTime" || field.type === "lastModifiedTime") return "equals";
    return "equals";
  }
  function coerce(field, s) {
    var t = String(s).trim();
    if (field.type === "number" || field.type === "currency" || field.type === "percent" || field.type === "duration" || field.type === "rating" || field.type === "autoNumber") {
      var n = Number(t.replace(/[^0-9.\-]/g, "")); return isNaN(n) ? t : n;
    }
    if (field.type === "date" || field.type === "datetime" || field.type === "createdTime" || field.type === "lastModifiedTime") return t;
    if (field.type === "checkbox") return boolFrom(t);
    if (field.type === "multiSelect" || field.type === "attachment") return t.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    return t;
  }
  function optionId(field, name) {
    var o = D.findOptionByName(field, name) || D.findOption(field, name);
    return o ? o.id : null;
  }

  function parseQueryString(input, fields) {
    var trimmed = String(input || "").trim();
    if (!trimmed) return { ast: null, errors: [] };
    var tokens = tokenize(trimmed);
    var errors = [], groups = [[]];
    var pendingOr = false;
    tokens.forEach(function (tok) {
      /* “and” is optional sugar: juxtaposition already means AND, but the
         placeholder offers it, so it must parse */
      if (/^and$/i.test(tok)) return;
      if (/^or$/i.test(tok)) { pendingOr = true; groups.push([]); return; }
      var res = parseToken(tok, fields);
      if (res.error) { errors.push(res.error); return; }
      groups[groups.length - 1].push(res.node);
      pendingOr = false;
    });
    void pendingOr;
    var parts = groups.filter(function (g) { return g.length; }).map(function (g) { return g.length === 1 ? g[0] : and(g); });
    var ast = parts.length === 0 ? null : (parts.length === 1 ? parts[0] : or(parts));
    return { ast: ast, errors: errors };
  }

  /* AST → DSL text, so the builder and the query box stay one system */
  function toQueryString(node, fields) {
    if (!node) return "";
    if (node.kind === "and") return node.children.map(function (c) { return toQueryString(c, fields); }).filter(Boolean).join(" ");
    if (node.kind === "or") return node.children.map(function (c) { return toQueryString(c, fields); }).filter(Boolean).join(" or ");
    if (node.kind === "not") return "!" + toQueryString(node.child, fields);
    var field = fields.filter(function (f) { return f.id === node.fieldId; })[0];
    if (!field) return "";
    var name = field.name.indexOf(" ") !== -1 ? '"' + field.name + '"' : field.name;
    switch (node.op) {
      case "isEmpty": return name + ":empty";
      case "isNotEmpty": return name + ":!empty";
      case "gt": return name + ":>" + node.value;
      case "lt": return name + ":<" + node.value;
      case "contains": return name + ":~" + node.value;
      case "is": case "equals": {
        if (field.type === "singleSelect") { var o = D.findOption(field, node.value); return name + ":" + (o ? o.name : node.value); }
        return name + ":" + node.value;
      }
      case "isNot": { var o2 = D.findOption(field, node.value); return name + ":!" + (o2 ? o2.name : node.value); }
      case "isAnyOf": case "containsAny": {
        var list = Array.isArray(node.value) ? node.value : [node.value];
        var names = list.map(function (v) { var o = D.findOption(field, v); return o ? o.name : v; });
        return name + ":" + names.join(",");
      }
      case "isTrue": return name + ":true";
      case "isFalse": return name + ":false";
      case "before": return name + ":<" + node.value;
      case "after": return name + ":>" + node.value;
      default: return name + ":" + node.value;
    }
  }

  /* ── full row pipeline: search → filters → sorts → grouping ─────────────── */
  function searchPredicate(search, fields) {
    var q = String(search || "").trim().toLowerCase();
    if (!q) return function () { return true; };
    return function (row) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.type === "autoNumber") continue;
        var text = textOf(f, row.cells[f.id]);
        if (text && String(text).toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    };
  }

  function applySorts(rows, sorts, fields) {
    if (!sorts || !sorts.length) return rows.slice();
    var copy = rows.slice();
    copy.sort(function (a, b) {
      for (var i = 0; i < sorts.length; i++) {
        var s = sorts[i];
        var field = fields.filter(function (f) { return f.id === s.fieldId; })[0];
        if (!field) continue;
        var d = compareValues(field, a.cells[field.id], b.cells[field.id]);
        if (d !== 0) return s.dir === "desc" ? -d : d;
      }
      return 0;
    });
    return copy;
  }

  function groupKeyFor(field, value) {
    if (!field) return { key: "__ungrouped__", label: "No grouping field", option: null };
    if (field.type === "singleSelect") {
      var o = D.findOption(field, value);
      return o ? { key: o.id, label: o.name, option: o, order: field.options.indexOf(o) }
               : { key: "__none__", label: "Empty", option: null, order: 9999 };
    }
    if (D.isEmptyValue(value)) return { key: "__none__", label: "Empty", option: null, order: 9999 };
    var text = D.toPlain(field, value);
    return { key: text, label: text, option: null };
  }

  /* returns [{key,label,option,rows:[...]}] or null when there is no grouping */
  function groupRows(rows, groupFieldId, fields) {
    if (!groupFieldId) return null;
    var field = fields.filter(function (f) { return f.id === groupFieldId; })[0];
    if (!field) return null;
    var map = {}, order = [];
    rows.forEach(function (row) {
      var g = groupKeyFor(field, row.cells[field.id]);
      if (!map[g.key]) { map[g.key] = { key: g.key, label: g.label, option: g.option, order: g.order == null ? 500 : g.order, rows: [] }; order.push(g.key); }
      map[g.key].rows.push(row);
    });
    return order.map(function (k) { return map[k]; }).sort(function (a, b) { return a.order - b.order; });
  }

  /* the whole pipeline in one place — used by the grid, exports and sync */
  function computeView(table, view) {
    var rows = table.rows;
    var pred = searchPredicate(view.search, table.fields);
    rows = rows.filter(pred);
    var ast = view.filtersAst;
    if (ast) rows = rows.filter(function (r) { return evaluate(ast, r, table.fields); });
    rows = applySorts(rows, view.sorts, table.fields);
    return rows;
  }

  return {
    operatorsFor: operatorsFor, operatorLabel: operatorLabel, valueNeedsInput: valueNeedsInput,
    compareValues: compareValues, matches: matches, textOf: textOf,
    and: and, or: or, not: not, cmp: cmp, evaluate: evaluate,
    buildFromConditions: buildFromConditions,
    parseQueryString: parseQueryString, toQueryString: toQueryString,
    computeView: computeView, groupRows: groupRows, groupKeyFor: groupKeyFor,
    applySorts: applySorts, searchPredicate: searchPredicate,
  };
})();

/* ============================================================================
   grid.js — the grid: one scroller + three translated lanes, row windowing,
   range selection, keyboard model, clipboard, editors for every field type,
   drag resize/reorder, long-press menus, empty + skeleton states.
   Layout contract (docs/04): .tablify-root is absolute;inset:0 and owns exactly
   one scroller. Heights are never negotiated with an ancestor.
   ========================================================================== */
window.TF = window.TF || {};

TF.grid = (function () {
  "use strict";
  var D = TF.data, Q = TF.query;

  var ROW_H = { short: 30, medium: 40, tall: 64 };
  var OVERSCAN = 8;
  var GUTTER_W = 74;
  var BAR = 14;            /* thickness of the docked scrollbars, always reserved */
  var HEADER_H = 40;

  /* Below this width the primary column stops being pinned. On a phone — and in a
     narrow desktop leaf — the pinned strip (gutter + primary column) would eat the
     whole pane and the other columns could never be reached. Under the threshold
     nothing is fixed: gutter, primary column and the rest scroll as one lane. */
  var NARROW_W = 600;

  function create(host, store, hooks) {
    hooks = hooks || {};
    var root = el("div", "tablify-root");
    root.tabIndex = 0;
    root.setAttribute("role", "grid");
    root.setAttribute("aria-label", "Tablify grid");
    root.innerHTML =
      '<div class="tablify-toolbar" id="tf-toolbar"></div>' +
      '<div class="tablify-bars" id="tf-bars"></div>' +
      '<div class="tablify-grid-area" id="tf-area">' +
        '<div class="tablify-scroller" id="tf-scroller"><div class="tablify-spacer" id="tf-spacer"></div></div>' +
        '<div class="tablify-layer tablify-header" id="tf-header"></div>' +
        '<div class="tablify-layer tablify-rows" id="tf-rows"></div>' +
        '<div class="tablify-layer tablify-frozen" id="tf-frozen"></div>' +
        '<div class="tablify-layer tablify-corner" id="tf-corner"></div>' +
        '<div class="tablify-hbar" id="tf-hbar"><div class="tablify-hthumb" id="tf-hthumb"></div></div>' +
        '<div class="tablify-vbar" id="tf-vbar"><div class="tablify-vthumb" id="tf-vthumb"></div></div>' +
      '</div>' +
      '<div class="tablify-summary" id="tf-summary"></div>' +
      '<div class="tablify-statusbar" id="tf-status"></div>';
    host.appendChild(root);

    var E = {
      root: root,
      /* looked up by class, never by id: two grids can be mounted in one
         document (two Bases views side by side), and ids are not unique then */
      toolbar: root.querySelector(".tablify-toolbar"),
      bars: root.querySelector(".tablify-bars"),
      area: root.querySelector(".tablify-grid-area"),
      scroller: root.querySelector(".tablify-scroller"),
      spacer: root.querySelector(".tablify-spacer"),
      header: root.querySelector(".tablify-header"),
      rows: root.querySelector(".tablify-rows"),
      frozen: root.querySelector(".tablify-frozen"),
      corner: root.querySelector(".tablify-corner"),
      hbar: root.querySelector(".tablify-hbar"),
      vbar: root.querySelector(".tablify-vbar"),
      hthumb: root.querySelector(".tablify-hthumb"),
      vthumb: root.querySelector(".tablify-vthumb"),
      status: root.querySelector(".tablify-statusbar"),
      summary: root.querySelector(".tablify-summary"),
    };

    var sel = { anchor: { r: 0, c: 1 }, focus: { r: 0, c: 1 } };
    var checked = [];
    var editing = null;
    var items = [];
    var drag = null;
    var longPressTimer = null;
    var rafQueued = false;

    /* ── helpers ─────────────────────────────────────────────────────────── */
    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function rowH() { return ROW_H[store.get().view.rowHeight] || 40; }
    function cols() { return store.visibleFields(); }
    function isNarrow() {
      var w = E.area.clientWidth;
      if (!w) w = window.innerWidth || 1024;   /* jsdom has no layout engine */
      return w < NARROW_W;
    }
    function frozenField() {
      var v = store.view();
      if (!v.frozenPrimary || isNarrow()) return null;
      var f = cols().filter(function (c) { return c.primary; })[0];
      return f || null;
    }
    function pinned() { return !!frozenField(); }
    function frozenW() { var f = frozenField(); return f ? f.width : 0; }
    function leadW() { return frozenField() ? GUTTER_W + frozenW() : 0; }
    /* the gutter is pinned with the primary column when there is one, and rides
       along inside the scrolling lane when there is not */
    function gutterInline() { return !frozenField(); }
    function scrollingCols() {
      var f = frozenField();
      return cols().filter(function (c) { return !(f && c.id === f.id); });
    }
    function contentW() { return scrollingCols().reduce(function (n, c) { return n + c.width; }, 0); }
    function laneW() { return (gutterInline() ? GUTTER_W : 0) + contentW(); }
    function viewW() { return Math.max(60, E.area.clientWidth - leadW() - BAR); }
    function viewH() { return Math.max(60, E.area.clientHeight - HEADER_H - BAR); }

    /* one place decides where every lane and both scrollbars live, so no render
       path can leave the grid in a state where content sits under a scrollbar */
    function layoutChrome() {
      /* Advanced settings -> Content. The switches hide content, they never
         remove the element: every measurement above stays exactly as it was. */
      var content = store.get().settings;
      E.toolbar.style.display = content.showToolbar ? "" : "none";
      E.status.style.display = content.showStatusBar ? "" : "none";
      E.summary.style.display = content.showSummaryRow && store.table().rows.length ? "" : "none";
      E.header.style.left = leadW() + "px";
      E.header.style.right = BAR + "px";
      E.header.style.top = "0";
      E.header.style.height = HEADER_H + "px";
      E.header.style.overflow = "hidden";
      E.rows.style.left = leadW() + "px";
      E.rows.style.right = BAR + "px";
      E.rows.style.top = HEADER_H + "px";
      E.rows.style.bottom = BAR + "px";
      E.rows.style.overflow = "hidden";
      E.frozen.style.left = "0";
      E.frozen.style.top = HEADER_H + "px";
      E.frozen.style.bottom = BAR + "px";
      E.frozen.style.width = leadW() + "px";
      E.frozen.style.overflow = "hidden";
      E.frozen.style.display = frozenField() ? "" : "none";
      E.corner.style.left = "0";
      E.corner.style.top = "0";
      E.corner.style.width = leadW() + "px";
      E.corner.style.height = HEADER_H + "px";
      E.corner.style.overflow = "hidden";
      E.corner.style.display = frozenField() ? "" : "none";
      E.vbar.style.top = HEADER_H + "px";
      E.vbar.style.bottom = BAR + "px";
      E.vbar.style.width = BAR + "px";
      E.vbar.style.right = "0";
      E.hbar.style.left = leadW() + "px";
      E.hbar.style.right = BAR + "px";
      E.hbar.style.bottom = "0";
      E.hbar.style.height = BAR + "px";
    }

    /* the two docked scrollbars mirror the scroller and drive it on drag */
    function updateThumbs() {
      var vw = E.scroller.clientWidth, vh = E.scroller.clientHeight;
      var sw = E.spacer.offsetWidth, sh = E.spacer.offsetHeight;
      var maxL = Math.max(0, sw - vw), maxT = Math.max(0, sh - vh);

      var trackW = E.hbar.clientWidth;
      if (maxL <= 1) { E.hthumb.style.display = "none"; }
      else {
        E.hthumb.style.display = "";
        var tw = Math.max(36, Math.round(trackW * (vw / sw)));
        tw = Math.min(trackW, tw);
        var x = maxL ? (E.scroller.scrollLeft / maxL) * (trackW - tw) : 0;
        E.hthumb.style.width = tw + "px";
        E.hthumb.style.left = Math.round(x) + "px";
      }
      var trackH = E.vbar.clientHeight;
      if (maxT <= 1) { E.vthumb.style.display = "none"; }
      else {
        E.vthumb.style.display = "";
        var th = Math.max(36, Math.round(trackH * (vh / sh)));
        th = Math.min(trackH, th);
        var y = maxT ? (E.scroller.scrollTop / maxT) * (trackH - th) : 0;
        E.vthumb.style.height = th + "px";
        E.vthumb.style.top = Math.round(y) + "px";
      }
    }

    function buildItems() {
      var view = store.view();
      var rows = store.viewRows();
      var out = [];
      var groups = Q.groupRows(rows, view.groupBy, store.table().fields);
      if (!groups) {
        rows.forEach(function (r) { out.push({ kind: "row", row: r }); });
      } else {
        groups.forEach(function (g) {
          var collapsed = view.collapsedGroups.indexOf(g.key) !== -1;
          out.push({ kind: "group", key: g.key, label: g.label, count: g.rows.length, option: g.option, collapsed: collapsed });
          if (!collapsed) g.rows.forEach(function (r) { out.push({ kind: "row", row: r }); });
        });
      }
      items = out;
      return out;
    }
    function rowItems() { return items.filter(function (i) { return i.kind === "row"; }); }
    function itemAt(r) { return items[r] || null; }
    function rowItemAt(r) { var it = items[r]; return it && it.kind === "row" ? it : null; }
    function visibleRowIndices() {
      var out = [];
      items.forEach(function (it, i) { if (it.kind === "row") out.push(i); });
      return out;
    }

    /* ── rendering ───────────────────────────────────────────────────────── */
    function render() {
      var view = store.get().view;
      root.style.setProperty("--row-h", rowH() + "px");
      root.style.setProperty("--header-h", "40px");
      root.classList.toggle("is-touch", !!store.get().ui.touch);
      syncNarrow();
      buildItems();
      clampSelection();
      layoutChrome();
      renderSpacer();
      renderHeader();
      renderCorner();
      renderBody();
      renderSummary();
      renderStatus();
      syncTransforms();
      updateThumbs();
      if (hooks.onRendered) hooks.onRendered(api);
    }

    function renderSpacer() {
      E.spacer.style.width = (leadW() + laneW() + BAR) + "px";
      E.spacer.style.height = (HEADER_H + items.length * rowH() + 44 + BAR) + "px"; // + the add-row strip
    }

    function renderHeader() {
      var lane = el("div", "lane");
      lane.style.display = "flex";
      lane.style.width = laneW() + "px";
      lane.style.height = "40px";
      var view = store.view();
      /* nothing is pinned in a narrow pane, so the row-number header scrolls with
         the columns and belongs to this lane */
      if (gutterInline()) lane.appendChild(gutterHeadCell());
      scrollingCols().forEach(function (f) {
        var node = el("div", "hcell");
        node.style.width = f.width + "px";
        node.dataset.fieldId = f.id;
        node.title = f.name + " · " + D.descriptor(f.type).label;
        var sorted = view.sorts.filter(function (s) { return s.fieldId === f.id; })[0];
        if (sorted) node.classList.add("is-sorted");
        var sortIndex = view.sorts.findIndex(function (s) { return s.fieldId === f.id; });
        node.innerHTML =
          '<span class="hcell-name">' + D.esc(f.name) + "</span>" +
          '<span class="hcell-type">' + D.esc(D.descriptor(f.type).icon) + "</span>" +
          '<span class="hcell-caret">' + (sorted ? (sorted.dir === "asc" ? "▲" : "▼") + (view.sorts.length > 1 ? (sortIndex + 1) : "") : "▾") + "</span>" +
          '<span class="hcell-resize" data-resize="' + f.id + '"></span>';
        lane.appendChild(node);
      });
      E.header.innerHTML = "";
      E.header.appendChild(lane);
    }

    /* the "#" header cell with the select-all box: lives in the corner when the
       column is pinned, and in the header lane when it is not */
    function gutterHeadCell() {
      var view = store.view();
      var cell = el("div", "hcell");
      cell.style.width = GUTTER_W + "px";
      cell.innerHTML =
        (view.rowNumbers ? '<label class="checkbox tablify-checkall" title="Select all rows"></label>' : "") +
        '<span class="hcell-name">#</span>';
      var all = cell.querySelector(".tablify-checkall");
      if (all) {
        var rows = rowItems();
        var allChecked = rows.length > 0 && rows.every(function (it) { return checked.indexOf(it.row.id) !== -1; });
        all.classList.add("checkbox");
        all.setAttribute("role", "checkbox");
        all.setAttribute("aria-checked", allChecked ? "true" : "false");
        all.style.cssText = "appearance:none;width:15px;height:15px;border:1.5px solid var(--background-modifier-border-focus);border-radius:3px;" +
          (allChecked ? "background:var(--tablify-accent);border-color:var(--tablify-accent);" : "background:var(--background-primary);");
        all.addEventListener("click", function (e) {
          e.stopPropagation();
          var ids = rowItems().map(function (it) { return it.row.id; });
          checked = allChecked ? [] : ids;
          render();
        });
      }
      return cell;
    }
    function renderCorner() {
      var f = frozenField();
      E.corner.style.width = leadW() + "px";
      E.corner.style.height = "40px";
      E.corner.style.overflow = "hidden";
      E.corner.style.display = f ? "" : "none";
      E.corner.innerHTML = "";
      if (!f) return;               /* narrow pane: the header lane owns the "#" cell */
      var view = store.view();
      var wrap = el("div", "lane");
      wrap.style.display = "flex";
      wrap.style.height = "40px";
      wrap.appendChild(gutterHeadCell());
      var node = el("div", "hcell");
      node.style.width = f.width + "px";
      node.dataset.fieldId = f.id;
      var sorted = view.sorts.filter(function (s) { return s.fieldId === f.id; })[0];
      if (sorted) node.classList.add("is-sorted");
      node.innerHTML =
        '<span class="hcell-name">' + D.esc(f.name) + "</span>" +
        '<span class="hcell-type">' + D.esc(D.descriptor(f.type).icon) + "</span>" +
        '<span class="hcell-caret">' + (sorted ? (sorted.dir === "asc" ? "▲" : "▼") : "▾") + "</span>" +
        '<span class="hcell-resize" data-resize="' + f.id + '"></span>';
      wrap.appendChild(node);
      E.corner.appendChild(wrap);
    }
    function renderBody() {
      var view = store.view(), rh = rowH();

      /* nothing to draw: two different stories, two different messages */
      if (!items.length) {
        E.header.innerHTML = "";
        E.corner.innerHTML = "";
        E.frozen.innerHTML = "";
        E.rows.innerHTML = "";
        var box = el("div", "tablify-empty");
        var total = store.table().rows.length;
        var filtered = total > 0;
        var title = el("div", "tablify-empty-title", filtered ? "No rows match this view" : "This table is empty");
        box.appendChild(title);
        box.appendChild(el("div", null, filtered
          ? "Nothing survives the current filter, query or search. " + total + " row(s) are in the table."
          : "Rows are notes in your vault. Create one here, or import a CSV, XLSX or .tabula file."));
        var bar = el("div", "tablify-bar");
        bar.style.justifyContent = "center";
        var add = el("button", "tablify-btn", "+ New row");
        add.type = "button";
        add.addEventListener("click", function () { var id = store.addRow(); selectRowId(id); });
        bar.appendChild(add);
        if (filtered) {
          var clear = el("button", "tablify-btn", "Clear filter, sort and search");
          clear.type = "button";
          clear.addEventListener("click", function () {
            store.transaction("clear the whole view", function (s) {
              s.view.filters = { logic: "and", conditions: [] };
              s.view.filtersAst = null; s.view.query = ""; s.view.queryErrors = [];
              s.view.sorts = []; s.view.groupBy = null; s.view.collapsedGroups = []; s.view.search = "";
            });
            grid.render();
          });
          bar.appendChild(clear);
        }
        var imp = el("button", "tablify-btn", "Import…");
        imp.type = "button";
        imp.addEventListener("click", function () {
          if (hooks.onImport) hooks.onImport(); else store.announce("Use the Import button in the toolbar");
        });
        bar.appendChild(imp);
        box.appendChild(bar);
        E.rows.appendChild(box);
        renderSpacer();
        return;
      }

      var scrollerH = viewH();
      var scrollTop = E.scroller.scrollTop;
      var start = Math.max(0, Math.floor(scrollTop / rh) - OVERSCAN);
      var end = Math.min(items.length, Math.ceil((scrollTop + Math.max(60, scrollerH)) / rh) + OVERSCAN);

      /* rows lane (non-frozen columns) */
      var lane = el("div", "lane");
      lane.style.position = "relative";
      lane.style.width = laneW() + "px";
      lane.style.height = Math.max(1, items.length * rh) + "px";
      var colsList = scrollingCols();
      for (var i = start; i < end; i++) {
        var it = items[i];
        if (!it) continue;
        var node;
        if (it.kind === "group") {
          node = el("div", "group-bar");
          node.style.position = "absolute";
          node.style.top = (i * rh) + "px";
          node.style.height = rh + "px";
          node.style.width = laneW() + "px";
          node.innerHTML = (it.collapsed ? "▶ " : "▼ ") + D.esc(it.label) + ' <span class="group-count">' + it.count + (it.count === 1 ? " row" : " rows") + "</span>";
          node.dataset.groupKey = it.key;
          /* the group bar is content, not structure: with it switched off the
             rows of the group are still there, in order, just unlabelled */
          if (store.get().settings.showGroupHeaders) lane.appendChild(node);
        } else {
          node = renderRowNode(it.row, i, colsList, rh);
          lane.appendChild(node);
        }
      }
      /* the add-row strip lives at the end of the lane */
      var addBtn = el("button", "tablify-addrow");
      addBtn.style.position = "absolute";
      addBtn.style.top = (items.length * rh) + "px";
      addBtn.style.width = Math.max(laneW(), 200) + "px";
      addBtn.innerHTML = "<span>+</span> New row";
      addBtn.addEventListener("click", function () { var id = store.addRow(); selectRowId(id); });
      lane.appendChild(addBtn);

      E.rows.innerHTML = "";
      E.rows.appendChild(lane);

      /* frozen lane — built only when the pane is wide enough to pin the column */
      E.frozen.innerHTML = "";
      var fField = frozenField();
      if (fField) {
        var flock = el("div", "lane");
        flock.style.position = "relative";
        flock.style.width = leadW() + "px";
        flock.style.height = Math.max(1, items.length * rh) + "px";
        for (var j = start; j < end; j++) {
          var fit = items[j];
          if (!fit) continue;
          if (fit.kind === "group") {
            var g = el("div", "group-bar-frozen");
            g.style.position = "absolute";
            g.style.top = (j * rh) + "px";
            g.style.width = leadW() + "px";
            g.style.height = rh + "px";
            g.dataset.groupKey = fit.key;
            g.innerHTML = (fit.collapsed ? "▶ " : "▼ ") + D.esc(fit.label) + ' <span class="group-count">' + fit.count + "</span>";
            flock.appendChild(g);
          } else {
            var frow = el("div", "grid-row");
            frow.style.position = "absolute";
            frow.style.top = (j * rh) + "px";
            frow.style.height = rh + "px";
            frow.style.width = leadW() + "px";
            frow.dataset.r = j;
            frow.dataset.rowId = fit.row.id;
            if (checked.indexOf(fit.row.id) !== -1) frow.classList.add("is-checked");
            frow.appendChild(gutter(j, fit.row.id, rh));
            var fcell = renderCell(fField, fit.row, j, cols().indexOf(fField) + 1, rh);
            frow.appendChild(fcell);
            flock.appendChild(frow);
          }
        }
        E.frozen.appendChild(flock);
      }
    }

    /* the row-number / checkbox gutter: pinned inside the frozen strip when the
       pane is wide, and part of the scrolling lane when it is not */
    function gutter(rIndex, rowId, rh) {
      var box = el("div", "gutter");
      box.style.width = GUTTER_W + "px";
      box.style.height = rh + "px";
      box.dataset.r = rIndex;
      /* "Row numbers & checkboxes" in Advanced settings -> Content. The drag
         handle is structure — reordering still works with it; the checkbox and
         the row number are content, so the switch really removes them. */
      var view = store.view();
      if (view.rowNumbers) {
        var cb = el("input", "checkbox");
        cb.type = "checkbox";
        cb.checked = checked.indexOf(rowId) !== -1;
        cb.title = "Select row";
        cb.addEventListener("click", function (ev) { ev.stopPropagation(); toggleChecked(rowId); });
        cb.addEventListener("change", function () { toggleChecked(rowId); });
        box.appendChild(cb);
      }
      var handle = el("span", "gutter-handle", "\u28ff");
      handle.title = "Drag to reorder";
      handle.dataset.rowDrag = rowId;
      box.appendChild(handle);
      if (view.rowNumbers) {
        var num = el("span", null, String(rIndex + 1));
        num.style.marginLeft = "auto";
        box.appendChild(num);
      }
      return box;
    }

    function renderRowNode(row, rIndex, colsList, rh) {
      var node = el("div", "grid-row");
      node.style.position = "absolute";
      node.style.top = (rIndex * rh) + "px";
      node.style.height = rh + "px";
      node.style.width = laneW() + "px";
      if (checked.indexOf(row.id) !== -1) node.classList.add("is-checked");
      if (gutterInline()) node.appendChild(gutter(rIndex, row.id, rh));
      colsList.forEach(function (f, ci) {
        node.appendChild(renderCell(f, row, rIndex, cols().indexOf(f) + 1, rh, ci));
      });
      return node;
    }


    function renderCell(field, row, rIndex, cIndex, rh, ci) {
      var cell = el("div", "cell");
      cell.style.width = field.width + "px";
      cell.style.height = rh + "px";
      cell.dataset.r = rIndex;
      cell.dataset.c = cIndex;
      cell.dataset.fieldId = field.id;
      cell.dataset.rowId = row.id;
      cell.setAttribute("role", "gridcell");
      var value = row.cells[field.id];
      var ro = D.isReadOnly(field);
      if (ro) {
        cell.classList.add("is-readonly");
        cell.title = "Read-only: " + D.descriptor(field.type).label;
        cell.setAttribute("aria-readonly", "true");
      }
      if (inRange(rIndex, cIndex)) cell.classList.add("in-range");
      if (isActive(rIndex, cIndex)) cell.classList.add("is-active");
      var empty = D.isEmptyValue(value);
      if (empty) cell.classList.add("is-empty");
      var desc = D.descriptor(field.type);
      if (desc.numeric || field.type === "currency" || field.type === "percent") cell.classList.add("is-number");

      var html = cellInner(field, row, value, empty);
      cell.innerHTML = html;
      if (field.type === "checkbox") {
        /* a bare <input> toggles itself and forgets: the store has to hear it */
        var box = cell.querySelector("input.checkbox");
        if (box) box.addEventListener("change", function (ev) {
          ev.stopPropagation();
          store.setCell(row.id, field.id, ev.target.checked);
        });
        if (box) box.addEventListener("mousedown", function (ev) { ev.stopPropagation(); });
      }
      if (isActive(rIndex, cIndex)) cell.setAttribute("aria-selected", "true");
      void ci;
      return cell;
    }

    function cellInner(field, row, value, empty) {
      switch (field.type) {
        case "singleSelect": {
          var opt = D.findOption(field, value);
          return opt ? D.formatCell(field, value).html : '<span class="cell-text">—</span>';
        }
        case "multiSelect": {
          var list = Array.isArray(value) ? value : [];
          if (!list.length) return '<span class="cell-text">—</span>';
          return list.map(function (id) { var o = D.findOption(field, id); return o ? '<span class="pill pill--' + o.color + '">' + D.esc(o.name) + "</span>" : ""; }).join("");
        }
        case "checkbox":
          return '<input class="checkbox" type="checkbox" ' + (value ? "checked" : "") + ' tabindex="-1" aria-label="' + D.esc(field.name) + '">';
        case "rating": {
          var max = field.max || 5, out = "";
          for (var i = 1; i <= max; i++) out += i <= (value || 0) ? "★" : '<span class="stars-empty">☆</span>';
          return '<span class="stars">' + out + "</span>";
        }
        case "percent": {
          var p = value || 0;
          return '<span class="bar" role="img" aria-label="' + p + ' percent"><span class="bar-fill" style="width:' + p + '%"></span></span>' +
                 '<span class="cell-text" style="min-width:34px;text-align:right">' + p + "%</span>";
        }
        case "url":
          return empty ? '<span class="cell-text">—</span>' : '<span class="cell-text linkish" title="' + D.esc(value) + '">' + D.esc(value) + "</span>";
        case "email":
          return empty ? '<span class="cell-text">—</span>' : '<span class="cell-text linkish" title="' + D.esc(value) + '">' + D.esc(value) + "</span>";
        case "attachment":
          return empty ? '<span class="cell-text">—</span>' : D.formatCell(field, value).html;
        case "longText":
          return '<span class="cell-text" title="' + D.esc(D.toPlain(field, value)) + '">' + D.esc(D.formatCell(field, value).text) + "</span>";
        default:
          return '<span class="cell-text">' + (empty ? "—" : D.esc(D.formatCell(field, value).text)) + "</span>";
      }
    }

    /* -- summary row (Advanced settings -> Content) ---------------------------
       In the real plugin these aggregates come from the .base `summaries`
       block; here they are computed from the rows this view is showing, so the
       row cannot lie about what it is summarising. */
    function aggregate(field, rows) {
      var vals = [];
      rows.forEach(function (r) {
        var v = r.cells[field.id];
        var empty = v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
        if (!empty) vals.push(v);
      });
      if (!vals.length) return "";
      var num = field.type === "number" || field.type === "currency" || field.type === "percent" || field.type === "duration";
      if (num) {
        var sum = vals.reduce(function (n, v) { return n + (Number(v) || 0); }, 0);
        return "\u03a3 " + D.formatCell(field, sum).text;
      }
      if (field.type === "rating") {
        var avg = vals.reduce(function (n, v) { return n + (Number(v) || 0); }, 0) / vals.length;
        return "\u2300 " + (Math.round(avg * 10) / 10);
      }
      if (field.type === "checkbox") {
        return vals.filter(function (v) { return v === true; }).length + " of " + vals.length;
      }
      return String(vals.length);
    }

    function summaryCell(field, rows) {
      var cell = el("div", "summary-cell");
      cell.style.width = field.width + "px";
      cell.dataset.fieldId = field.id;
      var num = field.type === "number" || field.type === "currency" || field.type === "percent" || field.type === "duration";
      if (num) cell.classList.add("is-num");
      cell.textContent = aggregate(field, rows);
      return cell;
    }

    function renderSummary() {
      E.summary.innerHTML = "";
      if (!store.get().settings.showSummaryRow || !store.table().rows.length) return;
      var rows = items.filter(function (it) { return it.row; }).map(function (it) { return it.row; });
      var frozen = el("div", "summary-frozen");
      frozen.style.width = leadW() + "px";
      if (frozenField()) frozen.classList.add("has-pin");
      var lane = el("div", "summary-lane");
      lane.style.left = leadW() + "px";
      lane.style.width = laneW() + "px";
      var label = el("div", "summary-gutter", "Summary");
      label.style.width = GUTTER_W + "px";
      if (frozenField()) {
        frozen.appendChild(label);
        frozen.appendChild(summaryCell(frozenField(), rows));
      } else {
        lane.appendChild(label);
      }
      scrollingCols().forEach(function (f) { lane.appendChild(summaryCell(f, rows)); });
      E.summary.appendChild(frozen);
      E.summary.appendChild(lane);
    }

    function renderStatus() {
      var view = store.view();
      var shown = rowItems().length;
      var total = store.table().rows.length;
      var rng = range();
      var cells = (rng.r1 - rng.r0 + 1) * (rng.c1 - rng.c0 + 1);
      var sel = rng.r0 === rng.r1 && rng.c0 === rng.c1 ? "1 cell" : cells + " cells";
      var bits = [];
      bits.push("<span>" + shown + " of " + total + " rows</span>");
      bits.push("<span>" + sel + " selected</span>");
      if (checked.length) bits.push("<span>" + checked.length + " row(s) checked</span>");
      if (view.filtersAst) bits.push("<span>filtered</span>");
      if (view.sorts.length) bits.push("<span>" + view.sorts.length + " sort" + (view.sorts.length > 1 ? "s" : "") + "</span>");
      if (view.groupBy) bits.push("<span>grouped</span>");
      bits.push('<span class="tablify-save"><span class="tablify-save-dot"></span><span class="tablify-save-text">Saved</span></span>');
      E.status.innerHTML = bits.join("");
      var dot = E.status.querySelector(".tablify-save-dot"), txt = E.status.querySelector(".tablify-save-text");
      if (dot && txt && saveState) {
        dot.style.background = saveState === "saving" ? "var(--tablify-pending)" : (saveState === "error" ? "var(--tablify-danger)" : "var(--tablify-ok)");
        txt.textContent = saveState === "saving" ? "Saving…" : (saveState === "error" ? "Save failed" : "Saved");
      }
    }

    var saveState = "saved";
    function onSave(kind) { saveState = kind === "saving" ? "saving" : (kind === "error" ? "error" : "saved"); renderStatus(); }

    /* ── transforms ──────────────────────────────────────────────────────── */
    function syncTransforms() {
      var st = E.scroller.scrollTop, sl = E.scroller.scrollLeft;
      var headerLane = E.header.firstChild, rowsLane = E.rows.firstChild, frozenLane = E.frozen.firstChild;
      if (headerLane) headerLane.style.transform = "translateX(" + -sl + "px)";
      if (rowsLane) rowsLane.style.transform = "translate(" + -sl + "px," + -st + "px)";
      if (frozenLane) frozenLane.style.transform = "translateY(" + -st + "px)";
      var sumLane = E.summary && E.summary.lastChild;
      if (sumLane) sumLane.style.transform = "translateX(" + -sl + "px)";
    }
    E.scroller.addEventListener("scroll", function () {
      if (rafQueued) return;
      rafQueued = true;
      requestAnimationFrame(function () { rafQueued = false; syncTransforms(); updateThumbs(); });
    }, { passive: true });

    /* re-render only when the visible window changes materially */
    var lastWindow = { start: -1, end: -1, top: -1 };
    E.scroller.addEventListener("scroll", function () {
      var rh = rowH();
      var st = E.scroller.scrollTop;
      var h = viewH();
      var start = Math.max(0, Math.floor(st / rh) - OVERSCAN);
      var end = Math.min(items.length, Math.ceil((st + Math.max(60, h)) / rh) + OVERSCAN);
      if (start !== lastWindow.start || end !== lastWindow.end || Math.abs(st - lastWindow.top) > rh * 2) {
        lastWindow = { start: start, end: end, top: st };
        renderBody();
      }
    }, { passive: true });


    /* ── scrolling input ───────────────────────────────────────────────────
       The lanes are painted ON TOP of the scroller, so a wheel that lands on a
       cell has no scrollable ancestor: without forwarding, hovering the data
       and scrolling does nothing at all. The same is true for the header, the
       gutter and the frozen lane, which is why this listens on the whole area. */
    function clampScroll(dx, dy) {
      var maxL = Math.max(0, E.scroller.scrollWidth - E.scroller.clientWidth);
      var maxT = Math.max(0, E.scroller.scrollHeight - E.scroller.clientHeight);
      var nl = Math.max(0, Math.min(maxL, E.scroller.scrollLeft + dx));
      var nt = Math.max(0, Math.min(maxT, E.scroller.scrollTop + dy));
      var moved = (nl !== E.scroller.scrollLeft) || (nt !== E.scroller.scrollTop);
      E.scroller.scrollLeft = nl;
      E.scroller.scrollTop = nt;
      if (moved) { syncTransforms(); updateThumbs(); }
      return moved;
    }

    E.area.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.metaKey) return;                       // leave pinch-zoom alone
      var dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 16; dy *= 16; }             // line mode
      else if (e.deltaMode === 2) { dx *= E.scroller.clientWidth; dy *= E.scroller.clientHeight; }
      if (e.shiftKey && Math.abs(dx) < Math.abs(dy)) { dx = dy; dy = 0; }   // shift = sideways
      if (clampScroll(dx, dy)) e.preventDefault();
    }, { passive: false });

    /* docked scrollbars: drag the thumb, click the track to page */
    function beginBarDrag(axis, e) {
      e.preventDefault();
      e.stopPropagation();
      var track = axis === "x" ? E.hbar : E.vbar;
      var thumb = axis === "x" ? E.hthumb : E.vthumb;
      var tRect = track.getBoundingClientRect();
      var thRect = thumb.getBoundingClientRect();
      var startPos = axis === "x" ? e.clientX : e.clientY;
      var startScroll = axis === "x" ? E.scroller.scrollLeft : E.scroller.scrollTop;
      var trackLen = axis === "x" ? tRect.width : tRect.height;
      var thumbLen = axis === "x" ? thRect.width : thRect.height;
      var span = Math.max(1, trackLen - thumbLen);
      var maxScroll = axis === "x"
        ? Math.max(0, E.scroller.scrollWidth - E.scroller.clientWidth)
        : Math.max(0, E.scroller.scrollHeight - E.scroller.clientHeight);
      track.classList.add("is-dragging");
      function move(ev) {
        var pos = axis === "x" ? ev.clientX : ev.clientY;
        var next = startScroll + ((pos - startPos) / span) * maxScroll;
        next = Math.max(0, Math.min(maxScroll, next));
        if (axis === "x") E.scroller.scrollLeft = next; else E.scroller.scrollTop = next;
        syncTransforms(); updateThumbs();
      }
      function up() {
        track.classList.remove("is-dragging");
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
      }
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    }
    E.hthumb.addEventListener("pointerdown", function (e) { beginBarDrag("x", e); });
    E.vthumb.addEventListener("pointerdown", function (e) { beginBarDrag("y", e); });

    function trackPage(axis, e) {
      var track = axis === "x" ? E.hbar : E.vbar;
      var thumb = axis === "x" ? E.hthumb : E.vthumb;
      var tRect = track.getBoundingClientRect();
      var thRect = thumb.getBoundingClientRect();
      if (axis === "x") clampScroll(e.clientX < thRect.left ? -viewW() : (e.clientX > thRect.right ? viewW() : 0), 0);
      else clampScroll(0, e.clientY < thRect.top ? -viewH() : (e.clientY > thRect.bottom ? viewH() : 0));
      void tRect;
    }
    E.hbar.addEventListener("pointerdown", function (e) { if (e.target === E.hthumb) return; trackPage("x", e); });
    E.vbar.addEventListener("pointerdown", function (e) { if (e.target === E.vthumb) return; trackPage("y", e); });

    /* narrow panes drop the pinned column entirely, and that has to react to a
       window resize as well as to a CSS max-width change (the harness's phone
       squeeze), which never fires window.resize */
    var narrowState = null;
    function syncNarrow() {
      var n = isNarrow();
      root.classList.toggle("is-narrow", n);
      var flipped = n !== narrowState;
      narrowState = n;
      return flipped;
    }
    window.addEventListener("resize", function () { layoutChrome(); render(); });
    if (typeof ResizeObserver === "function" && E.area) {
      try {
        new ResizeObserver(function () {
          /* re-render only when the threshold is crossed: resizing inside one side
             of it must not fight the render loop */
          if (syncNarrow()) render();
        }).observe(E.area);
      } catch (err) { /* no observer: window resizes are still covered above */ }
    }

    /* ── selection ───────────────────────────────────────────────────────── */
    function range() {
      return {
        r0: Math.min(sel.anchor.r, sel.focus.r), r1: Math.max(sel.anchor.r, sel.focus.r),
        c0: Math.min(sel.anchor.c, sel.focus.c), c1: Math.max(sel.anchor.c, sel.focus.c),
      };
    }
    function inRange(r, c) { var x = range(); return r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1; }
    function isActive(r, c) { return sel.focus.r === r && sel.focus.c === c; }
    function clampSelection() {
      var maxR = Math.max(0, items.length - 1), maxC = Math.max(1, cols().length);
      sel.anchor.r = Math.max(0, Math.min(sel.anchor.r, maxR));
      sel.focus.r = Math.max(0, Math.min(sel.focus.r, maxR));
      sel.anchor.c = Math.max(1, Math.min(sel.anchor.c, maxC));
      sel.focus.c = Math.max(1, Math.min(sel.focus.c, maxC));
    }
    function setSel(r, c, extend) {
      sel.focus = { r: r, c: c };
      if (!extend) sel.anchor = { r: r, c: c };
      var res = render();
      void res;
    }
    /* a keyboard jump has to bring the cell on screen, exactly like moveBy */
    function jumpTo(r, c, extend) {
      setSel(r, c, extend);
      scrollToCell(r, c);
    }
    function selectRowId(rowId) {
      var idx = items.findIndex(function (it) { return it.kind === "row" && it.row.id === rowId; });
      if (idx !== -1) { setSel(idx, 1); scrollToCell(idx, 1); }
      render();
    }
    function focusCellAt(r, c) {
      var it = items[r];
      if (it && it.kind === "group") {
        var dir = r <= sel.focus.r ? -1 : 1;
        var t = r;
        while (items[t] && items[t].kind === "group") { t += dir; if (t < 0 || t >= items.length) { t = r; break; } }
        r = t;
      }
      setSel(r, c, false);
      scrollToCell(r, c);
      root.focus();
    }
    function scrollToCell(r, c) {
      var rh = rowH();
      var vh = viewH(), vw = viewW();
      var y = r * rh;
      if (y < E.scroller.scrollTop) E.scroller.scrollTop = y;
      else if (y + rh > E.scroller.scrollTop + vh) E.scroller.scrollTop = y + rh - vh;
      var list = scrollingCols();
      var f = frozenField();
      var target = cols()[c - 1];
      /* with the gutter inline it sits before the first column */
      var base = gutterInline() ? GUTTER_W : 0;
      if (target && f && target.id === f.id) { E.scroller.scrollLeft = 0; return; }
      var idx = list.indexOf(target);
      if (idx === -1) return;
      var x = base + list.slice(0, idx).reduce(function (n, col) { return n + col.width; }, 0);
      if (x < E.scroller.scrollLeft) E.scroller.scrollLeft = x;
      else if (x + target.width > E.scroller.scrollLeft + vw) E.scroller.scrollLeft = x + target.width - vw;
    }
    function moveBy(dr, dc, extend) {
      var rowsIdx = visibleRowIndices();
      if (!rowsIdx.length) return;
      var cur = rowsIdx.indexOf(sel.focus.r);
      if (cur === -1) cur = 0;
      var nr = sel.focus.r, nc = sel.focus.c;
      if (dr) {
        var target = cur + dr;
        if (target < 0 || target >= rowsIdx.length) return;
        nr = rowsIdx[target];
      }
      if (dc) nc = Math.max(1, Math.min(cols().length, nc + dc));
      setSel(nr, nc, extend);
      scrollToCell(nr, nc);
    }
    function selectAll() {
      var rowsIdx = visibleRowIndices();
      if (!rowsIdx.length) return;
      sel.anchor = { r: rowsIdx[0], c: 1 };
      sel.focus = { r: rowsIdx[rowsIdx.length - 1], c: cols().length };
      render();
    }
    function selectionData() {
      var x = range(), list = cols();
      var rows = [];
      for (var r = x.r0; r <= x.r1; r++) { var it = rowItemAt(r); if (it) rows.push(it.row); }
      var fields = list.slice(x.c0 - 1, x.c1);
      return { rows: rows, fields: fields, r0: x.r0, r1: x.r1, c0: x.c0, c1: x.c1 };
    }

    /* ── checked rows ────────────────────────────────────────────────────── */
    function toggleChecked(rowId) {
      var i = checked.indexOf(rowId);
      if (i === -1) checked.push(rowId); else checked.splice(i, 1);
      render();
    }
    function setChecked(ids) { checked = ids.slice(); render(); }
    function getChecked() { return checked.slice(); }

    /* ── editors ─────────────────────────────────────────────────────────── */
    function commitFromEditor(field, row, text, keepOpen) {
      var value = D.fromPlain(field, text);
      store.setCell(row.id, field.id, value);
      editing = null;
      if (!keepOpen) { render(); handFocusBack(); }
    }

    function beginEdit(r, c) {
      var it = rowItemAt(r);
      if (!it) return;
      var field = cols()[c - 1];
      if (!field) return;
      if (D.isReadOnly(field)) { store.announce(field.name + " is read-only"); return; }
      if (field.type === "checkbox") {
        store.setCell(it.row.id, field.id, !it.row.cells[field.id]);
        return;
      }
      if (field.type === "singleSelect" || field.type === "multiSelect") return openSelectPopover(r, c, field, it.row);
      if (field.type === "rating" || field.type === "attachment" || field.type === "longText") return openPopover(r, c, field, it.row);

      editing = { r: r, c: c, fieldId: field.id, rowId: it.row.id, at: Date.now() };
      var cell = findCell(r, c);
      if (!cell) return;
      var current = it.row.cells[field.id];
      var input = el("input", "cell-editor");
      input.value = field.type === "datetime" ? D.toLocalInput(current) :
                    (D.isEmptyValue(current) ? "" : D.formatCell(field, current).text);
      if (field.type === "currency") input.value = D.isEmptyValue(current) ? "" : String(current);
      if (field.type === "percent" || field.type === "number" || field.type === "duration" || field.type === "rating") input.value = D.isEmptyValue(current) ? "" : String(current);
      cell.innerHTML = "";
      cell.appendChild(input);
      input.focus();
      input.select();
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); commitFromEditor(field, it.row, input.value); moveBy(1, 0); }
        else if (e.key === "Tab") { e.preventDefault(); commitFromEditor(field, it.row, input.value); moveBy(0, e.shiftKey ? -1 : 1); }
        else if (e.key === "Escape") { e.preventDefault(); editing = null; render(); handFocusBack(); }
        e.stopPropagation();
      });
      input.addEventListener("blur", function () {
        if (!editing || editing.r !== r || editing.c !== c) return;
        /* ignore a blur that arrives in the same tick the editor opened */
        if (Date.now() - (editing.at || 0) < 60) {
          editing.at = 0;
          setTimeout(function () {
            if (editing && editing.r === r && editing.c === c && document.activeElement !== input) input.focus();
          }, 0);
          return;
        }
        commitFromEditor(field, it.row, input.value);
      });
    }

    function commitTypedInput(r, c, text) {
      var it = rowItemAt(r); var field = cols()[c - 1];
      if (!it || !field || D.isReadOnly(field)) return;
      if (field.type === "checkbox") { store.setCell(it.row.id, field.id, /^(true|yes|1|x)$/i.test(text)); render(); return; }
      if (field.type === "singleSelect" || field.type === "multiSelect") {
        store.commit("edit cell", function () {
          var f = store.fieldById(field.id);
          f._autoCreate = true;
          it.row.cells[field.id] = D.fromPlain(f, text);
          f._autoCreate = false;
        });
        render();
        return;
      }
      store.setCell(it.row.id, field.id, D.fromPlain(field, text));
      render();
    }

    function findCell(r, c) {
      var node = root.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
      return node;
    }
    function cellRect(r, c) {
      var node = findCell(r, c);
      if (!node) return null;
      return node.getBoundingClientRect();
    }

    /* generic popover: rating / attachment / long text expand */
    /* popovers are appended to document.body, so the grid's keyboard handler
       (scoped to root) never sees the keys typed inside them. Escape has to be
       bound on the surface itself, or a textarea swallows it and the popover
       becomes mouse-only to dismiss. */
    function popEscape(pop) {
      pop.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        closePopovers();
        render();
        handFocusBack();
      });
    }

    function openPopover(r, c, field, row) {
      closePopovers();
      var rect = cellRect(r, c) || { left: 40, bottom: 120, width: 180 };
      var pop = el("div", "pop");
      pop.dataset.pop = "1";
      if (field.type === "rating") {
        var max = field.max || 5;
        var wrap = el("div");
        wrap.style.cssText = "display:flex;gap:2px;font-size:20px;color:var(--tablify-star);cursor:pointer;padding:4px";
        for (var i = 1; i <= max; i++) {
          (function (n) {
            var star = el("span", null, n <= (row.cells[field.id] || 0) ? "★" : "☆");
            star.addEventListener("click", function () { store.setCell(row.id, field.id, n); closePopovers(); render(); });
            wrap.appendChild(star);
          })(i);
        }
        var clear = el("div", "pop-item", "Clear rating");
        clear.addEventListener("click", function () { store.setCell(row.id, field.id, null); closePopovers(); render(); });
        pop.appendChild(wrap); pop.appendChild(clear);
      } else if (field.type === "attachment") {
        pop.appendChild(el("div", "pop-label", "Attachments"));
        var list = Array.isArray(row.cells[field.id]) ? row.cells[field.id] : [];
        list.forEach(function (file, i) {
          var item = el("div", "pop-item");
          item.innerHTML = '<span>▣ ' + D.esc(file) + "</span><span class='pop-item-tick' style='cursor:pointer' title='Remove'>✕</span>";
          item.querySelector(".pop-item-tick").addEventListener("click", function (e) {
            e.stopPropagation();
            var next = list.slice(); next.splice(i, 1);
            store.setCell(row.id, field.id, next); closePopovers(); render();
          });
          pop.appendChild(item);
        });
        var addInput = el("input", "ob-input");
        addInput.placeholder = "Vault path, e.g. Assets/photo.png";
        addInput.addEventListener("keydown", function (e) {
          if (e.key !== "Enter") return;
          var v = addInput.value.trim();
          if (!v) return;
          store.setCell(row.id, field.id, list.concat([v]));
          closePopovers(); render();
        });
        pop.appendChild(addInput);
      } else if (field.type === "longText") {
        pop.style.minWidth = "340px";
        pop.appendChild(el("div", "pop-label", "Edit long text"));
        var ta = el("textarea", "ob-textarea");
        ta.value = String(row.cells[field.id] == null ? "" : row.cells[field.id]);
        ta.style.minHeight = "120px";
        var save = el("button", "ob-btn is-primary", "Save");
        save.style.marginTop = "8px";
        save.addEventListener("click", function () { store.setCell(row.id, field.id, ta.value); closePopovers(); render(); });
        pop.appendChild(ta); pop.appendChild(save);
        setTimeout(function () { ta.focus(); }, 0);
      }
      document.body.appendChild(pop);
      popEscape(pop);
      positionPopover(pop, rect);
      originFrom(pop, rect);
    }

    function openSelectPopover(r, c, field, row) {
      closePopovers();
      var rect = cellRect(r, c) || { left: 40, bottom: 120, width: 180 };
      var pop = el("div", "pop");
      pop.dataset.pop = "1";
      var search = el("input", "ob-input pop-search");
      search.placeholder = "Search or create…";
      pop.appendChild(search);
      var listWrap = el("div");
      pop.appendChild(listWrap);
      var multi = field.type === "multiSelect";

      function drawList(filter) {
        listWrap.innerHTML = "";
        var options = (field.options || []).filter(function (o) {
          return !filter || o.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
        });
        options.forEach(function (o) {
          var picked = multi ? (row.cells[field.id] || []).indexOf(o.id) !== -1 : row.cells[field.id] === o.id;
          var item = el("div", "pop-item" + (picked ? " is-picked" : ""));
          item.innerHTML = '<span class="pill pill--' + o.color + '"><span class="pill-dot"></span>' + D.esc(o.name) + "</span>" +
            (picked ? '<span class="pop-item-tick">✓</span>' : "");
          item.addEventListener("click", function () {
            if (multi) {
              var list = (row.cells[field.id] || []).slice();
              var i = list.indexOf(o.id);
              if (i === -1) list.push(o.id); else list.splice(i, 1);
              store.setCell(row.id, field.id, list);
              drawList(search.value);
            } else {
              store.setCell(row.id, field.id, row.cells[field.id] === o.id ? null : o.id);
              closePopovers(); render();
            }
          });
          listWrap.appendChild(item);
        });
        var exact = (field.options || []).some(function (o) { return o.name.toLowerCase() === String(filter || "").toLowerCase(); });
        if (filter && !exact) {
          var create = el("div", "pop-item pop-create", '+ Create "' + filter + '"');
          create.addEventListener("click", function () {
            var id = store.addOption(field.id, filter);
            if (!id) return;
            if (multi) store.setCell(row.id, field.id, (row.cells[field.id] || []).concat([id]));
            else store.setCell(row.id, field.id, id);
            closePopovers(); render();
          });
          listWrap.appendChild(create);
        }
        if (!options.length && !filter) listWrap.appendChild(el("div", "pop-item is-disabled", "No options yet"));
      }
      drawList("");
      search.addEventListener("input", function () { drawList(search.value); });
      search.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Escape") { closePopovers(); render(); }
        if (e.key === "Enter") {
          var first = listWrap.querySelector(".pop-create") || listWrap.querySelector(".pop-item");
          if (first) first.click();
        }
      });
      document.body.appendChild(pop);
      popEscape(pop);
      positionPopover(pop, rect);
      originFrom(pop, rect);
      setTimeout(function () { search.focus(); }, 0);
    }

    function positionPopover(pop, rect) {
      var w = pop.offsetWidth || 220, h = pop.offsetHeight || 200;
      var left = Math.min(rect.left, window.innerWidth - w - 12);
      var top = rect.bottom + 4;
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 4);
      pop.style.left = Math.max(8, left) + "px";
      pop.style.top = top + "px";
    }
    /* a popover should look like it came from the cell that opened it */
    function originFrom(pop, rect) {
      if (!rect) return;
      var left = parseFloat(pop.style.left) || 0;
      var top = parseFloat(pop.style.top) || 0;
      var w = pop.offsetWidth || 220;
      var x = Math.max(0, Math.min(w, Math.round(rect.left - left)));
      pop.style.transformOrigin = x + "px " + (rect.top != null && top < rect.top ? "100%" : "0");
    }
    function closePopovers() {
      Array.prototype.forEach.call(document.querySelectorAll('[data-pop="1"]'), function (n) { n.remove(); });
      handFocusBack();
    }
    /* when a menu or popover disappears the browser parks focus on <body> and
       every shortcut silently stops working; hand it back to the grid */
    function handFocusBack() {
      if (editing) return;
      if (document.querySelector(".modal-overlay:not(.is-closing)")) return;
      var ae = document.activeElement;
      if (!ae || ae === document.body || root === ae || root.contains(ae)) {
        try { root.focus({ preventScroll: true }); } catch (err) { root.focus(); }
      }
    }

    /* ── clipboard ───────────────────────────────────────────────────────── */
    function selectionMatrix() {
      var data = selectionData();
      var matrix = data.rows.map(function (row) {
        return data.fields.map(function (f) { return D.toPlain(f, row.cells[f.id]); });
      });
      return { matrix: matrix, fields: data.fields, rows: data.rows };
    }
    function copySelection(cut) {
      var s = selectionMatrix();
      if (!s.rows.length) return 0;
      var tsv = TF.io.toTSV(s.matrix);
      TF.io.copyRich(tsv, TF.io.tsvToHtml(tsv));
      var n = s.rows.length * s.fields.length;
      if (cut) {
        /* a cut is a copy that also clears; the host hook is for extra
           side effects (logging, analytics), never for the clearing itself */
        var cleared = clearValues(s.rows, s.fields);
        if (hooks.onCutSelection) hooks.onCutSelection(s, cleared);
        store.announce("Cut " + cleared + " cell(s) to the clipboard");
        render();
        return n;
      }
      store.announce("Copied " + n + " cell(s)");
      return n;
    }
    function clearValues(rows, fields) {
      var entries = [];
      rows.forEach(function (row) {
        fields.forEach(function (f) {
          if (f.primary || D.isReadOnly(f)) return;
          entries.push({ rowId: row.id, fieldId: f.id, value: D.clone(D.descriptor(f.type).default) });
        });
      });
      if (entries.length) store.setCells(entries, "clear " + entries.length + " cell(s)");
      return entries.length;
    }
    function fillDown() {
      var s = selectionMatrix();
      if (s.rows.length < 2) return 0;
      var entries = [];
      var first = s.rows[0];
      s.fields.forEach(function (f) {
        if (D.isReadOnly(f)) return;
        var v = first.cells[f.id];
        s.rows.slice(1).forEach(function (row) { entries.push({ rowId: row.id, fieldId: f.id, value: Array.isArray(v) ? v.slice() : v }); });
      });
      if (entries.length) store.setCells(entries, "fill down");
      return entries.length;
    }
    function fillRight() {
      var s = selectionMatrix();
      if (s.fields.length < 2) return 0;
      var entries = [];
      var first = s.fields[0];
      s.rows.forEach(function (row) {
        var v = row.cells[first.id];
        s.fields.slice(1).forEach(function (f) {
          if (D.isReadOnly(f)) return;
          entries.push({ rowId: row.id, fieldId: f.id, value: Array.isArray(v) ? v.slice() : v });
        });
      });
      if (entries.length) store.setCells(entries, "fill right");
      return entries.length;
    }
    function pasteBlockColumns(colsList, anchorCol) {
      /* which field does matrix column i land in? */
      return function (i) { return colsList[anchorCol + i]; };
    }
    function pasteMatrix(matrix, mode) {
      mode = mode || "cells";
      var colsList = cols();
      var start = range();
      var target = pasteBlockColumns(colsList, start.c0 - 1);
      var headerNames = null, byName = null;
      if (mode === "create") {
        var first = (matrix[0] || []).map(function (t) { return String(t == null ? "" : t).trim().toLowerCase(); });
        var matched = colsList.filter(function (f) { return first.indexOf(String(f.name).toLowerCase()) !== -1; });
        if (matched.length >= 2 && matrix.length > 1) {
          headerNames = matrix[0];
          byName = function (i) {
            var want = String(headerNames[i] == null ? "" : headerNames[i]).trim().toLowerCase();
            return colsList.filter(function (f) { return String(f.name).toLowerCase() === want; })[0] || null;
          };
        }
      }
      var body = (mode === "append" || byName) ? (byName ? matrix.slice(1) : matrix) : matrix;
      var entries = [];
      var skipped = 0;
      if (mode === "append" || byName) {
        /* real append: bring new rows into existence first, then write into them */
        store.insertRows(body.length, store.table().rows.length);
        var all = store.table().rows;
        var created = all.slice(all.length - body.length);
        created.forEach(function (row, ri) {
          body[ri].forEach(function (text, ci) {
            var field = byName ? byName(ci) : target(ci);
            if (!field) { skipped++; return; }
            if (D.isReadOnly(field)) return;
            entries.push({ rowId: row.id, fieldId: field.id, value: D.fromPlain(field, text) });
          });
        });
      } else {
        /* fill from the anchor cell, growing the table when the block is taller */
        var startRowIdx = start.r0;
        var needed = startRowIdx + matrix.length - rowItems().length;
        if (needed > 0) { store.insertRows(needed, store.table().rows.length); render(); }
        var rowIdxList = visibleRowIndices();
        matrix.forEach(function (cells, ri) {
          var itemIdx = rowIdxList[startRowIdx + ri];
          var it = itemIdx == null ? null : items[itemIdx];
          if (!it) return;
          cells.forEach(function (text, ci) {
            var field = target(ci);
            if (!field) { skipped++; return; }
            if (D.isReadOnly(field)) return;
            entries.push({ rowId: it.row.id, fieldId: field.id, value: D.fromPlain(field, text) });
          });
        });
      }
      if (entries.length) {
        var label = mode === "append" ? "append " + body.length + " row(s)"
          : byName ? "create " + body.length + " row(s) from the block"
          : "paste " + entries.length + " cell(s)";
        store.setCells(entries, label);
      }
      store.announce((mode === "append" ? "Appended " + body.length + " row(s)"
        : byName ? "Created " + body.length + " row(s) — " + entries.length + " cell(s) mapped by header"
        : "Pasted " + entries.length + " cell(s)") + (skipped ? " · " + skipped + " outside the table was ignored" : ""));
      render();
      return entries.length;
    }
    /* paste straight from the system clipboard (used by the context menu) */
    function pasteMatrixFromClipboard() {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        store.announce("Clipboard read needs a permission prompt — use Ctrl+V instead");
        return 0;
      }
      navigator.clipboard.readText().then(function (text) {
        if (!text) { store.announce("Clipboard is empty"); return; }
        var matrix = text.indexOf("\t") !== -1 ? TF.io.parseTSV(text) : TF.io.parseCSV(text);
        pasteMatrix(matrix);
      }).catch(function () {
        store.announce("Clipboard read was blocked — use Ctrl+V instead");
      });
      return 0;
    }

    /* bulk column edit: type once, applies down the selection from the bottom */
    function editWholeColumnUntilChange(seed) {
      var s = selectionMatrix();
      if (!s.fields.length) return 0;
      var field = s.fields[0];
      if (D.isReadOnly(field)) return 0;
      var entries = s.rows.map(function (row) { return { rowId: row.id, fieldId: field.id, value: D.fromPlain(field, seed) }; });
      store.setCells(entries, "bulk edit " + field.name);
      render();
      return entries.length;
    }

    /* ── pointer: select, drag, resize, reorder, long-press ──────────────── */
    function startRangeDrag(r, c, ev) { /* mouse drag to extend */ }

    root.addEventListener("mousedown", function (e) {
      var resizeHandle = e.target.closest("[data-resize]");
      if (resizeHandle) { beginColumnResize(resizeHandle.dataset.resize, e); return; }
      var handle = e.target.closest("[data-row-drag]");
      if (handle) { beginRowDrag(handle.dataset.rowDrag, e); return; }
      var groupBar = e.target.closest("[data-group-key]");
      if (groupBar) { store.toggleGroupCollapse(groupBar.dataset.groupKey); return; }
      var header = e.target.closest(".hcell");
      if (header && header.dataset.fieldId) {
        if (e.button === 0 && !e.shiftKey) { beginColumnDrag(header.dataset.fieldId, e); return; }
      }
      var cell = e.target.closest(".cell");
      if (cell) {
        if (e.target.classList.contains("checkbox")) return;
        var r = Number(cell.dataset.r), c = Number(cell.dataset.c);
        if (store.get().ui.touch && store.get().ui.selectMode) { startRangeDrag(r, c, e); return; }
        var isRepeat = lastPress.r === r && lastPress.c === c && (Date.now() - lastPress.t) < 400;
        lastPress = { r: r, c: c, t: Date.now() };
        /* an open editor commits when you click somewhere else, instead of being
           thrown away with the cell that held it */
        if (editing && (editing.r !== r || editing.c !== c)) {
          var live = root.querySelector(".cell-editor");
          var liveField = editing && store.fieldById(editing.fieldId);
          var liveRow = editing && store.rowById(editing.rowId);
          if (live && liveField && liveRow) commitFromEditor(liveField, liveRow, live.value);
        }
        /* the browser's default mousedown action moves focus to the nearest
           focusable ancestor, which blurred a just-opened editor before anyone
           could type in it: the editor existed for one frame and vanished */
        e.preventDefault();
        if (isRepeat) { beginEdit(r, c); return; }
        if (e.shiftKey || e.metaKey || e.ctrlKey) setSel(r, c, true);
        else if (!(sel.anchor.r === r && sel.anchor.c === c && sel.focus.r === r && sel.focus.c === c)) setSel(r, c, false);
        else { renderStatus(); }
        closePopovers();
        closeMenus();
        root.focus();
        draggingSelection = { active: true, r: r, c: c };
        return;
      }
      closePopovers();
      closeMenus();
    });

    var draggingSelection = null;
    var dragPoint = null, autoScrollRaf = null;

    function extendSelectionToPoint(x, y) {
      var node = document.elementFromPoint(x, y);
      var cell = node && node.closest ? node.closest(".cell") : null;
      if (!cell) return;
      var r = Number(cell.dataset.r), c = Number(cell.dataset.c);
      if (r === sel.focus.r && c === sel.focus.c) return;
      setSel(r, c, true);
    }
    /* a second press on the same cell inside 400 ms is a double-click: the first
       press re-renders the lane, which destroys the node the browser would have
       used to raise its own dblclick event */
    var lastPress = { r: -1, c: -1, t: 0 };
    /* dragging past the edge scrolls instead of dying at the boundary */
    function pumpAutoScroll() {
      autoScrollRaf = null;
      if (!draggingSelection || !draggingSelection.active || !dragPoint) return;
      var a = E.area.getBoundingClientRect();
      var edge = 30;
      var dx = 0, dy = 0;
      var leftEdge = a.left + leadW() + edge;
      if (dragPoint.x < leftEdge) dx = -Math.min(30, leftEdge - dragPoint.x);
      else if (dragPoint.x > a.right - edge) dx = Math.min(30, dragPoint.x - (a.right - edge));
      if (dragPoint.y < a.top + HEADER_H + edge) dy = -Math.min(26, (a.top + HEADER_H + edge) - dragPoint.y);
      else if (dragPoint.y > a.bottom - edge) dy = Math.min(26, dragPoint.y - (a.bottom - edge));
      if ((dx || dy) && clampScroll(dx, dy)) {
        extendSelectionToPoint(dragPoint.x, dragPoint.y);
        autoScrollRaf = requestAnimationFrame(pumpAutoScroll);
      }
    }
    document.addEventListener("mousemove", function (e) {
      if (!draggingSelection || !draggingSelection.active) return;
      dragPoint = { x: e.clientX, y: e.clientY };
      extendSelectionToPoint(e.clientX, e.clientY);
      if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(pumpAutoScroll);
    });
    document.addEventListener("mouseup", function () {
      draggingSelection = null;
      dragPoint = null;
      if (autoScrollRaf) { cancelAnimationFrame(autoScrollRaf); autoScrollRaf = null; }
    });

    /* long-press → context menu on touch */
    root.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch") return;
      var cell = e.target.closest(".cell");
      if (!cell) return;
      var r = Number(cell.dataset.r), c = Number(cell.dataset.c);
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        setSel(r, c, false);
        if (hooks.onCellMenu) hooks.onCellMenu(r, c, { clientX: e.clientX, clientY: e.clientY });
      }, 520);
    });
    ["pointerup", "pointercancel", "pointermove", "scroll"].forEach(function (type) {
      root.addEventListener(type, function () { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } }, { passive: true });
    });

    root.addEventListener("dblclick", function (e) {
      var cell = e.target.closest(".cell");
      if (!cell) return;
      /* the mousedown path above already opened this one */
      if (editing || document.querySelector('[data-pop="1"]')) return;
      beginEdit(Number(cell.dataset.r), Number(cell.dataset.c));
    });

    root.addEventListener("contextmenu", function (e) {
      var cell = e.target.closest(".cell");
      var header = e.target.closest(".hcell");
      var gutter = e.target.closest(".gutter");
      if (cell) {
        e.preventDefault();
        var r = Number(cell.dataset.r), c = Number(cell.dataset.c);
        if (!inRange(r, c)) setSel(r, c, false);
        if (hooks.onCellMenu) hooks.onCellMenu(r, c, e);
      } else if (header && header.dataset.fieldId) {
        e.preventDefault();
        if (hooks.onHeaderMenu) hooks.onHeaderMenu(store.fieldById(header.dataset.fieldId), e);
      } else if (gutter) {
        e.preventDefault();
        if (hooks.onGutterMenu) hooks.onGutterMenu(Number(gutter.parentElement.style.top.replace("px", "")) / rowH(), e);
      }
    });

    /* column resize */
    function beginColumnResize(fieldId, e) {
      e.preventDefault();
      e.stopPropagation();
      var field = store.fieldById(fieldId);
      if (!field) return;
      var startX = e.clientX, startW = field.width;
      var nodes = root.querySelectorAll('[data-field-id="' + fieldId + '"]');
      document.body.style.cursor = "col-resize";
      function move(ev) {
        var w = Math.max(60, startW + (ev.clientX - startX));
        Array.prototype.forEach.call(nodes, function (n) { n.style.width = w + "px"; });
      }
      function up(ev) {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        var w = Math.max(60, startW + (ev.clientX - startX));
        store.resizeColumn(fieldId, w);
        render();
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    }

    /* column reorder */
    function beginColumnDrag(fieldId, e) {
      var startX = e.clientX;
      var moved = false;
      function move(ev) {
        if (!moved && Math.abs(ev.clientX - startX) < 5) return;
        moved = true;
        var node = document.elementFromPoint(ev.clientX, ev.clientY);
        var target = node && node.closest ? node.closest(".hcell") : null;
        Array.prototype.forEach.call(root.querySelectorAll(".hcell"), function (n) { n.classList.remove("is-drop-before", "is-drop-after"); });
        if (target && target.dataset.fieldId && target.dataset.fieldId !== fieldId) {
          var rect = target.getBoundingClientRect();
          target.classList.add(ev.clientX < rect.left + rect.width / 2 ? "is-drop-before" : "is-drop-after");
        }
      }
      function up(ev) {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (!moved) { if (hooks.onHeaderClick) hooks.onHeaderClick(store.fieldById(fieldId), ev); return; }
        var node = document.elementFromPoint(ev.clientX, ev.clientY);
        var target = node && node.closest ? node.closest(".hcell") : null;
        if (target && target.dataset.fieldId && target.dataset.fieldId !== fieldId) {
          var fields = store.table().fields;
          var to = fields.map(function (f) { return f.id; }).indexOf(target.dataset.fieldId);
          var rect2 = target.getBoundingClientRect();
          if (ev.clientX > rect2.left + rect2.width / 2) to += 1;
          store.moveField(fieldId, to);
        }
        render();
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    }

    /* row reorder */
    function beginRowDrag(rowId, e) {
      e.preventDefault();
      e.stopPropagation();
      var ghost = el("div", "row-drag-ghost", "Move row");
      document.body.appendChild(ghost);
      var startY = e.clientY;
      function move(ev) {
        ghost.style.left = (ev.clientX + 12) + "px";
        ghost.style.top = (ev.clientY + 8) + "px";
        var node = document.elementFromPoint(ev.clientX, ev.clientY);
        var cell = node && node.closest ? node.closest(".cell,.gutter,.grid-row") : null;
        Array.prototype.forEach.call(root.querySelectorAll(".grid-row"), function (n) { n.style.outline = ""; });
        if (cell) {
          var rowNode = cell.closest(".grid-row");
          if (rowNode) rowNode.style.outline = "2px solid var(--tablify-accent)";
        }
      }
      function up(ev) {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        ghost.remove();
        Array.prototype.forEach.call(root.querySelectorAll(".grid-row"), function (n) { n.style.outline = ""; });
        if (Math.abs(ev.clientY - startY) < 4) { selectRowId(rowId); return; }
        var node = document.elementFromPoint(ev.clientX, ev.clientY);
        var holder = node && node.closest ? node.closest("[data-r]") : null;
        if (!holder) { render(); return; }
        var r = Number(holder.dataset.r);
        var it = rowItemAt(r);
        if (!it) { render(); return; }
        var rect = holder.getBoundingClientRect();
        var after = ev.clientY > rect.top + rect.height / 2;
        var rows = store.table().rows;
        var to = rows.map(function (x) { return x.id; }).indexOf(it.row.id) + (after ? 1 : 0);
        var from = rows.map(function (x) { return x.id; }).indexOf(rowId);
        if (to > from) to -= 1;
        store.moveRow(rowId, to);
        render();
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    }

    /* ── keyboard ────────────────────────────────────────────────────────── */
    root.addEventListener("keydown", function (e) {
      if (editing) return;
      if (document.querySelector(".modal-overlay:not(.is-closing)")) return;
      var meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "c") { copySelection(false); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === "x") { copySelection(true); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === "a") { selectAll(); e.preventDefault(); return; }
      /* Ctrl+D / Ctrl+R are browser and Electron shortcuts that can be swallowed
         before the page sees them, so Alt is the binding that always arrives */
      if (meta && e.key.toLowerCase() === "d") { var n = fillDown(); store.announce(n ? "Filled " + n + " cell(s) down" : "Select more than one row to fill down"); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === "r") { var m = fillRight(); store.announce(m ? "Filled " + m + " cell(s) right" : "Select more than one column to fill right"); e.preventDefault(); return; }
      if (e.altKey && !meta && e.key.toLowerCase() === "d") { fillDown(); e.preventDefault(); return; }
      if (e.altKey && !meta && e.key.toLowerCase() === "r") { fillRight(); e.preventDefault(); return; }
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) { store.undo(); e.preventDefault(); return; }
      if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { store.redo(); e.preventDefault(); return; }
      if (meta && e.key === "Enter") { beginEdit(sel.focus.r, sel.focus.c); e.preventDefault(); return; }

      switch (e.key) {
        case "ArrowUp": moveBy(-1, 0, e.shiftKey); e.preventDefault(); return;
        case "ArrowDown": moveBy(1, 0, e.shiftKey); e.preventDefault(); return;
        case "ArrowLeft": moveBy(0, -1, e.shiftKey); e.preventDefault(); return;
        case "ArrowRight": moveBy(0, 1, e.shiftKey); e.preventDefault(); return;
        case "PageUp": moveBy(-12, 0, e.shiftKey); e.preventDefault(); return;
        case "PageDown": moveBy(12, 0, e.shiftKey); e.preventDefault(); return;
        case "Home": jumpTo(sel.focus.r, 1, e.shiftKey); e.preventDefault(); return;
        case "End": jumpTo(sel.focus.r, cols().length, e.shiftKey); e.preventDefault(); return;
        case "Tab": moveBy(0, e.shiftKey ? -1 : 1); e.preventDefault(); return;
        case "Enter": beginEdit(sel.focus.r, sel.focus.c); e.preventDefault(); return;
        case "F2": beginEdit(sel.focus.r, sel.focus.c); e.preventDefault(); return;
        case "Backspace": case "Delete": {
          var s = selectionData();
          var n2 = clearValues(s.rows, s.fields);
          store.announce(n2 + " cell(s) cleared");
          e.preventDefault(); return;
        }
        case " ": {
          var it = rowItemAt(sel.focus.r), f2 = cols()[sel.focus.c - 1];
          if (it && f2 && f2.type === "checkbox") { store.setCell(it.row.id, f2.id, !it.row.cells[f2.id]); e.preventDefault(); }
          return;
        }
        case "Escape": closePopovers(); closeMenus(); if (hooks.onEscape) hooks.onEscape(); return;
        default: break;
      }
      if (e.key.length === 1 && !meta && !e.altKey) {
        var it3 = rowItemAt(sel.focus.r), f3 = cols()[sel.focus.c - 1];
        if (it3 && f3 && !D.isReadOnly(f3)) {
          if (f3.type === "singleSelect" || f3.type === "multiSelect") { commitTypedInput(sel.focus.r, sel.focus.c, e.key); }
          else {
            beginEditWith(sel.focus.r, sel.focus.c, e.key);
          }
          e.preventDefault();
        }
      }
    });

    function beginEditWith(r, c, seed) {
      beginEdit(r, c);
      var input = root.querySelector(".cell-editor");
      if (input) { input.value = seed; input.setSelectionRange(1, 1); }
    }

    root.addEventListener("paste", function (e) {
      if (editing) return;
      e.preventDefault();
      var cd = e.clipboardData;
      if (!cd) return;
      var files = cd.files && cd.files.length ? Array.prototype.slice.call(cd.files) : [];
      if (files.length) { if (hooks.onPasteFiles) hooks.onPasteFiles(files); return; }
      var html = cd.getData ? cd.getData("text/html") : "";
      var text = cd.getData ? cd.getData("text/plain") : "";
      var matrix = null;
      if (html) { try { matrix = TF.io.parseHTMLTable(html); } catch (err) { void err; } }
      if (!matrix && text) {
        matrix = text.indexOf("\t") !== -1 ? TF.io.parseTSV(text) : TF.io.parseCSV(text);
      }
      if (!matrix || !matrix.length) return;
      if (matrix.length > 60 && hooks.onPasteBlock) { hooks.onPasteBlock(matrix, function (mode) { pasteMatrix(matrix, mode); }); return; }
      pasteMatrix(matrix);
    });

    root.addEventListener("copy", function (e) {
      if (editing) return;
      e.preventDefault();
      copySelection(false);
    });
    root.addEventListener("cut", function (e) {
      if (editing) return;
      e.preventDefault();
      copySelection(true);
    });

    /* ── menus (delegated to the app, which owns the actions) ────────────── */
    function closeMenus() {
      Array.prototype.forEach.call(document.querySelectorAll(".menu"), function (n) { n.remove(); });
      handFocusBack();
    }

    /* ── public API ──────────────────────────────────────────────────────── */
    var api = {
      root: root, els: E,
      render: render,
      rerenderBody: function () { renderBody(); },
      onSave: onSave,
      getSelection: selectionData,
      selectionMatrix: selectionMatrix,
      setSelection: setSel,
      focusCell: focusCellAt,
      scrollToCell: scrollToCell,
      selectAll: selectAll,
      beginEdit: beginEdit,
      copySelection: copySelection,
      pasteMatrix: pasteMatrix,
      pasteMatrixFromClipboard: pasteMatrixFromClipboard,
      clearValues: clearValues,
      fillDown: fillDown,
      fillRight: fillRight,
      editWholeColumn: editWholeColumnUntilChange,
      toggleChecked: toggleChecked,
      setChecked: setChecked,
      getChecked: getChecked,
      closePopovers: closePopovers,
      closeMenus: closeMenus,
      rowItems: rowItems,
      items: function () { return items; },
      isNarrow: isNarrow,
      pinned: pinned,
      gutterInline: gutterInline,
      laneWidth: laneW,
      rowHeight: rowH,
      afterRender: function () { syncTransforms(); },
      scrollBy: clampScroll,
      scrollIntoView: scrollToCell,
      updateScrollbars: updateThumbs,
      layoutChrome: layoutChrome,
    };
    return api;
  }

  return { create: create, ROW_H: ROW_H };
})();
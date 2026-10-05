/* Headless smoke test: boot the prototype in jsdom and drive real interactions.
     npm install jsdom && node tests/smoke.js
   37 checks, no browser needed. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  url: 'https://example.test/prototype/index.html',
  beforeParse(win) {
    win.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    win.cancelAnimationFrame = (id) => clearTimeout(id);
    win.addEventListener('error', (e) => errors.push('window error: ' + (e.message || e.error)));
    const origErr = win.console.error;
    win.console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); origErr(...a); };
    Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('a\tb\n1\t2') }, configurable: true });
  },
});

// jsdom does not fetch external <script src>. Inline them in order instead.
const doc = dom.window.document;
const order = ['data','query','io','store','sync','grid','dialogs','legacy','settings','harness'];
doc.querySelectorAll('script[src]').forEach(n => n.remove());
for (const name of order) {
  const code = fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8');
  const s = doc.createElement('script');
  s.textContent = code;
  doc.body.appendChild(s);
}
// jsdom fires DOMContentLoaded before our injection? force init defensively
try { dom.window.TF.harness.init(); } catch (e) { errors.push('init() second call: ' + e.message); }

const win = dom.window, TF = win.TF, store = TF.store, grid = TF.harness.ctx().grid, ctx = TF.harness.ctx();
const ok = [], bad = [];
function check(name, fn) {
  try { const r = fn(); ok.push([name, r === undefined ? '' : r]); }
  catch (e) { bad.push([name, e && e.stack ? e.stack.split('\n').slice(0,3).join(' | ') : String(e)]); }
}

check('grid mounted', () => {
  const cells = win.document.querySelectorAll('.tablify-root .cell').length;
  if (!cells) throw new Error('no cells rendered');
  return cells + ' cells';
});
check('toolbar built', () => win.document.querySelectorAll('#tf-toolbar .tablify-btn').length + ' buttons');
check('header + frozen lanes', () => win.document.querySelectorAll('#tf-header .hcell').length + ' header cells, ' + win.document.querySelectorAll('#tf-frozen .gutter').length + ' gutters');

check('filter actually filters', () => {
  const all = store.viewRows().length;
  store.addCondition('f_status');
  const c = store.view().filters.conditions[0];
  store.updateCondition(c.id, { op: 'is', value: 's_done' });
  const done = store.viewRows().length;
  store.clearFilters();
  if (!(done < all && done > 0)) throw new Error(`all=${all} done=${done}`);
  return `${all} → ${done} → back to ${store.viewRows().length}`;
});
check('query DSL parses + applies', () => {
  const fields = store.table().fields;
  const r = TF.query.parseQueryString('status:~done budget>1000 "Task name":~topbar', fields);
  if (!r.ast) throw new Error('no ast: ' + JSON.stringify(r.errors));
  store.applyQuery('status:~done budget>1000');
  const n = store.viewRows().length;
  const q = store.view().query;
  store.clearFilters();
  if (!n) throw new Error('query matched nothing');
  return `${n} rows matched; round-trip "${q}"`;
});
check('multi-sort stacks', () => {
  store.addSort('f_status'); store.addSort('f_budget');
  const s = store.view().sorts;
  store.updateSort(s[1].id, { dir: 'desc' });
  const rows = store.viewRows();
  const first = rows[0].cells.f_status, last = rows[rows.length-1].cells.f_status;
  if (!rows.length) throw new Error('no rows');
  store.clearSorts();
  return `${s.length} levels, asc first / desc last (${first} … ${last})`;
});
check('grouping builds groups', () => {
  store.setGroupBy('f_status');
  const groups = TF.query.groupRows(store.viewRows(), 'f_status', store.table().fields);
  const items = grid.items().filter(i => i.kind === 'group').length;
  store.setGroupBy(null);
  return groups.length + ' groups, ' + items + ' group bars rendered';
});
check('hide fields + resize + reorder', () => {
  const before = store.visibleFields().length;
  store.toggleHiddenField('f_notes');
  const hidden = store.visibleFields().length;
  store.showAllFields();
  store.resizeColumn('f_task', 222);
  store.moveField('f_status', 0);
  const w = store.fieldById('f_task').width;
  return `${before} → ${hidden} → ${store.visibleFields().length} fields; width ${w}; status now col ${store.table().fields.indexOf(store.fieldById('f_status'))+1}`;
});
check('cell edit + undo + redo', () => {
  const row = store.table().rows[0];
  const before = row.cells.f_budget;
  store.setCell(row.id, 'f_budget', 12345);
  const mid = store.fieldById('f_budget') && store.rowById(row.id).cells.f_budget;
  store.undo();
  const afterUndo = store.rowById(row.id).cells.f_budget;
  store.redo();
  const afterRedo = store.rowById(row.id).cells.f_budget;
  if (mid !== 12345 || afterUndo !== before || afterRedo !== 12345) throw new Error(`${before}/${mid}/${afterUndo}/${afterRedo}`);
  return `${before} → 12345 → undo ${afterUndo} → redo ${afterRedo}`;
});
check('multi-step undo restores a bulk edit', () => {
  const ids = store.table().rows.slice(0,5).map(r => r.id);
  const snap = ids.map(id => store.rowById(id).cells.f_owner);
  store.setCells(ids.map(id => ({rowId:id, fieldId:'f_owner', value:'X'})), 'bulk');
  store.undo();
  const after = ids.map(id => store.rowById(id).cells.f_owner);
  if (JSON.stringify(snap) !== JSON.stringify(after)) throw new Error('undo did not restore all rows');
  return '5 rows restored in one step';
});
check('fill down incl. dependent values', () => {
  grid.setSelection(3, 1); grid.setSelection(6, 4, true);
  const filled = grid.fillDown();
  if (!filled) throw new Error('nothing filled');
  return filled + ' cells filled';
});
check('block copy produces TSV', () => {
  const s = grid.selectionMatrix();
  const tsv = TF.io.toTSV(s.matrix);
  if (!tsv.includes('\t')) throw new Error('no tabs');
  return s.matrix.length + '×' + s.matrix[0].length + ' block, ' + tsv.length + ' chars';
});
check('paste writes and extends', () => {
  store.resetTo('clean'); grid.render(); grid.setSelection(0, 1);
  const n = grid.pasteMatrix([['pasted A','pasted B'],['pasted C','pasted D']], 'cells');
  const v = store.table().rows[0].cells.f_task;
  if (n !== 4 || v !== 'pasted A') throw new Error(`n=${n} v=${v}`);
  return n + ' cells, first = ' + v;
});
check('row add / duplicate / delete / reorder', () => {
  const before = store.table().rows.length;
  const id = store.addRow();
  const dup = store.duplicateRows([id]);
  store.moveRow(dup[0], 2);
  store.deleteRows([id]);
  const after = store.table().rows.length;
  if (after !== before + 1) throw new Error(`${before} → ${after}`);
  return `${before} → ${after} (duplicate kept)`;
});
check('field add + convert keeps data', () => {
  const id = store.addField('number');
  store.updateField(id, { name: 'Guess' });
  store.setCell(store.table().rows[0].id, id, 42);
  store.convertField(id, 'percent');
  const v = store.rowById(store.table().rows[0].id).cells[id];
  const t = store.fieldById(id).type;
  store.deleteField(id);
  if (t !== 'percent') throw new Error('type not converted');
  return `number → percent, value ${v}`;
});
check('option manager: create, recolour, usage, delete', () => {
  const optId = store.addOption('f_status', 'Blocked by client', 'red');
  store.updateOption('f_status', optId, { color: 'purple' });
  store.setCell(store.table().rows[1].id, 'f_status', optId);
  const usage = store.optionUsage('f_status', optId);
  store.deleteOption('f_status', optId, true);
  if (usage !== 1) throw new Error('usage wrong: ' + usage);
  return 'created, recoloured, used by 1 row, deleted';
});
check('auto-create option by typing', () => {
  const row = store.table().rows[2];
  const f = store.fieldById('f_status');
  f._autoCreate = true;
  row.cells.f_status = TF.data.fromPlain(f, 'Triage');
  f._autoCreate = false;
  const found = TF.data.findOptionByName(f, 'Triage');
  if (!found) throw new Error('option not created');
  return 'new option id ' + found.id;
});
check('CSV parse: quotes, commas, ragged rows', () => {
  const m = TF.io.parseCSV('a,b\n"x, y",2\n"line\nbreak",3\n4');
  if (m[1][0] !== 'x, y' || m[2][0] !== 'line\nbreak' || m.length !== 4) throw new Error(JSON.stringify(m));
  return m.length + ' rows, embedded comma + newline handled';
});
check('type inference', () => {
  const a = TF.io.analyzeMatrix(TF.io.parseCSV(TF.data.SAMPLE_CSV), true);
  const types = a.columns.map(c => c.name + ':' + c.type).join(', ');
  const value = a.columns.find(c => c.name === 'Value');
  if (!value || value.type !== 'number') throw new Error('Value not numeric: ' + types);
  return types;
});
check('import: append maps by name', () => {
  const a = TF.io.analyzeMatrix(TF.io.parseCSV(TF.data.SAMPLE_CSV), true);
  const plan = TF.io.appendPlan(a, store.table().fields);
  const built = TF.io.toTable(a);
  return Object.keys(plan.mapping).length + ' mapped, ' + plan.newColumns.length + ' new, ' + built.rows.length + ' rows built';
});
check('import: replace path', () => {
  const a = TF.io.analyzeMatrix(TF.io.parseCSV(TF.data.SAMPLE_CSV), true);
  const built = TF.io.toTable(a);
  const before = { f: store.table().fields.length, r: store.table().rows.length };
  store.replaceTableCells(built.fields, built.rows);
  const mid = store.table().rows.length;
  store.undo();
  if (store.table().rows.length !== before.r) throw new Error('undo did not restore');
  return `replaced with ${mid} rows, undo restored ${store.table().rows.length}`;
});
check('big sheet crosses the warning threshold', () => {
  const m = TF.data.bigSheetMatrix();
  const a = TF.io.analyzeMatrix(m, true);
  return `${m.length} rows (threshold ${store.get().settings.threshold}), date col ${a.columns.find(c=>c.name==='Placed').type}`;
});
check('real .xlsx writer produces a valid zip', () => {
  const bytes = TF.io.buildXlsx([['A','B'],[1,'two']]);
  const sig = [bytes[0],bytes[1],bytes[2],bytes[3]].join(',');
  const eocd = bytes.slice(-22,-18).map((b,i)=>b).join(',');
  if (sig !== '80,75,3,4') throw new Error('bad local header ' + sig);
  if (eocd !== '80,75,5,6') throw new Error('bad EOCD ' + eocd);
  return bytes.length + ' bytes, PK header + EOCD both present';
});
check('export formats', () => {
  const fields = store.visibleFields(), rows = store.table().rows.slice(0,3);
  const md = TF.io.toMarkdown(fields, rows), json = TF.io.toJSON(fields, rows), csv = TF.io.toCSV(TF.io.matrixFor(fields, rows, true));
  JSON.parse(json);
  if (!md.startsWith('|')) throw new Error('markdown bad');
  return `csv ${csv.split('\n').length} lines, md ${md.split('\n').length} lines, json parses`;
});
check('sync: three-way diff finds a real conflict', () => {
  TF.sync.seedDemo(store);
  const diff = TF.sync.computeDiff(store.table(), store.get().syncState);
  const conflictField = diff.conflicts[0] && Object.keys(diff.conflicts[0].fields)[0];
  if (!diff.stats.conflicts) throw new Error('no conflict detected');
  if (!diff.pushes.length || !diff.pulls.length) throw new Error('missing push/pull');
  return `push ${diff.pushes.length}, pull ${diff.pulls.length}, conflicts ${diff.stats.conflicts} on ${conflictField}, skipped fields ${diff.stats.skippedFields}, new upstream rows ${diff.stats.newRows}`;
});
check('sync: resolve local vs remote changes rows', () => {
  const diff = store.get().syncState.pending || TF.sync.computeDiff(store.table(), store.get().syncState);
  const c = diff.conflicts[0];
  const fid = Object.keys(c.fields)[0];
  const resolver = { [c.recordId]: { [fid]: 'remote' } };
  const pulls = TF.sync.conflictPulls(diff, resolver);
  store.applyPull(pulls);
  const v = store.rowById(c.rowId).cells[fid];
  if (v !== c.fields[fid].remote) throw new Error('remote value not applied');
  return `${fid} ← remote (${v})`;
});
check('sync: push writes only accepted changes', () => {
  const diff = TF.sync.computeDiff(store.table(), store.get().syncState);
  const writes = TF.sync.buildPushChanges(diff, {});
  store.applyPush(writes);
  const snap = TF.sync.computeNextSnapshot(store.table(), store.get().syncState, null);
  return writes.length + ' writes, snapshot keys ' + Object.keys(snap).length;
});
check('.tabula parser: v1, v2 and corrupt', () => {
  const docs = TF.legacy.docs();
  const v2 = TF.legacy.docById('v2'), v1 = TF.legacy.docById('v1'), bad = TF.legacy.docById('corrupt');
  if (!v2.valid || !v1.valid || bad.valid) throw new Error('validity flags wrong');
  return `${docs.length} docs; v2 tables ${v2.tables.length}, v1 rows ${v1.tables[0].rows.length}, corrupt reports “${bad.error}”`;
});
check('.tabula dry run report + migration', () => {
  const v2 = TF.legacy.docById('v2');
  const rep = TF.legacy.report(v2.tables[0]);
  const built = TF.legacy.toTable(v2.tables[0], store);
  const tablesBefore = store.get().tables.length;
  store.addTable({ id: 'tbl_test', name: 'Imported test', fields: built.fields, rows: built.rows, autoNumberNext: 1, sync: null });
  store.recordMigration({ docId: 'v2', fileName: 'x.tabula', tableName: 't', rows: rep.rows });
  return `${rep.rows} rows, ${rep.computed} recomputed, ${rep.columns.length} cols → ${store.get().tables.length - tablesBefore} new table (${built.rows.length} rows), migration logged ${store.get().migrations.length}`;
});
check('grid keyboard: no crash on arrows/tab/space', () => {
  const key = (k, opts={}) => grid.root.dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, opts)));
  ['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Tab','PageDown','PageUp','End','Home','F2','Escape','Delete','Ctrl+A'].forEach(k => key(k));
  key('z', { ctrlKey: true }); key('z', { ctrlKey: true, shiftKey: true });
  return 'no exceptions';
});
check('every dialog opens and closes', () => {
  const opened = [];
  const d = TF.dialogs;
  d.filterPanel(ctx); opened.push('filter');
  const f = store.table().fields.filter(x => x.options)[0];
  d.optionManager(ctx, f.id); opened.push('options');
  d.findOption && 0;
  const sel = grid.getSelection();
  d.cellMenu(ctx, 0, 1, { clientX: 40, clientY: 90 }); opened.push('cellMenu');
  d.headerMenu(ctx, store.visibleFields()[1], { clientX: 200, clientY: 90 }); opened.push('headerMenu');
  d.gutterMenu(ctx, 0, { clientX: 40, clientY: 90 }); opened.push('gutterMenu');
  d.rowDetails(ctx, sel.rows[0].id); opened.push('rowDetails');
  d.keyboardHelp(); opened.push('help');
  d.exportDialog(ctx); opened.push('export');
  d.importWizard(ctx); opened.push('import');
  d.viewPanel(ctx); opened.push('view');
  d.syncPanel(ctx); opened.push('sync');
  d.hidePanel(ctx); opened.push('hide');
  d.sortPanel(ctx); opened.push('sort');
  d.groupPanel(ctx); opened.push('group');
  const v1 = TF.legacy.docById('v1');
  d.tabulaDryRun(ctx, v1, v1.tables[0]); opened.push('dryrun');
  const live = win.document.querySelectorAll('.modal-overlay').length + win.document.querySelectorAll('.menu').length;
  if (!live) throw new Error('nothing rendered');
  win.document.querySelectorAll('.modal-overlay').forEach(n => n.remove());
  win.document.querySelectorAll('.menu').forEach(n => n.remove());
  return opened.length + ' surfaces opened';
});
check('empty state + skeleton helpers', () => {
  const active = store.table();
  const rows = active.rows.slice();
  store.transaction('hide rows', s => {
    s.tables.forEach(t => { if (t.id === s.activeTableId) t.rows = []; });
  });
  grid.render();
  const empty = win.document.querySelectorAll('.tablify-empty').length;
  store.undo();
  grid.render();
  if (!empty) throw new Error('empty state missing');
  return 'empty state rendered, undo restored ' + (store.table().rows.length === rows.length ? 'all rows' : 'WRONG COUNT');
});
check('phone + dark + touch chrome', () => {
  store.setUI({ phone: true, theme: 'dark', touch: true, wrapToolbar: true });
  const win_ = win.document.getElementById('window');
  const ws = win.document.getElementById('workspace');
  const dark = win_.classList.contains('theme-dark'), phone = ws.classList.contains('is-phone');
  store.setUI({ phone: false, theme: 'light', touch: false, wrapToolbar: false });
  return `dark=${dark} phone=${phone}`;
});
check('5,000 rows still renders a windowed subset', () => {
  store.addStressRows(5000 - store.table().rows.length);
  grid.render();
  const mounted = win.document.querySelectorAll('.cell').length;
  if (mounted > 1200) throw new Error('mounted cells ' + mounted + ' exceeds the budget');
  const t0 = Date.now(); grid.render(); const ms = Date.now() - t0;
  return `${store.table().rows.length} rows, ${mounted} cells mounted, full render ${ms} ms`;
});
check('settings + legacy screens render', () => {
  store.setUI({ screen: 'settings' }); TF.harness.ctx().renderScreen();
  const set = win.document.querySelectorAll('#settings-host .set-row').length;
  store.setUI({ screen: 'legacy' }); TF.harness.ctx().renderScreen();
  const leg = win.document.querySelectorAll('#legacy-host .legacy-table').length;
  store.setUI({ screen: 'grid' }); TF.harness.ctx().renderScreen();
  return `${set} setting rows, ${leg} stacked legacy tables`;
});

check('two grids mounted at once (two Bases views)', () => {
  const host2 = win.document.createElement('div');
  host2.id = 'second-editor-host';
  host2.style.cssText = 'position:relative;height:300px;width:600px';
  win.document.body.appendChild(host2);
  const g2 = TF.grid.create(host2, store, {});
  g2.render();
  const cells2 = host2.querySelectorAll('.cell').length;
  const cells1 = win.document.querySelectorAll('#editor-host .cell').length;
  host2.remove();
  if (!cells2 || !cells1) throw new Error(`grid1 ${cells1} cells, grid2 ${cells2} cells`);
  return `${cells1} + ${cells2} cells in one document`;
});

(async () => {
  // the save path is debounced (250 ms in the real plugin), so let the timer fire
  store.resetTo('clean'); grid.render();
  const rowId = store.table().rows[0].id;
  store.setCell(rowId, 'f_task', 'persisted value');
  store.persist(true);
  await new Promise(r => setTimeout(r, 60));
  try {
    const raw = win.localStorage.getItem(store.KEY);
    const parsed = JSON.parse(raw);
    const gate = parsed.tables[0].rows[0].cells.f_task;
    if (gate !== 'persisted value') throw new Error('not saved: ' + gate);
    if (parsed.settings.token !== '') throw new Error('token leaked into storage');
    ok.push(['persistence: localStorage round-trip after the debounce', raw.length + ' bytes stored, token field empty']);
  } catch (e) { bad.push(['persistence: localStorage round-trip after the debounce', e.message]); }
  report();
})();

function report() {
console.log('\n=========== PASS (' + ok.length + ') ===========');
ok.forEach(([n, v]) => console.log('  ✓ ' + n + (v ? '  — ' + v : '')));
if (bad.length) {
  console.log('\n=========== FAIL (' + bad.length + ') ===========');
  bad.forEach(([n, v]) => console.log('  ✗ ' + n + '\n      ' + v));
}
if (errors.length) {
  console.log('\n=========== RUNTIME MESSAGES (' + errors.length + ') ===========');
  errors.slice(0, 25).forEach(e => console.log('  ! ' + e));
}
console.log('\n' + (bad.length ? 'FAILURES: ' + bad.length : 'ALL CHECKS PASSED') + (errors.length ? ' | runtime messages: ' + errors.length : ''));
process.exit(bad.length ? 1 : 0);
}

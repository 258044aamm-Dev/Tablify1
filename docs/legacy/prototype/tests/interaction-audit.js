/* Tablify prototype — interaction audit.
   Every check starts from a clean demo state, so a failure can only mean the
   interaction itself is broken. Read the output as: what broke, in plain words. */
/* Requires a Chromium + a static server for the prototype:
     npm install playwright-core && npx playwright install chromium
     python3 -m http.server 8090 --bind 0.0.0.0      # from prototype/
     node tests/interaction-audit.js
   Override the target with TABLIFY_URL. */
const { chromium } = require('playwright-core');
const URL = process.env.TABLIFY_URL || 'http://127.0.0.1:8090/index.html';
const R = [];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  let errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const st = (fn, arg) => page.evaluate(fn, arg);
  const closeAll = () => page.evaluate(() => document.querySelectorAll('.modal-overlay,.menu,.pop').forEach(n => n.remove()));
  const labels = () => page.$$eval('.menu .menu-item', ns => ns.map(n => n.textContent.replace(/[✓▸]/g, '').trim()));
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const cell = (r, c) => page.locator(`.tablify-rows .cell[data-r="${r}"][data-c="${c}"]`);
  const fcell = (fid, n) => page.locator(`.tablify-rows .cell[data-field-id="${fid}"]`).nth(n || 0);
  const hcell = (fid) => page.locator(`.tablify-header .hcell[data-field-id="${fid}"]`);
  const openMenuOn = async (loc, btn) => { await loc.click(btn ? { button: btn } : undefined); await page.waitForSelector('.menu .menu-item', { timeout: 3000 }); };
  const surface = async (label) => {
    await page.locator('.harness-btn', { hasText: 'Every surface' }).click();
    await page.waitForSelector('.menu .menu-item', { timeout: 3000 });
    const t = await labels();
    await page.locator('.menu .menu-item', { hasText: label }).first().click();
    return t;
  };
  const store = (expr) => page.evaluate(`(() => { const s = window.TF.store; return ${expr}; })()`);

  async function fresh() {
    errors = [];
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(URL);
    await page.waitForSelector('.tablify-root .cell');
    await page.waitForTimeout(60);
  }
  async function check(name, fn) {
    try { await fresh(); const d = await fn(); R.push([1, name, d || '']); }
    catch (e) {
      const msg = (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 190);
      R.push([0, name, msg + (errors.length ? '  ⚠ ' + errors[0] : '')]);
    }
  }

  /* ══════════════════ menus ══════════════════ */
  await check('menu: table switcher creates and switches tables', async () => {
    await openMenuOn(page.locator('.tablify-toolbar .tablify-btn').first());
    const items = await labels();
    await page.locator('.menu .menu-item', { hasText: 'New table' }).click();
    await page.waitForTimeout(250);
    const name = await store('s.table().name');
    const empty = await page.locator('.tablify-empty-title').innerText();
    const fields = await store('s.table().fields.map(f => f.name + ":" + f.type)');
    await page.locator('.tablify-empty .tablify-btn', { hasText: 'New row' }).click();
    await page.waitForTimeout(300);
    const cells = await page.locator('.cell').count();
    ok(/Untitled/.test(name), 'active table = ' + name);
    ok(/empty/i.test(empty) && cells > 0, 'empty state “' + empty + '”, cells after adding a row: ' + cells);
    return items.length + ' items → “' + name + '” (' + JSON.stringify(fields) + ') → empty state → “+ New row” → ' + cells + ' cells';
  });
  await check('menu: header sort / hide / show all', async () => {
    await openMenuOn(hcell('f_budget'));
    const items = await labels();
    await page.locator('.menu .menu-item', { hasText: 'Sort descending' }).click();
    await page.waitForTimeout(250);
    const asc = await store('s.viewRows().map(r => r.cells.f_budget)');
    await openMenuOn(hcell('f_notes'));
    await page.locator('.menu .menu-item', { hasText: 'Hide field' }).click();
    await page.waitForTimeout(250);
    const hidden = await store('s.view().hiddenFieldIds.length');
    await openMenuOn(hcell('f_budget'));
    await page.locator('.menu .menu-item', { hasText: 'Show all fields' }).click();
    await page.waitForTimeout(250);
    const shown = await store('s.view().hiddenFieldIds.length');
    ok(hidden === 1 && shown === 0, 'hidden=' + hidden + ' shown=' + shown);
    ok(asc.every((v, i) => i === 0 || asc[i - 1] >= v), 'sort not descending: ' + asc.slice(0, 4));
    return items.length + ' items; descending top=' + asc[0] + '; hide → ' + hidden + ' → show all → ' + shown;
  });
  await check('menu: cell menu insert / duplicate / delete + undo', async () => {
    const before = await store('s.table().rows.length');
    await openMenuOn(cell(2, 2), 'right');
    await page.locator('.menu .menu-item', { hasText: 'Insert row below' }).click();
    await page.waitForTimeout(220);
    const mid = await store('s.table().rows.length');
    await openMenuOn(cell(2, 2), 'right');
    await page.locator('.menu .menu-item', { hasText: 'Duplicate row' }).click();
    await page.waitForTimeout(220);
    const dup = await store('s.table().rows.length');
    await openMenuOn(cell(2, 2), 'right');
    await page.locator('.menu .menu-item', { hasText: 'Delete row' }).first().click();
    await page.waitForTimeout(250);
    const after = await store('s.table().rows.length');
    ok(mid === before + 1 && dup === before + 2 && after === before + 1, [before, mid, dup, after].join('/'));
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    const undone = await store('s.table().rows.length');
    ok(undone === before, 'undo left ' + undone + ' rows');
    return before + ' → insert ' + mid + ' → duplicate ' + dup + ' → delete ' + after + ' → undo ×3 → ' + undone;
  });
  await check('menu: row details shows note front matter', async () => {
    await openMenuOn(cell(1, 2), 'right');
    await page.locator('.menu .menu-item', { hasText: 'Row details' }).click();
    await page.waitForSelector('.modal-overlay .dlg-mono', { timeout: 3000 });
    const yaml = await page.locator('.modal-overlay .dlg-mono').first().innerText();
    ok(yaml.startsWith('---'), 'not front matter: ' + yaml.slice(0, 30));
    return (yaml.split('\n').length - 2) + ' front-matter keys from a real row';
  });
  await check('menu: gutter menu copies the row as Markdown', async () => {
    await openMenuOn(page.locator('.tablify-frozen .gutter').first(), 'right');
    const items = await labels();
    await page.locator('.menu .menu-item', { hasText: 'Markdown' }).click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    ok(clip.includes('|'), 'clipboard: ' + clip.slice(0, 40));
    return items.length + ' items; clipboard ' + clip.split('\n').length + ' lines of Markdown';
  });
  await check('menu: ⋯ menu reaches every row height', async () => {
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: '⋯' }).click();
    await page.waitForSelector('.menu .menu-item', { timeout: 3000 });
    const items = await labels();
    const seen = {};
    for (const pair of [['Short (30)', 30], ['Tall (64)', 64], ['Medium (40)', 40]]) {
      await page.locator('.menu .menu-item', { hasText: pair[0] }).click();
      await page.waitForTimeout(250);
      seen[pair[0]] = await page.locator('.tablify-rows .grid-row').first().evaluate(n => Math.round(n.getBoundingClientRect().height));
      ok(seen[pair[0]] === pair[1], pair[0] + ' → ' + seen[pair[0]] + 'px');
      if (pair[0] !== 'Medium (40)') { await page.locator('.tablify-toolbar .tablify-btn', { hasText: '⋯' }).click(); await page.waitForSelector('.menu .menu-item'); }
    }
    return items.length + ' entries; row heights ' + JSON.stringify(seen);
  });
  await check('menu: every-surface dispatcher opens all 18 surfaces', async () => {
    const wanted = ['Filter builder + query string', 'Sort (multi-level)', 'Group by', 'Hide fields', 'View settings + presets',
      'Add field', 'Field config + type conversion', 'Option manager', 'Row details (note preview)', 'Cell context menu',
      'Column header menu', 'Row / gutter menu', 'Import wizard (CSV · XLSX · clipboard · .tabula)', 'Paste-block dialog',
      'Export dialog', 'Sync panel (pull · push · review)', '.tabula dry run', 'Keyboard & touch help'];
    let entries = 0;
    for (const label of wanted) {
      await closeAll();
      entries = (await surface(label)).length;
      const opened = await page.locator('.modal-overlay, .menu').first().count();
      ok(opened, 'nothing opened for ' + label);
    }
    return wanted.length + ' surfaces opened, menu lists ' + entries + ' entries';
  });
  await check('menu: keyboard help documents the real bindings', async () => {
    await surface('Keyboard & touch help');
    await page.waitForSelector('.modal-overlay .kbd', { timeout: 3000 });
    const keys = await page.$$eval('.modal-overlay .kbd', ns => ns.map(n => n.textContent));
    const text = await page.locator('.modal-overlay').first().innerText();
    for (const k of ['Ctrl + D or Alt + D', 'Ctrl + C / X', 'Ctrl + V', 'Ctrl + Z / Y', 'Enter or F2', 'Space', 'Delete / Backspace', 'Ctrl + A', 'Shift + arrows', 'Long press a cell'])
      ok(text.includes(k), 'help is missing “' + k + '”');
    return keys.length + ' bindings documented across 4 groups';
  });

  /* ══════════════════ editing ══════════════════ */
  await check('edit: double-click a currency cell commits', async () => {
    await fcell('f_budget').dblclick();
    await page.waitForSelector('.cell-editor', { timeout: 3000 });
    await page.fill('.cell-editor', '13579');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(220);
    const v = await store('s.table().rows[0].cells.f_budget');
    ok(v === 13579, 'value = ' + JSON.stringify(v));
    return 'committed 13579 through the real .cell-editor';
  });
  await check('edit: Escape cancels, F2 edits, Enter commits and moves', async () => {
    await fcell('f_budget').dblclick();
    await page.waitForSelector('.cell-editor', { timeout: 3000 });
    await page.fill('.cell-editor', '111');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(220);
    const afterEsc = await store('s.table().rows[0].cells.f_budget');
    ok(afterEsc !== 111, 'Escape wrote ' + afterEsc);
    await page.keyboard.press('F2');
    await page.waitForSelector('.cell-editor', { timeout: 3000 });
    const seeded = await page.locator('.cell-editor').inputValue();
    await page.fill('.cell-editor', '222');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const active = await st(() => (document.querySelector('.cell.is-active') || {}).dataset);
    const afterEnter = await store('s.table().rows[0].cells.f_budget');
    ok(afterEnter === 222, 'Enter wrote ' + afterEnter);
    ok(active && active.c === '8', 'Enter did not move right: ' + JSON.stringify(active));
    return 'Escape kept ' + afterEsc + '; F2 opened with “' + seeded + '”; Enter wrote 222, moved to column ' + active.c;
  });
  await check('edit: clicking another cell commits the open editor', async () => {
    await fcell('f_budget').dblclick();
    await page.waitForSelector('.cell-editor', { timeout: 3000 });
    await page.fill('.cell-editor', '24680');
    await cell(2, 3).click();
    await page.waitForTimeout(300);
    const v = await store('s.table().rows[0].cells.f_budget');
    const editors = await page.locator('.cell-editor').count();
    ok(v === 24680 && editors === 0, 'value=' + v + ' editors=' + editors);
    return 'commit-on-blur wrote ' + v + ', editors left: ' + editors;
  });
  await check('edit: typing a letter replaces a text cell', async () => {
    await fcell('f_owner').click();
    await page.keyboard.type('Zed');
    await page.waitForSelector('.cell-editor', { timeout: 3000 });
    await page.keyboard.type(' Ahm');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const v = await store('s.table().rows[0].cells.f_owner');
    ok(v === 'Zed Ahm', 'value = ' + JSON.stringify(v));
    return 'typed → “' + v + '”';
  });
  await check('edit: single-select picks, then unpicks on re-click', async () => {
    await fcell('f_status').dblclick();
    await page.waitForSelector('.pop .pop-item', { timeout: 3000 });
    const items = await page.$$eval('.pop .pop-item', ns => ns.map(n => n.textContent.trim()));
    await page.locator('.pop .pop-item', { hasText: 'Blocked' }).first().click();
    await page.waitForTimeout(300);
    const name = await store('(s.fieldById("f_status").options.filter(o => o.id === s.table().rows[0].cells.f_status)[0] || {}).name');
    ok(name === 'Blocked', 'picked = ' + name);
    await fcell('f_status').dblclick();
    await page.waitForSelector('.pop .pop-item', { timeout: 3000 });
    await page.locator('.pop .pop-item', { hasText: 'Blocked' }).first().click();
    await page.waitForTimeout(300);
    const unpicked = await store('s.table().rows[0].cells.f_status');
    return items.length + ' options → picked “Blocked” → re-click → ' + JSON.stringify(unpicked);
  });
  await check('edit: single-select creates an option from the search box', async () => {
    await fcell('f_status', 1).dblclick();
    await page.waitForSelector('.pop .pop-search', { timeout: 3000 });
    await page.fill('.pop .pop-search', 'Waiting on legal');
    await page.waitForTimeout(220);
    const create = await page.locator('.pop .pop-create').count();
    ok(create === 1, 'no “+ Create” row appeared');
    await page.locator('.pop .pop-create').click();
    await page.waitForTimeout(320);
    const cellName = await store('(s.fieldById("f_status").options.filter(o => o.id === s.table().rows[1].cells.f_status)[0] || {}).name');
    const pills = await page.locator('.tablify-rows .cell[data-field-id="f_status"] .pill').count();
    ok(cellName === 'Waiting on legal', 'cell holds ' + cellName);
    return 'created “Waiting on legal”, written to row 2, ' + pills + ' pills rendered';
  });
  await check('edit: multi-select toggles one tag off and on', async () => {
    const tag = 'sync';
    const id = await store('s.fieldById("f_tags").options.filter(o => o.name === "sync")[0].id');
    const before = await store('(s.table().rows[0].cells.f_tags || []).slice()');
    await fcell('f_tags').dblclick();
    await page.waitForSelector('.pop .pop-item', { timeout: 3000 });
    await page.locator('.pop .pop-item', { hasText: 'sync' }).first().click();
    await page.waitForTimeout(300);
    const added = await store('(s.table().rows[0].cells.f_tags || []).slice()');
    await page.locator('.pop .pop-item', { hasText: 'sync' }).first().click();
    await page.waitForTimeout(300);
    const removed = await store('(s.table().rows[0].cells.f_tags || []).slice()');
    await page.keyboard.press('Escape');
    ok(added.length === before.length + 1 && added.indexOf(id) !== -1, 'add failed: ' + JSON.stringify(added));
    ok(removed.indexOf(id) === -1, 'remove failed: ' + JSON.stringify(removed));
    return before.length + ' tags → ' + added.length + ' (' + tag + ' added) → ' + removed.length + ' (' + tag + ' removed)';
  });
  await check('edit: rating stars set and clear', async () => {
    await fcell('f_conf').dblclick();
    await page.waitForSelector('.pop span', { timeout: 3000 });
    const stars = await page.locator('.pop span').count();
    await page.locator('.pop span').nth(3).click();
    await page.waitForTimeout(300);
    const four = await store('s.table().rows[0].cells.f_conf');
    await fcell('f_conf').dblclick();
    await page.waitForSelector('.pop .pop-item', { timeout: 3000 });
    await page.locator('.pop .pop-item', { hasText: 'Clear rating' }).click();
    await page.waitForTimeout(300);
    const cleared = await store('s.table().rows[0].cells.f_conf');
    ok(four === 4, '4th star wrote ' + four);
    ok(cleared == null, 'clear left ' + cleared);
    return stars + ' stars → 4th wrote ' + four + ' → Clear rating → ' + JSON.stringify(cleared);
  });
  await check('edit: long-text popover saves, attachment adds and removes', async () => {
    await fcell('f_notes').dblclick();
    await page.waitForSelector('.pop textarea', { timeout: 3000 });
    await page.fill('.pop textarea', 'note text');
    await page.locator('.pop .ob-btn.is-primary').click();
    await page.waitForTimeout(300);
    const notes = await store('s.table().rows[0].cells.f_notes');
    ok(notes === 'note text', 'notes = ' + JSON.stringify(notes));
    await fcell('f_assets').dblclick();
    await page.waitForSelector('.pop input', { timeout: 3000 });
    await page.fill('.pop input', 'Assets/x.png');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const added = await store('(s.table().rows[0].cells.f_assets || []).length');
    await fcell('f_assets').dblclick();
    await page.waitForSelector('.pop .pop-item-tick', { timeout: 3000 });
    await page.locator('.pop .pop-item-tick').first().click();
    await page.waitForTimeout(300);
    const removed = await store('(s.table().rows[0].cells.f_assets || []).length');
    ok(added >= 1 && removed === added - 1, 'added=' + added + ' removed=' + removed);
    return 'long text saved; attachments ' + added + ' → ' + removed;
  });
  await check('edit: checkbox by mouse and by Space', async () => {
    const before = await store('s.table().rows[0].cells.f_done');
    await page.locator('.tablify-rows .cell[data-r="0"] input.checkbox').first().click();
    await page.waitForTimeout(250);
    const byMouse = await store('s.table().rows[0].cells.f_done');
    await st(() => { const g = window.TF.harness.ctx().grid; g.focusCell(1, window.TF.store.visibleFields().findIndex(f => f.id === 'f_done') + 1); });
    await page.keyboard.press(' ');
    await page.waitForTimeout(250);
    const byKey = await store('s.table().rows[1].cells.f_done');
    ok(byMouse !== before && byKey === true, 'mouse ' + byMouse + ' key ' + byKey);
    return 'row1 ' + before + ' → ' + byMouse + ' (click); row2 → ' + byKey + ' (Space)';
  });
  await check('edit: each scalar editor parses its own type', async () => {
    const cases = [['f_owner', 'Nasrin', 'Nasrin'], ['f_budget', '1500', 1500], ['f_progress', '45', 45], ['f_due', '2026-12-01', '2026-12-01']];
    const got = {};
    for (const c of cases) {
      await fcell(c[0]).dblclick();
      await page.waitForSelector('.cell-editor', { timeout: 3000 });
      await page.fill('.cell-editor', c[1]);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      got[c[0]] = await store('s.table().rows[0].cells.' + c[0]);
      ok(String(got[c[0]]) === String(c[2]), c[0] + ' → ' + JSON.stringify(got[c[0]]) + ' (wanted ' + c[2] + ')');
    }
    return JSON.stringify(got);
  });
  await check('edit: duration input understands units', async () => {
    const out = {};
    for (const c of [['45m', 2700], ['2h', 7200], ['1h30m', 5400], ['90', 90]]) {
      await fcell('f_est').dblclick();
      await page.waitForSelector('.cell-editor', { timeout: 3000 });
      await page.fill('.cell-editor', c[0]);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      out[c[0]] = await store('s.table().rows[0].cells.f_est');
      ok(out[c[0]] === c[1], c[0] + ' → ' + out[c[0]] + ' s (wanted ' + c[1] + ')');
    }
    return JSON.stringify(out) + ' seconds';
  });
  await check('edit: computed fields refuse editing', async () => {
    const res = await st(() => {
      const s = window.TF.store, g = window.TF.harness.ctx().grid;
      const f = s.table().fields.filter(x => x.type === 'autoNumber')[0];
      const before = s.table().rows[0].cells[f.id];
      g.beginEdit(0, s.visibleFields().findIndex(x => x.id === f.id) + 1);
      return { before: before, after: s.table().rows[0].cells[f.id], editors: document.querySelectorAll('.cell-editor').length };
    });
    ok(res.after === res.before, 'value changed: ' + JSON.stringify(res));
    return 'auto number untouched (' + res.before + '), editors opened: ' + res.editors;
  });

  /* ══════════════════ keyboard + blocks ══════════════════ */
  await check('keyboard: arrows, Tab, PageUp/Down, Home, End move the active cell', async () => {
    await cell(0, 2).click();
    const trail = [];
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'Tab', 'PageDown', 'Home', 'End', 'PageUp']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(80);
      trail.push(await st(() => { const c = document.querySelector('.cell.is-active'); return c ? c.dataset.r + ':' + c.dataset.c : '?'; }));
    }
    ok(trail[0] === '1:2' && trail[2] === '2:3' && trail[6] === '14:19' && trail[7] === '2:19', 'trail: ' + trail.join(' '));
    return trail.join(' → ');
  });
  await check('blocks: Ctrl+C copies, Ctrl+V pastes the block', async () => {
    await cell(1, 2).click();
    await st(() => { const g = window.TF.harness.ctx().grid; g.setSelection(1, 2); g.setSelection(3, 4, true); });
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(280);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const src = await store('s.table().rows.map(r => [r.cells.f_status, r.cells.f_tags, r.cells.f_owner])');
    await st(() => window.TF.harness.ctx().grid.setSelection(12, 2));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(400);
    const now = await store('s.table().rows.map(r => [r.cells.f_status, r.cells.f_tags, r.cells.f_owner])');
    ok(clip.split('\n').length === 3, 'clipboard rows ' + clip.split('\n').length);
    ok(JSON.stringify(now.slice(12, 15)) === JSON.stringify(src.slice(1, 4)), 'pasted block differs');
    return '3×3 block “' + clip.split('\n')[0].split('\t')[0] + '” → rows 13-15 match rows 2-4';
  });
  await check('blocks: Ctrl+X copies then clears the source cells', async () => {
    await cell(1, 2).click();
    await st(() => { const g = window.TF.harness.ctx().grid; g.setSelection(1, 2); g.setSelection(2, 3, true); });
    await page.keyboard.press('Control+x');
    await page.waitForTimeout(400);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const values = await store('s.table().rows.slice(1, 3).map(r => r.cells.f_status)');
    const tags = await store('s.table().rows.slice(1, 3).map(r => r.cells.f_tags)');
    ok(clip.split('\n').length === 2, 'clipboard rows ' + clip.split('\n').length);
    ok(values.every(v => v == null) && tags.every(t => !t || !t.length), 'not cleared: ' + JSON.stringify({ values: values, tags: tags }));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(350);
    const restored = await store('s.table().rows.slice(1, 3).map(r => r.cells.f_status)');
    ok(restored.every(v => v != null), 'undo did not restore: ' + JSON.stringify(restored));
    return 'clipboard kept 2 rows, cells + tags cleared, one Ctrl+Z restored ' + JSON.stringify(restored);
  });
  await check('blocks: Ctrl+D fills down and Ctrl+R fills right', async () => {
    await cell(4, 4).click();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
    const before = await store('s.table().rows.slice(4, 9).map(r => r.cells.f_owner)');
    await page.keyboard.press('Control+d');
    await page.waitForTimeout(320);
    const down = await store('s.table().rows.slice(4, 9).map(r => r.cells.f_owner)');
    ok(new Set(down).size === 1, 'fill down: ' + JSON.stringify(down));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(280);
    await cell(2, 3).click();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Control+r');
    await page.waitForTimeout(320);
    const tags = await store('s.table().rows[2].cells.f_tags');
    const owner = await store('s.table().rows[2].cells.f_owner');
    ok(JSON.stringify(tags) === JSON.stringify(owner), 'fill right: tags=' + JSON.stringify(tags) + ' owner=' + JSON.stringify(owner));
    return 'down → “' + down[0] + '” across 5 rows (was ' + new Set(before).size + ' distinct); right → tags copies owner (' + JSON.stringify(owner) + ')';
  });
  await check('blocks: Delete clears, Ctrl+Z restores, Ctrl+A selects all', async () => {
    const before = await store('s.table().rows.slice(0, 3).map(r => r.cells.f_notes)');
    await cell(0, 12).click();
    await st(() => { const g = window.TF.harness.ctx().grid; g.setSelection(0, 12); g.setSelection(2, 12, true); });
    await page.keyboard.press('Delete');
    await page.waitForTimeout(280);
    const cleared = await store('s.table().rows.slice(0, 3).map(r => r.cells.f_notes)');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(280);
    const restored = await store('s.table().rows.slice(0, 3).map(r => r.cells.f_notes)');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(220);
    const all = await st(() => { const s = window.TF.harness.ctx().grid.getSelection(); return { r: s.rows.length, f: s.fields.length }; });
    ok(cleared.every(v => v == null || v === ''), 'not cleared: ' + JSON.stringify(cleared));
    ok(JSON.stringify(before) === JSON.stringify(restored), 'undo mismatch');
    ok(all.r === 30 && all.f === 19, 'select all = ' + JSON.stringify(all));
    return '3 cells cleared → undo restored → select all ' + all.r + '×' + all.f;
  });
  await check('blocks: multi-step undo and redo across four edits', async () => {
    const start = await store('s.table().rows[0].cells.f_budget');
    await cell(0, 2).click();
    await st(() => {
      const s = window.TF.store;
      s.setCell('r1', 'f_budget', 100); s.setCell('r1', 'f_owner', 'One');
      s.setCell('r1', 'f_progress', 10); s.setCell('r1', 'f_conf', 1);
      window.TF.harness.ctx().grid.render();
    });
    const after = await store('[s.table().rows[0].cells.f_budget, s.table().rows[0].cells.f_owner, s.table().rows[0].cells.f_progress, s.table().rows[0].cells.f_conf]');
    const undoLabels = await store('[s.undoLabel(), s.redoLabel()]');
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(140); }
    const undone = await store('[s.table().rows[0].cells.f_budget, s.table().rows[0].cells.f_owner, s.table().rows[0].cells.f_progress, s.table().rows[0].cells.f_conf]');
    await page.keyboard.press('Control+y'); await page.waitForTimeout(160);
    await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(180);
    await page.keyboard.press('Control+y'); await page.waitForTimeout(180);
    await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(200);
    const redone = await store('[s.table().rows[0].cells.f_budget, s.table().rows[0].cells.f_owner, s.table().rows[0].cells.f_progress, s.table().rows[0].cells.f_conf]');
    ok(after[0] === 100 && after[2] === 10 && after[3] === 1, 'writes failed: ' + JSON.stringify(after));
    ok(undone[0] === start && undone[1] !== 'One' && undone[2] !== 10, 'undo depth wrong: ' + JSON.stringify(undone));
    ok(JSON.stringify(redone) === JSON.stringify(after), 'redo wrong: ' + JSON.stringify(redone));
    return 'labels ' + JSON.stringify(undoLabels) + '; 4 edits → undo ×4 → ' + JSON.stringify(undone) + ' → redo ×2 → ' + JSON.stringify(redone);
  });
  await check('blocks: paste dialog “Append as new rows” really appends', async () => {
    const rows = [];
    for (let i = 0; i < 80; i++) rows.push('Row ' + i + '\tValue ' + i + '\t0.' + i);
    await page.evaluate(t => navigator.clipboard.writeText(t), rows.join('\n'));
    await cell(0, 2).click();
    await st(() => window.TF.harness.ctx().grid.setSelection(0, 2));
    await page.keyboard.press('Control+v');
    await page.waitForSelector('.modal-overlay .dlg-choice', { timeout: 4000 });
    const modes = await page.$$eval('.dlg-choice-name', ns => ns.map(n => n.textContent));
    await page.locator('.dlg-choice', { hasText: 'Append as new rows' }).click();
    await page.waitForTimeout(450);
    const total = await store('s.table().rows.length');
    const last = await store('s.table().rows[109].cells.f_owner');
    ok(total === 110, 'rows = ' + total + ' (expected 30 + 80)');
    ok(String(last).indexOf('79') !== -1, 'last row = ' + JSON.stringify(last));
    return modes.length + ' modes; append → ' + total + ' rows, row 110 = “' + last + '”';
  });
  await check('blocks: paste dialog “Fill cells” overwrites from the anchor', async () => {
    const rows = [];
    for (let i = 0; i < 80; i++) rows.push('F' + i + '\tS' + i + '\tN' + i);
    await page.evaluate(t => navigator.clipboard.writeText(t), rows.join('\n'));
    await cell(2, 4).click();
    await st(() => window.TF.harness.ctx().grid.setSelection(2, 4));
    await page.keyboard.press('Control+v');
    await page.waitForSelector('.modal-overlay .dlg-choice', { timeout: 4000 });
    await page.locator('.dlg-choice', { hasText: 'Fill cells from the selection' }).click();
    await page.waitForTimeout(450);
    const total = await store('s.table().rows.length');
    const anchor = await store('s.table().rows[2].cells.f_owner');
    const beyond = await store('s.table().rows[45].cells.f_owner');
    ok(total === 82, 'grew to ' + total + ' rows (30 + the block reaching row 82)');
    ok(anchor === 'F0' && beyond === 'F43', 'anchor=' + anchor + ' row46=' + beyond);
    return 'grew to ' + total + ' rows, overwrote from the anchor: row3 = “' + anchor + '”, row46 = “' + beyond + '”';
  });
  await check('blocks: paste dialog “Create rows” maps columns by header', async () => {
    const rows = [];
    for (let i = 0; i < 70; i++) rows.push((i % 2 ? 'Done' : 'Blocked') + '\tOwner ' + i);
    const block = 'Status\tOwner\n' + rows.join('\n');
    await page.evaluate(t => navigator.clipboard.writeText(t), block);
    await cell(0, 2).click();
    await st(() => window.TF.harness.ctx().grid.setSelection(0, 2));
    await page.keyboard.press('Control+v');
    await page.waitForSelector('.modal-overlay .dlg-choice', { timeout: 4000 });
    await page.locator('.dlg-choice', { hasText: 'Create rows in this table' }).click();
    await page.waitForTimeout(450);
    const total = await store('s.table().rows.length');
    const made = await store('s.table().rows.slice(30).map(r => [r.cells.f_status, r.cells.f_owner, r.cells.f_notes])');
    const names = await store('s.table().rows.slice(30, 34).map(r => (s.fieldById("f_status").options.filter(o => o.id === r.cells.f_status)[0] || {}).name)');
    ok(total === 100, 'rows = ' + total + ' (30 + 70 pasted, header consumed)');
    ok(names[0] === 'Blocked' && made[0][1] === 'Owner 0', 'row 31 = ' + JSON.stringify(made[0]) + ' / ' + names[0]);
    ok(made.every(r => r[2] == null || r[2] === ''), 'unmapped column was written: ' + JSON.stringify(made.slice(0, 3).map(r => r[2])));
    return 'header row consumed, ' + total + ' rows; ' + JSON.stringify(names) + ' with owners ' + JSON.stringify(made.slice(0, 3).map(r => r[1])) + '; notes left empty';
  });

  /* ══════════════════ drags ══════════════════ */
  await check('drag: resize a scrolling column', async () => {
    const before = await store('s.fieldById("f_status").width');
    const h = await page.locator('.tablify-header .hcell[data-field-id="f_status"] .hcell-resize').boundingBox();
    await page.mouse.move(h.x + 2, h.y + 18);
    await page.mouse.down();
    await page.mouse.move(h.x + 96, h.y + 18, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(280);
    const after = await store('s.fieldById("f_status").width');
    ok(after - before >= 60, before + ' → ' + after);
    return before + 'px → ' + after + 'px';
  });
  await check('drag: resize the frozen primary column', async () => {
    const before = await store('s.fieldById("f_task").width');
    const h = await page.locator('.tablify-corner .hcell[data-field-id="f_task"] .hcell-resize').boundingBox();
    await page.mouse.move(h.x + 2, h.y + 18);
    await page.mouse.down();
    await page.mouse.move(h.x + 80, h.y + 18, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(280);
    const after = await store('s.fieldById("f_task").width');
    ok(after - before >= 50, before + ' → ' + after);
    return before + 'px → ' + after + 'px';
  });
  await check('drag: reorder a column by its header', async () => {
    const before = await store('s.table().fields.map(f => f.id)');
    const a = await hcell('f_status').boundingBox();
    const b = await hcell('f_budget').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 20);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 30, a.y + 20, { steps: 3 });
    const indicators = await page.locator('.tablify-drop, .drop-line, .is-drop-target').count();
    await page.mouse.move(b.x + b.width - 4, b.y + 20, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(320);
    const after = await store('s.table().fields.map(f => f.id)');
    ok(before.indexOf('f_status') !== after.indexOf('f_status'), 'index unchanged');
    return 'status column ' + before.indexOf('f_status') + ' → ' + after.indexOf('f_status') + ' (drop indicator: ' + indicators + ')';
  });
  await check('drag: reorder a row over the gutter and over the data', async () => {
    const out = [];
    for (const dropOn of ['frozen', 'data']) {
      const before = await store('s.table().rows.map(r => r.id)');
      const handle = await page.locator('.tablify-frozen .gutter-handle').first().boundingBox();
      const target = dropOn === 'frozen'
        ? await page.locator('.tablify-frozen .grid-row[data-r="4"]').boundingBox()
        : await cell(4, 2).boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + 30, handle.y + 30, { steps: 4 });
      await page.mouse.move(target.x + 20, target.y + target.height - 6, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(320);
      const after = await store('s.table().rows.map(r => r.id)');
      ok(after[0] !== before[0], 'no move when dropping on ' + dropOn + ': ' + after.slice(0, 3).join());
      out.push(dropOn + ': ' + before[0] + ' → index ' + after.indexOf(before[0]));
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(240);
    }
    return out.join('; ') + ' (each undone)';
  });
  await check('drag: drag-select past the bottom edge auto-scrolls', async () => {
    const box = await cell(1, 2).boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    const area = await page.locator('.tablify-grid-area').boundingBox();
    await page.mouse.move(area.x + 300, area.y + area.height - 8, { steps: 8 });
    await page.waitForTimeout(520);
    const scrolled = await st(() => document.querySelector('.tablify-scroller').scrollTop);
    await page.mouse.up();
    const sel = await st(() => { const s = window.TF.harness.ctx().grid.getSelection(); return { rows: s.rows.length, fields: s.fields.length }; });
    ok(scrolled > 100 && sel.rows >= 8, 'scrolled ' + scrolled + ' rows ' + sel.rows);
    return 'scrolled ' + scrolled + 'px, selected ' + sel.rows + '×' + sel.fields;
  });

  /* ══════════════════ scrolling ══════════════════ */
  await check('scroll: wheel works over every grid region', async () => {
    const out = [];
    for (const sel of ['.tablify-rows .cell', '.tablify-header .hcell', '.tablify-frozen .gutter', '.tablify-corner', '.tablify-hbar', '.tablify-vbar']) {
      await st(() => { const s = document.querySelector('.tablify-scroller'); s.scrollTop = 0; s.scrollLeft = 0; });
      const box = await page.locator(sel).first().boundingBox();
      await page.mouse.move(box.x + Math.min(30, box.width / 2), box.y + Math.min(10, box.height / 2));
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(160);
      const t = await st(() => document.querySelector('.tablify-scroller').scrollTop);
      out.push(sel.replace('.tablify-', '') + '=' + t);
      ok(t === 240, 'wheel over ' + sel + ' moved ' + t + 'px');
    }
    return out.join(' ');
  });
  await check('scroll: both axes move the lanes; the frozen column stays pinned', async () => {
    await st(() => { const s = document.querySelector('.tablify-scroller'); s.scrollTop = 0; s.scrollLeft = 0; });
    const box = await cell(0, 2).boundingBox();
    await page.mouse.move(box.x + 30, box.y + 10);
    await page.mouse.wheel(180, 220);
    await page.waitForTimeout(280);
    const r = await st(() => ({
      t: document.querySelector('.tablify-scroller').scrollTop,
      l: document.querySelector('.tablify-scroller').scrollLeft,
      rows: getComputedStyle(document.querySelector('.tablify-rows .lane')).transform,
      header: getComputedStyle(document.querySelector('.tablify-header .lane')).transform,
      frozen: getComputedStyle(document.querySelector('.tablify-frozen .lane')).transform,
    }));
    ok(r.t === 220 && r.l === 180, JSON.stringify(r));
    ok(r.rows.indexOf('-180') !== -1 && r.header.indexOf('-180') !== -1 && r.frozen === 'matrix(1, 0, 0, 1, 0, -220)', 'lanes: ' + JSON.stringify(r));
    return 'rows/header x=-180 y=-220; frozen y only: ' + r.frozen;
  });
  await check('scroll: dragging both docked thumbs moves the grid', async () => {
    const out = [];
    for (const pair of [['.tablify-vthumb', 't'], ['.tablify-hthumb', 'l']]) {
      await st(() => { const s = document.querySelector('.tablify-scroller'); s.scrollTop = 0; s.scrollLeft = 0; });
      await page.waitForTimeout(120);
      const th = await page.locator(pair[0]).boundingBox();
      await page.mouse.move(th.x + th.width / 2, th.y + th.height / 2);
      await page.mouse.down();
      await page.mouse.move(th.x + th.width / 2 + (pair[1] === 'l' ? 180 : 0), th.y + th.height / 2 + (pair[1] === 't' ? 160 : 0), { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(220);
      const pos = await st(() => { const s = document.querySelector('.tablify-scroller'); return { t: s.scrollTop, l: s.scrollLeft }; });
      const got = pair[1] === 't' ? pos.t : pos.l;
      out.push(pair[1] + '=' + got);
      ok(got > 100, 'no movement dragging ' + pair[0] + ': ' + JSON.stringify(pos));
    }
    return 'vertical thumb → scrollTop ' + out[0].slice(2) + ', horizontal thumb → scrollLeft ' + out[1].slice(2);
  });
  await check('scroll: thumbs track a programmatic scroll in both axes', async () => {
    const before = await st(() => ({
      h: parseFloat(document.querySelector('.tablify-hthumb').style.left) || 0,
      v: parseFloat(document.querySelector('.tablify-vthumb').style.top) || 0,
    }));
    const sizes = await st(() => ({
      hw: document.querySelector('.tablify-hthumb').style.width,
      vh: document.querySelector('.tablify-vthumb').style.height,
    }));
    await st(() => { const s = document.querySelector('.tablify-scroller'); s.scrollTop = 400; s.scrollLeft = 300; });
    await page.waitForTimeout(200);
    const after = await st(() => ({
      h: parseFloat(document.querySelector('.tablify-hthumb').style.left) || 0,
      v: parseFloat(document.querySelector('.tablify-vthumb').style.top) || 0,
    }));
    ok(after.h > before.h && after.v > before.v, JSON.stringify({ before: before, after: after }));
    return 'h thumb ' + before.h + ' → ' + after.h + 'px, v thumb ' + before.v + ' → ' + after.v + 'px (sizes ' + sizes.hw + ' × ' + sizes.vh + ')';
  });
  await check('scroll: PageDown and End reach every row and column', async () => {
    await cell(0, 2).click();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(320);
    const t1 = await st(() => document.querySelector('.tablify-scroller').scrollTop);
    const r1 = await st(() => (document.querySelector('.cell.is-active') || {}).dataset.r);
    await page.keyboard.press('End');
    await page.waitForTimeout(280);
    const l1 = await st(() => document.querySelector('.tablify-scroller').scrollLeft);
    const c1 = await st(() => (document.querySelector('.cell.is-active') || {}).dataset.c);
    ok(t1 > 100 && l1 > 100, 'pageDown scrollTop=' + t1 + ' end scrollLeft=' + l1);
    return 'PageDown → active row ' + r1 + ', scrollTop ' + t1 + '; End → active column ' + c1 + ', scrollLeft ' + l1;
  });
  await check('scroll: still works at 389 px with touch mode on', async () => {
    await page.locator('.harness-btn', { hasText: 'Phone' }).click();
    await st(() => { window.TF.store.setUI({ touch: true }); window.TF.harness.ctx().grid.render(); });
    await page.waitForTimeout(400);
    const w = await st(() => Math.round(document.getElementById('window').getBoundingClientRect().width));
    const box = await page.locator('.tablify-rows .cell').first().boundingBox();
    await page.mouse.move(box.x + 20, box.y + 8);
    await page.mouse.wheel(140, 200);
    await page.waitForTimeout(280);
    const pos = await st(() => { const s = document.querySelector('.tablify-scroller'); return { t: s.scrollTop, l: s.scrollLeft }; });
    ok(w === 389 && pos.t === 200 && pos.l === 140, w + 'px: ' + JSON.stringify(pos));
    return w + 'px window, touch on: scrollTop ' + pos.t + ', scrollLeft ' + pos.l;
  });

  /* ══════════════════ view panels ══════════════════ */
  await check('panel: filter builder conditions, chips and clear', async () => {
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Filter' }).click();
    await page.waitForSelector('.modal-overlay');
    await page.locator('.modal-overlay .ob-btn', { hasText: '+ Add condition' }).click();
    await page.waitForTimeout(250);
    await page.locator('.modal-overlay select').first().selectOption('f_status');
    await page.waitForTimeout(320);
    const operators = await page.$$eval('.modal-overlay select', ns => Array.from(ns[1].options).map(o => o.value));
    await page.locator('.modal-overlay select').nth(1).selectOption('is');
    await page.waitForTimeout(220);
    const chips = await page.locator('.modal-overlay .tablify-chip .tablify-btn').count();
    await page.locator('.modal-overlay .tablify-chip .tablify-btn').first().click();
    await page.waitForTimeout(320);
    const rows = await store('s.viewRows().length');
    const query = await page.locator('.modal-overlay .tablify-query').inputValue();
    await page.locator('.modal-overlay .tablify-x').first().click();
    await page.waitForTimeout(280);
    const cleared = await store('s.viewRows().length');
    ok(operators.length >= 3 && rows > 0 && rows < 30 && cleared === 30, 'ops=' + operators.length + ' rows=' + rows + ' cleared=' + cleared);
    return chips + ' chip; operators ' + JSON.stringify(operators) + '; filtered to ' + rows + ' rows; query “' + query + '”; removed → ' + cleared;
  });
  await check('panel: query DSL filters the grid and round-trips', async () => {
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Filter' }).click();
    await page.waitForSelector('.modal-overlay .tablify-query');
    const hint = await page.locator('.modal-overlay .tablify-query').getAttribute('placeholder');
    await page.locator('.modal-overlay .tablify-query').fill('status:~done and budget>1000');
    await page.locator('.modal-overlay .tablify-query').press('Enter');
    await page.waitForTimeout(450);
    const conds = await store('s.view().filters.conditions.map(c => c.fieldId + " " + c.op)');
    const errors = await store('s.view().queryErrors.length');
    const chips = await page.locator('.modal-overlay .tablify-cond').count();
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Done' }).click();
    await page.waitForTimeout(320);
    const rows = await store('s.viewRows().length');
    const shown = await store('s.viewRows().every(r => r.cells.f_budget == null || r.cells.f_budget > 1000)');
    ok(rows > 0 && rows < 30 && errors === 0 && chips === 2 && shown, 'DSL matched ' + rows + ' rows, ' + errors + ' errors, ' + chips + ' chips');
    /* the advertised OR form must parse too; the AND-only builder shows nothing for it */
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Filter' }).click();
    await page.waitForSelector('.modal-overlay .tablify-query');
    await page.locator('.modal-overlay .tablify-query').fill(hint);
    await page.locator('.modal-overlay .tablify-query').press('Enter');
    await page.waitForTimeout(450);
    const orErrors = await store('s.view().queryErrors.length');
    const orChips = await page.locator('.modal-overlay .tablify-cond').count();
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Done' }).click();
    await page.waitForTimeout(300);
    const orRows = await store('s.viewRows().length');
    ok(orErrors === 0 && orRows > 0, 'OR form failed: ' + orErrors + ' errors, ' + orRows + ' rows');
    return 'AND “status:~done and budget>1000” → ' + JSON.stringify(conds) + ' (' + chips + ' chips) → ' + rows + ' rows; the placeholder hint (OR + empty) parses too → ' + orRows + ' rows, builder shows ' + orChips + ' chips (it is AND-only)';
  });
  await check('panel: sort dialog stacks levels and reorders them', async () => {
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Sort' }).click();
    await page.waitForSelector('.modal-overlay .ob-btn');
    await page.locator('.modal-overlay .ob-btn', { hasText: '+ Add sort' }).click();
    await page.waitForSelector('.modal-overlay select', { timeout: 3000 });
    await page.waitForTimeout(220);
    await page.locator('.modal-overlay .ob-btn', { hasText: '+ Add sort' }).click();
    await page.waitForTimeout(280);
    const selects = await page.locator('.modal-overlay select').count();
    const autoSecond = await store('s.view().sorts.map(x => x.fieldId)');
    await page.locator('.modal-overlay select').nth(2).selectOption('f_budget');
    await page.waitForTimeout(280);
    await page.locator('.modal-overlay select').nth(3).selectOption('desc');
    await page.waitForTimeout(280);
    const order = await store('s.view().sorts.map(x => s.fieldById(x.fieldId).name + " " + x.dir)');
    await page.locator('.modal-overlay .tablify-x', { hasText: '↑' }).nth(1).click();
    await page.waitForTimeout(280);
    const moved = await store('s.view().sorts.map(x => s.fieldById(x.fieldId).name)');
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Done' }).click();
    await page.waitForTimeout(320);
    const view = await store('s.viewRows().map(r => r.cells.f_budget)');
    ok(selects >= 4 && JSON.stringify(order) !== JSON.stringify(moved), 'levels ' + JSON.stringify(order) + ' → ' + JSON.stringify(moved));
    ok(view.every((v, i) => i === 0 || view[i - 1] >= v), 'sorted rows wrong: ' + view.slice(0, 5));
    return 'two levels auto-picked ' + JSON.stringify(autoSecond) + ' → ' + JSON.stringify(order) + ' → reordered ' + JSON.stringify(moved) + '; grid descending ' + view.slice(0, 3);
  });
  await check('panel: group by + collapse a group', async () => {
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Group' }).click();
    await page.waitForSelector('.modal-overlay .dlg-choice');
    await page.locator('.modal-overlay .dlg-choice', { hasText: 'Status' }).first().click();
    await page.waitForTimeout(380);
    const bars = await page.locator('.tablify-rows .group-bar').count();
    const before = await page.locator('.tablify-rows .grid-row').count();
    await page.locator('.tablify-rows .group-bar').first().click();
    await page.waitForTimeout(320);
    const collapsed = await page.locator('.tablify-rows .grid-row').count();
    ok(bars >= 2 && collapsed < before, 'bars=' + bars + ' ' + before + '→' + collapsed);
    return bars + ' groups; collapse ' + before + ' → ' + collapsed + ' rows';
  });
  await check('panel: hide fields panel + show all', async () => {
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Fields' }).click();
    await page.waitForSelector('.modal-overlay .opt-row');
    const before = await store('s.visibleFields().length');
    await page.locator('.modal-overlay .opt-row input').nth(4).click();
    await page.waitForTimeout(280);
    const hidden = await store('s.visibleFields().length');
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Show all' }).click();
    await page.waitForTimeout(280);
    const shown = await store('s.visibleFields().length');
    ok(hidden === before - 1 && shown === before, before + '/' + hidden + '/' + shown);
    return before + ' → ' + hidden + ' → ' + shown + ' fields';
  });
  await check('panel: view settings + preset save / apply / delete', async () => {
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'View' }).click();
    await page.waitForSelector('.modal-overlay .tablify-btn');
    await page.locator('.modal-overlay .tablify-btn', { hasText: 'Short' }).click();
    await page.waitForTimeout(280);
    const rh = await page.locator('.tablify-rows .grid-row').first().evaluate(n => Math.round(n.getBoundingClientRect().height));
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Save current view as preset' }).click();
    await page.waitForTimeout(320);
    await page.locator('.modal-overlay .ob-input').last().fill('Audit preset');
    await page.locator('.modal-overlay .ob-btn.is-primary').last().click();
    await page.waitForTimeout(400);
    const presets = await store('s.get().presets.map(p => p.name)');
    const applied = await store('s.applyPreset("Audit preset") && s.view().rowHeight');
    await page.waitForTimeout(280);
    const appliedRh = await page.locator('.tablify-rows .grid-row').first().evaluate(n => Math.round(n.getBoundingClientRect().height));
    const deleted = await store('s.deletePreset("Audit preset")');
    ok(rh === 30 && presets.length >= 1 && applied === 'short' && appliedRh === 30 && deleted, 'rh=' + rh + ' presets=' + JSON.stringify(presets) + ' applied=' + applied + '/' + appliedRh);
    return 'short rows ' + rh + 'px; saved ' + JSON.stringify(presets) + '; re-applied → ' + appliedRh + 'px; deleted=' + deleted;
  });
  await check('panel: field config renames and converts without losing data', async () => {
    await openMenuOn(hcell('f_est'));
    await page.locator('.menu .menu-item', { hasText: 'Edit field' }).click();
    await page.waitForSelector('.modal-overlay');
    const nameInput = page.locator('.modal-overlay .ob-input').first();
    await nameInput.fill('Effort');
    await nameInput.press('Enter');
    await page.waitForTimeout(320);
    const before = await store('s.table().rows[0].cells.f_est');
    await page.locator('.modal-overlay select').first().selectOption('percent');
    await page.waitForTimeout(450);
    const out = await store('({ name: s.fieldById("f_est").name, type: s.fieldById("f_est").type, v: s.table().rows[0].cells.f_est })');
    const shown = await page.locator('.tablify-rows .cell[data-field-id="f_est"]').first().innerText();
    ok(out.name === 'Effort' && out.type === 'percent' && out.v === before, JSON.stringify(out) + ' was ' + before);
    return 'renamed + duration→percent kept the value (' + before + ' → ' + out.v + '); cell shows “' + shown.trim() + '”';
  });
  await check('panel: option manager adds, recolours, reorders and deletes', async () => {
    await openMenuOn(hcell('f_status'));
    await page.locator('.menu .menu-item', { hasText: 'Manage options' }).click();
    await page.waitForSelector('.modal-overlay .opt-row');
    const before = await page.locator('.modal-overlay .opt-row').count();
    await page.locator('.modal-overlay .ob-btn', { hasText: '+ Add option' }).click();
    await page.waitForTimeout(320);
    const input = page.locator('.modal-overlay .opt-row .ob-input').last();
    await input.fill('Gate 3');
    await input.press('Enter');
    await page.waitForTimeout(320);
    const added = await page.locator('.modal-overlay .opt-row').count();
    const made = await store('!!window.TF.data.findOptionByName(s.fieldById("f_status"), "Gate 3")');
    await page.locator('.modal-overlay .opt-swatch').last().click();
    await page.waitForSelector('.menu .menu-item', { timeout: 3000 });
    await page.locator('.menu .menu-item', { hasText: 'pink' }).click();
    await page.waitForTimeout(320);
    const colour = await store('s.fieldById("f_status").options.slice(-1)[0].color');
    await page.locator('.modal-overlay .opt-row').last().locator('.tablify-x', { hasText: '↑' }).click();
    await page.waitForTimeout(320);
    const order = await store('s.fieldById("f_status").options.map(o => o.name).slice(-3)');
    await page.locator('.modal-overlay .opt-row').last().locator('.tablify-x', { hasText: '✕' }).click();
    await page.waitForTimeout(400);
    const asked = await page.locator('.modal-overlay .modal-title', { hasText: 'Delete option' }).count();
    const detail = asked ? await page.locator('.modal-overlay .ob-hint').first().innerText() : '';
    if (asked) await page.locator('.modal-overlay .ob-btn.is-danger').last().click();
    await page.waitForTimeout(500);
    const after = await store('s.fieldById("f_status").options.length');
    ok(before === 5 && added === 6 && made && colour === 'pink' && asked === 1 && after === 5, before + '/' + added + '/' + made + '/' + colour + '/asked=' + asked + '/' + after);
    return before + ' → add (6) → rename → ' + colour + ' → moved up (' + JSON.stringify(order) + ') → delete asks “' + detail.replace(/\s+/g, ' ').slice(0, 40) + '” → ' + after;
  });
  await check('panel: import CSV text with inferred types → append', async () => {
    const before = await store('s.table().rows.length');
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Import' }).click();
    await page.waitForSelector('.dlg-choice');
    await page.locator('.dlg-choice', { hasText: 'CSV / TSV text' }).click();
    await page.waitForSelector('.modal-overlay textarea');
    await page.locator('.modal-overlay textarea').fill('Task,Status,Budget,Owner,Next step\nAudit A,Done,100,Zed,2026-11-01\nAudit B,To do,250,Mina,2026-11-08');
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Use this text' }).click();
    await page.waitForSelector('.modal-overlay select', { timeout: 3000 });
    const inferred = await page.$$eval('.modal-overlay select', ns => ns.map(n => n.value));
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Continue' }).click();
    await page.waitForTimeout(320);
    const modes = await page.$$eval('.dlg-choice-name', ns => ns.map(n => n.textContent));
    await page.locator('.dlg-choice', { hasText: 'Append to' }).click();
    await page.waitForTimeout(280);
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Import' }).click();
    await page.waitForTimeout(550);
    const after = await store('s.table().rows.length');
    const made = await store('s.table().rows[31].cells.f_budget');
    ok(after === before + 2, 'rows ' + before + ' → ' + after);
    ok(inferred.indexOf('singleSelect') !== -1 && inferred.indexOf('number') !== -1 && inferred.indexOf('date') !== -1, 'inferred ' + JSON.stringify(inferred));
    return 'inference ' + JSON.stringify(inferred) + '; ' + modes.length + ' modes; ' + before + ' → ' + after + ' rows, row 32 budget ' + made;
  });
  await check('panel: import wizard file picker reads a real CSV', async () => {
    const fs = require('fs');
    const tmp = '/tmp/suite-leads.csv';
    fs.writeFileSync(tmp, 'Task,Status,Budget\nFrom file,Done,900\nSecond row,To do,1200\n');
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Import' }).click();
    await page.waitForSelector('.dlg-choice');
    await page.locator('.dlg-choice', { hasText: 'Excel or ODS file' }).click();
    await page.waitForSelector('.modal-overlay input[type=file]');
    await page.locator('.modal-overlay input[type=file]').setInputFiles(tmp);
    await page.waitForTimeout(550);
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Continue' }).click();
    await page.waitForTimeout(320);
    await page.locator('.dlg-choice', { hasText: 'Create a new table' }).click();
    await page.waitForTimeout(280);
    await page.locator('.modal-overlay .ob-input').last().fill('From file');
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Import' }).click();
    await page.waitForTimeout(550);
    const name = await store('s.table().name');
    const rows = await store('s.table().rows.length');
    ok(name === 'From file' && rows === 2, name + ' with ' + rows + ' rows');
    return 'picked file → preview → created table “' + name + '” with ' + rows + ' rows';
  });
  await check('panel: wizard skips a column, overrides a type, warns above 250 rows', async () => {
    await st(() => TF.dialogs.importWizard(TF.harness.ctx(), { matrix: TF.data.bigSheetMatrix(), fileName: 'big.csv' }));
    await page.waitForTimeout(450);
    const warn = await page.locator('.modal-overlay .ob-banner.is-warn').count();
    const warnText = warn ? await page.locator('.modal-overlay .ob-banner.is-warn').innerText() : '';
    const cols = await page.locator('.modal-overlay .ob-check').count();
    await page.locator('.modal-overlay .ob-check').nth(2).click();
    await page.waitForTimeout(320);
    await page.locator('.modal-overlay select').nth(1).selectOption('text');
    await page.waitForTimeout(320);
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Continue' }).click();
    await page.waitForTimeout(320);
    await page.locator('.dlg-choice', { hasText: 'Create a new table' }).click();
    await page.waitForTimeout(280);
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Import' }).click();
    await page.waitForTimeout(800);
    const out = await store('({ rows: s.table().rows.length, name: s.table().name, second: s.table().fields[1].type })');
    ok(warn === 1 && /250/.test(warnText), 'warning banner missing: ' + warnText.slice(0, 60));
    ok(out.rows === 412 && out.name === 'big', JSON.stringify(out));
    ok(out.second === 'text', 'type override ignored: field 2 is ' + out.second);
    return 'warning shown above 250 rows (' + cols + ' columns offered, one skipped, one retyped) → ' + out.rows + ' rows, field 2 = ' + out.second;
  });
  await check('panel: import replace keeps undo honest', async () => {
    const before = await store('s.table().rows.length');
    await st(() => TF.dialogs.importWizard(TF.harness.ctx(), { matrix: TF.io.parseCSV(TF.data.SAMPLE_CSV), fileName: 'leads.csv' }));
    await page.waitForTimeout(450);
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Continue' }).click();
    await page.waitForTimeout(320);
    await page.locator('.dlg-choice', { hasText: 'Replace' }).click();
    await page.waitForTimeout(280);
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Import' }).click();
    await page.waitForTimeout(550);
    const replaced = await store('s.table().rows.length');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    const restored = await store('s.table().rows.length');
    ok(replaced === 13 && restored === before, before + ' → ' + replaced + ' → undo → ' + restored);
    return before + ' rows → replaced with 13 → one Ctrl+Z → ' + restored;
  });
  await check('panel: export writes CSV, XLSX, Markdown, JSON and copies TSV', async () => {
    const out = [];
    const download = async () => {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }), page.locator('.modal-overlay .ob-btn.is-primary').click()]);
      const buf = await d.createReadStream().then(s => new Promise(r => { const c = []; s.on('data', x => c.push(x)); s.on('end', () => r(Buffer.concat(c))); }));
      return d.suggestedFilename() + ' (' + buf.length + 'B' + (buf.slice(0, 2).toString() === 'PK' ? ', PK' : '') + ')';
    };
    for (const label of ['CSV', 'Excel', 'Markdown', 'JSON']) {
      await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Export' }).click();
      await page.waitForSelector('.modal-overlay .dlg-choice');
      await page.locator('.modal-overlay .dlg-choice', { hasText: label }).first().click();
      await page.waitForTimeout(220);
      out.push(label + ' → ' + await download());
      await page.waitForTimeout(200);
    }
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Export' }).click();
    await page.waitForSelector('.modal-overlay .dlg-choice');
    await page.locator('.modal-overlay .dlg-choice', { hasText: 'TSV' }).first().click();
    await page.waitForTimeout(220);
    await page.locator('.modal-overlay .ob-btn.is-primary').click();
    await page.waitForTimeout(350);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    out.push('TSV → ' + clip.split('\n').length + ' rows on the clipboard');
    ok(out.length === 5, 'only ' + out.length + ' exports ran');
    return out.join(' · ');
  });
  await check('panel: sync link → diff → pull writes upstream rows', async () => {
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'Sync' }).click();
    await page.waitForSelector('.modal-overlay');
    await page.locator('.modal-overlay .ob-btn.is-primary').first().click();
    await page.waitForTimeout(650);
    const stats = await page.$$eval('.modal-overlay .dlg-stat-num', ns => ns.map(n => n.textContent));
    const before = await store('s.table().rows.length');
    await page.locator('.modal-overlay .tablify-btn', { hasText: 'Pull' }).first().click();
    await page.waitForTimeout(1300);
    const afterPull = await store('s.table().rows.length');
    const pulled = await store('s.table().rows.some(r => r.cells.f_notes === "Added upstream after the fork.")');
    ok(stats.length >= 3 && afterPull > before, 'stats ' + JSON.stringify(stats) + ' rows ' + before + '→' + afterPull);
    return 'stats ' + JSON.stringify(stats) + '; rows ' + before + ' → ' + afterPull + '; upstream-only row landed: ' + pulled;
  });
  await check('panel: conflict review resolves per field', async () => {
    await st(() => { TF.sync.seedDemo(TF.store); TF.harness.ctx().grid.render(); });
    const diff = await st(() => TF.sync.computeDiff(TF.store.table(), TF.store.get().syncState));
    await st(() => TF.dialogs.syncPanel(TF.harness.ctx()));
    await page.waitForSelector('.modal-overlay', { timeout: 3000 });
    await page.locator('.modal-overlay .tablify-btn', { hasText: 'Review' }).click();
    await page.waitForTimeout(550);
    const conflicts = await page.locator('.modal-overlay .dlg-conflict-row.is-conflict').count();
    const before = await store('s.rowById("r3").cells.f_budget');
    await page.locator('.modal-overlay .dlg-conflict-row.is-conflict .tablify-btn').last().click();
    await page.waitForTimeout(280);
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Apply my choices' }).click();
    await page.waitForTimeout(750);
    const after = await store('s.rowById("r3").cells.f_budget');
    const left = await st(() => TF.sync.computeDiff(TF.store.table(), TF.store.get().syncState).conflicts.length);
    ok(conflicts >= 1 && before === 5150 && after === 9000, conflicts + ' conflict(s), ' + before + ' → ' + after);
    return conflicts + ' conflict offered (diff found ' + diff.conflicts.length + '); r3 budget ' + before + ' → ' + after + '; conflicts left: ' + left;
  });
  await check('panel: simulated sync failure changes nothing', async () => {
    await st(() => { TF.sync.seedDemo(TF.store); TF.dialogs.syncPanel(TF.harness.ctx()); });
    await page.waitForSelector('.modal-overlay');
    await page.locator('.modal-overlay input[type=checkbox]').first().check();
    const before = await store('JSON.stringify(s.get().syncState.snapshot).length');
    const valueBefore = await store('s.rowById("r3").cells.f_budget');
    await page.locator('.modal-overlay .tablify-btn', { hasText: 'Pull' }).first().click();
    await page.waitForTimeout(1500);
    const banner = await page.locator('.modal-overlay .ob-banner.is-warn').first().innerText();
    const after = await store('JSON.stringify(s.get().syncState.snapshot).length');
    const valueAfter = await store('s.rowById("r3").cells.f_budget');
    ok(before === after && valueBefore === valueAfter, 'state changed on a failed request');
    return '“' + banner.replace(/\s+/g, ' ').slice(0, 74) + '” — snapshot + row untouched';
  });
  await check('panel: stacked .tabula screen keeps its wide top scrollbar', async () => {
    await page.locator('.harness-btn', { hasText: '.tabula' }).nth(0).click();
    await page.waitForSelector('#legacy-host .legacy-table', { timeout: 3000 });
    const tables = await page.locator('#legacy-host .legacy-table').count();
    const inner = await page.locator('#legacy-host .legacy-scroll').first().evaluate(n => ({ w: n.scrollWidth, vw: n.clientWidth }));
    await page.locator('#legacy-host .legacy-topscroller').evaluate(n => { n.scrollLeft = 220; n.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(320);
    const follows = await page.locator('#legacy-host .legacy-scroll').first().evaluate(n => n.scrollLeft);
    ok(tables >= 2 && inner.w > inner.vw && Math.abs(follows - 220) <= 2, 'tables=' + tables + ' inner=' + JSON.stringify(inner) + ' follows=' + follows);
    await page.locator('.harness-btn', { hasText: 'Settings' }).click();
    await page.waitForSelector('#settings-host .set-row', { timeout: 3000 });
    await page.locator('#settings-host .set-row', { hasText: 'Top horizontal scrollbar' }).locator('input.ob-check').click();
    await page.locator('.harness-btn', { hasText: '.tabula' }).nth(0).click();
    await page.waitForSelector('#legacy-host .legacy-table', { timeout: 3000 });
    const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('#legacy-host .legacy-topscroller')).display);
    ok(hidden === 'none', 'the setting did not hide the bar: ' + hidden);
    return tables + ' stacked tables; widest ' + inner.w + 'px in ' + inner.vw + 'px; top bar 220px → tables follow (' + follows + '); switching the setting off hides it';
  });
  await check('panel: .tabula corrupt file reports the raw problem', async () => {
    await page.locator('.harness-btn', { hasText: '.tabula' }).nth(0).click();
    await page.waitForSelector('#legacy-host .legacy-table', { timeout: 3000 });
    await page.locator('#legacy-host .tablify-btn', { hasText: 'corrupt' }).click();
    await page.waitForTimeout(400);
    const warn = await page.locator('#legacy-host .ob-banner.is-warn').innerText();
    const raw = await page.locator('#legacy-host pre').count();
    const noTables = await page.locator('#legacy-host .legacy-table').count();
    ok(/unknown type|no cells object/.test(warn) && raw === 1 && noTables === 0, warn.slice(0, 60) + ' raw=' + raw + ' tables=' + noTables);
    return '“' + warn.replace(/\s+/g, ' ').slice(0, 90) + '” + raw JSON shown, 0 tables rendered';
  });
  await check('panel: .tabula migration is gated, then writes a new table', async () => {
    await page.locator('.harness-btn', { hasText: '.tabula' }).nth(0).click();
    await page.waitForSelector('#legacy-host .legacy-table', { timeout: 3000 });
    const sig = await st(() => JSON.stringify(TF.legacy.docById('v2').tables.map(t => [t.name, t.rows.length])));
    await page.locator('#legacy-host .ob-btn', { hasText: 'Migrate' }).first().click();
    await page.waitForSelector('.modal-overlay', { timeout: 3000 });
    const stats = await page.$$eval('.modal-overlay .dlg-stat-num', ns => ns.map(n => n.textContent));
    const tablesBefore = await store('s.get().tables.length');
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Migrate' }).click();
    await page.waitForTimeout(450);
    const blocked = await store('s.get().tables.length');
    const toast = await page.locator('.toast').first().innerText();
    await page.locator('.modal-overlay #tf-dry-write').check();
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Migrate' }).click();
    await page.waitForTimeout(650);
    const out = await store('({ tables: s.get().tables.length, migrations: s.get().migrations.length })');
    const sig2 = await st(() => JSON.stringify(TF.legacy.docById('v2').tables.map(t => [t.name, t.rows.length])));
    ok(blocked === tablesBefore, 'migration ran without the confirmation box');
    ok(/confirmation/i.test(toast), 'no gate toast: ' + toast);
    ok(out.tables === 2 && out.migrations === 1 && sig === sig2, JSON.stringify(out) + ' source changed: ' + (sig !== sig2));
    return 'stats ' + JSON.stringify(stats) + '; gate blocked with “' + toast.slice(0, 30) + '” → confirmed → ' + out.tables + ' tables, ' + out.migrations + ' logged, source .tabula untouched';
  });
  await check('panel: settings rows respond and the token is never stored', async () => {
    await page.locator('.harness-btn', { hasText: 'Settings' }).click();
    await page.waitForSelector('#settings-host .set-row', { timeout: 3000 });
    const rows = await page.locator('#settings-host .set-row').count();
    const autosaveBefore = await store('s.get().settings.autosave');
    await page.locator('#settings-host input.ob-check').first().click();
    await page.waitForTimeout(220);
    const autosaveAfter = await store('s.get().settings.autosave');
    const num = page.locator('#settings-host input[type=number]').first();
    await num.fill('500');
    await num.press('Enter');
    await page.waitForTimeout(280);
    const threshold = await store('s.get().settings.threshold');
    await page.locator('#settings-host .ob-btn', { hasText: 'token' }).first().click();
    await page.waitForSelector('.modal-overlay input', { timeout: 3000 });
    await page.locator('.modal-overlay input').fill('pat-demo-value');
    await page.locator('.modal-overlay .ob-btn', { hasText: 'Save' }).click();
    await page.waitForTimeout(450);
    const tok = await store('({ stored: s.get().settings.token, flag: s.get().settings.tokenSet })');
    ok(rows >= 12 && autosaveAfter !== autosaveBefore && threshold === 500, rows + ' rows, autosave ' + autosaveBefore + '→' + autosaveAfter + ', threshold ' + threshold);
    ok(tok.flag === true && !tok.stored, 'token handling: ' + JSON.stringify(tok));
    return rows + ' setting rows; autosave flips; threshold 500; token kept as a flag only (stored value “' + tok.stored + '”)';
  });
  await check('panel: harness theme, phone squeeze, +400 rows and reset', async () => {
    await page.locator('.harness-btn', { hasText: 'Dark' }).click();
    await page.waitForTimeout(280);
    const dark = await st(() => document.getElementById('window').classList.contains('theme-dark'));
    const bg = await st(() => getComputedStyle(document.querySelector('.tablify-root')).backgroundColor);
    const fg = await st(() => getComputedStyle(document.querySelector('.tablify-root')).color);
    await page.locator('.harness-btn', { hasText: 'Phone' }).click();
    await page.waitForTimeout(320);
    const w = await st(() => Math.round(document.getElementById('window').getBoundingClientRect().width));
    await page.locator('.harness-btn', { hasText: '+400' }).click();
    await page.waitForTimeout(450);
    const rows = await store('s.table().rows.length');
    await page.locator('.harness-btn', { hasText: 'Reset' }).click();
    await page.waitForTimeout(550);
    const after = await store('s.table().rows.length');
    ok(dark && w === 389 && rows === 430 && after === 30, 'dark=' + dark + ' w=' + w + ' rows=' + rows + ' reset=' + after);
    return 'dark theme (' + bg + ' on ' + fg + '), 389px, +400 → ' + rows + ' rows, reset → ' + after;
  });
  await check('panel: 5,000 rows stay interactive and windowed', async () => {
    await page.locator('.harness-btn', { hasText: 'Perf' }).click();
    await page.waitForTimeout(800);
    const mounted = await page.locator('.cell').count();
    const total = await store('s.table().rows.length');
    const t0 = Date.now();
    await page.locator('.tablify-rows .cell[data-field-id="f_owner"]').first().dblclick();
    await page.waitForSelector('.cell-editor', { timeout: 3000 });
    await page.keyboard.press('Escape');
    const openMs = Date.now() - t0;
    const box = await page.locator('.tablify-rows .cell').first().boundingBox();
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(450);
    const scrolled = await st(() => document.querySelector('.tablify-scroller').scrollTop);
    const mountedAfter = await page.locator('.cell').count();
    const rowRange = await st(() => { const ns = document.querySelectorAll('.tablify-rows .cell'); return ns.length ? ns[0].dataset.r + '…' + ns[ns.length - 1].dataset.r : '?'; });
    ok(mounted < 1200 && mountedAfter < 1200 && scrolled > 1000, 'mounted ' + mounted + '/' + mountedAfter + ' scrolled ' + scrolled);
    return total.toLocaleString() + ' rows, ' + mounted + ' cells mounted → ' + scrolled + 'px down, still ' + mountedAfter + ' (rows ' + rowRange + '); editor opened in ' + openMs + 'ms';
  });

  /* ══════════════════ narrow panes drop the pinned column ══════════════════ */
  const narrowState = () => st(() => {
    const q = s => document.querySelector(s);
    const rows = q('.tablify-rows');
    const row = rows && rows.querySelector('.grid-row');
    const head = q('.tablify-header .hcell');
    const g = window.TF.harness.ctx().grid;
    return {
      narrow: q('.tablify-root').classList.contains('is-narrow'),
      frozen: q('.tablify-frozen') ? getComputedStyle(q('.tablify-frozen')).display : null,
      corner: q('.tablify-corner') ? getComputedStyle(q('.tablify-corner')).display : null,
      firstChild: row && row.firstElementChild ? row.firstElementChild.className.split(' ')[0] : null,
      firstCellC: row && row.querySelector('.cell') ? row.querySelector('.cell').dataset.c : null,
      headName: head && head.querySelector('.hcell-name') ? head.querySelector('.hcell-name').textContent : null,
      headField: head ? (head.dataset.fieldId || null) : null,
      laneWidth: g.laneWidth(),
      gutterInline: g.gutterInline(),
      frozenCellX: (() => { const c = q('.tablify-frozen .cell'); return c ? Math.round(c.getBoundingClientRect().x) : null; })(),
      dataCellX: (() => { const c = rows && rows.querySelector('.cell'); return c ? Math.round(c.getBoundingClientRect().x) : null; })(),
    };
  });

  await check('narrow pane: nothing stays pinned and the columns come into view', async () => {
    await page.locator('.harness-btn', { hasText: 'Phone' }).click();
    await page.waitForTimeout(400);
    const a = await narrowState();
    /* the whole point: at 389 px the pinned strip used to eat the pane, so this is
       where a data column has to be visible at scrollLeft > 0 */
    await page.evaluate(() => { document.querySelector('.tablify-scroller').scrollLeft = 400; });
    await page.waitForTimeout(280);
    const left = await st(() => {
      const rows = document.querySelector('.tablify-rows');
      const b = rows.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + 6, b.top + 12);
      const cell = hit && hit.closest ? hit.closest('.cell') : null;
      const lane = document.querySelector('.tablify-rows .lane');
      const fields = window.TF.store.visibleFields();
      return { field: cell ? cell.dataset.fieldId : null, c: cell ? cell.dataset.c : null,
               lane: lane ? lane.offsetWidth : 0,
               sum: fields.reduce((n, f) => n + f.width, 0),
               scrollingSum: fields.filter(f => !f.primary).reduce((n, f) => n + f.width, 0) };
    });
    ok(a.narrow && a.frozen === 'none' && a.corner === 'none' && a.gutterInline && a.firstChild === 'gutter' &&
       a.firstCellC === '1' && a.headName === '#' && !a.headField,
      'narrow=' + a.narrow + ' frozen=' + a.frozen + ' firstChild=' + a.firstChild + ' header=“' + a.headName + '”');
    ok(left.field === 'f_status' && left.c === '2', 'leftmost visible at scrollLeft 400: ' + left.c + '/' + left.field);
    ok(left.lane === left.sum + 74, 'lane ' + left.lane + 'px = ' + left.sum + ' + 74 gutter');
    return '389px: frozen+corner hidden, gutter rides in the lane (first child), lane ' + left.lane +
      'px, scrollLeft 400 → leftmost column ' + left.c + ' (' + left.field + '), header cell “' + a.headName + '”';
  });

  await check('narrow pane: the freeze setting is not offered anywhere', async () => {
    await page.locator('.harness-btn', { hasText: 'Phone' }).click();
    await page.waitForTimeout(400);
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'View' }).first().click();
    await page.waitForSelector('.modal-overlay');
    await page.waitForTimeout(200);
    const dlgText = await page.locator('.modal-overlay').innerText();
    const sub = await page.locator('.modal-overlay .settings-sub').first().innerText();
    const toggles = await page.locator('.modal-overlay .ob-check').count();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(160);
    await page.locator('.tablify-toolbar .tablify-btn', { hasText: '⋯' }).first().click();
    await page.waitForSelector('.menu .menu-item', { timeout: 3000 });
    const labels = await page.$$eval('.menu .menu-item', ns => ns.map(n => n.textContent.replace(/[✓▸]/g, '').trim()));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(160);
    ok(!/Freeze primary column/.test(dlgText) && !/frozen primary/.test(sub) &&
       !labels.some(l => /Freeze the primary/.test(l)), 'dialog: ' + JSON.stringify(sub) + ' · menu has ' + labels.length + ' entries');
    return 'View settings: no freeze row (' + toggles + ' checkboxes left), subtitle “' + sub + '”; ⋯ menu: ' + labels.length +
      ' entries, no freeze item';
  });

  await check('wide pane: the primary column is still pinned (regression guard)', async () => {
    const before = await narrowState();
    const wide = await st(() => {
      const q = s => document.querySelector(s);
      const lane = q('.tablify-rows .lane');
      const fields = window.TF.store.visibleFields();
      const frozenField = q('.tablify-frozen .cell');
      return { lane: lane ? lane.offsetWidth : 0,
               scrollingSum: fields.filter(f => !f.primary).reduce((n, f) => n + f.width, 0),
               frozenField: frozenField ? frozenField.dataset.fieldId : null };
    });
    await page.evaluate(() => { document.querySelector('.tablify-scroller').scrollLeft = 700; });
    await page.waitForTimeout(280);
    const after = await narrowState();
    ok(!before.narrow && before.frozen === 'block' && before.corner === 'block' && !before.gutterInline &&
       before.firstChild === 'cell' && before.firstCellC === '2' && wide.frozenField === 'f_task' &&
       wide.lane === wide.scrollingSum && after.frozenCellX === before.frozenCellX &&
       after.dataCellX === before.dataCellX - 700,
      'wide: lane ' + wide.lane + ' = ' + wide.scrollingSum + ' (scrolling columns only, no inline gutter)');
    return '1280px: strip “' + wide.frozenField + '” pinned (x ' + before.frozenCellX + ' → ' + after.frozenCellX +
      ' after 700px), data columns moved 700px, lane = the columns only (' + wide.lane + 'px)';
  });

  await check('threshold: crossing it re-pins live, without a reload', async () => {
    const wide = await narrowState();
    await page.locator('.harness-btn', { hasText: 'Phone' }).click();
    await page.waitForTimeout(420);
    const phone = await narrowState();
    await page.locator('.harness-btn', { hasText: 'Desktop' }).click();   /* squeeze off again */
    await page.waitForTimeout(420);
    const back = await narrowState();
    ok(!wide.narrow && phone.narrow && !back.narrow && phone.frozen === 'none' && back.frozen === 'block' &&
       phone.firstChild === 'gutter' && back.firstChild === 'cell',
      [wide.narrow, phone.narrow, back.narrow].join('/'));
    return 'desktop → 389px → desktop, no reload: ' +
      [wide.narrow ? 'narrow' : 'pinned', phone.narrow ? 'narrow' : 'pinned', back.narrow ? 'narrow' : 'pinned'].join(' → ') +
      ' (gutter ' + [wide.firstChild, phone.firstChild, back.firstChild].join('/') + ')';
  });

  /* ══════════════════ tokens, theme scoping, focus ══════════════════ */
  await check('theme: the identity palette is the default, dark reaches the portalled surfaces', async () => {
    const read = () => st(() => {
      const q = s => document.querySelector(s);
      const html = document.documentElement;
      return {
        attr: html.getAttribute('data-tablify-theme'),
        dark: html.classList.contains('theme-dark'),
        grid: getComputedStyle(q('.tablify-root')).backgroundColor,
        surfaceVar: getComputedStyle(html).getPropertyValue('--tablify-surface').trim(),
        modal: q('.modal') ? getComputedStyle(q('.modal')).backgroundColor : null,
        modalFg: q('.modal') ? getComputedStyle(q('.modal')).color : null,
        overlay: q('.modal-overlay') ? getComputedStyle(q('.modal-overlay')).backgroundColor : null,
        menu: q('.menu') ? getComputedStyle(q('.menu')).backgroundColor : null,
        toast: q('.toast') ? getComputedStyle(q('.toast')).backgroundColor + ' / ' + getComputedStyle(q('.toast')).color : null,
      };
    });
    const lum = c => { const m = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
      .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return +(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]).toFixed(3); };
    const openSurfaces = async () => {
      const out = {};
      await page.locator('.tablify-toolbar .tablify-btn', { hasText: 'View' }).first().click();
      await page.waitForSelector('.modal-overlay'); await page.waitForTimeout(200);
      Object.assign(out, await read());                      /* dialog + overlay */
      await page.keyboard.press('Escape'); await page.waitForTimeout(180);
      await page.locator('.tablify-toolbar .tablify-btn').first().click();
      await page.waitForSelector('.menu .menu-item'); await page.waitForTimeout(120);
      out.menu = await st(() => getComputedStyle(document.querySelector('.menu')).backgroundColor);
      await page.keyboard.press('Escape'); await page.waitForTimeout(160);
      await page.evaluate(() => { window.TF.toast.show('audit'); });
      await page.waitForTimeout(150);
      out.toast = await st(() => { const t = document.querySelector('.toast');
        return t ? getComputedStyle(t).backgroundColor + ' / ' + getComputedStyle(t).color : null; });
      await page.evaluate(() => document.querySelectorAll('.toast').forEach(n => n.remove()));
      return out;
    };
    const light = await openSurfaces();
    await page.locator('.harness-btn', { hasText: 'Dark' }).click(); await page.waitForTimeout(240);
    const dark = await openSurfaces();
    await page.locator('.harness-btn', { hasText: 'Follow my Obsidian theme' }).click(); await page.waitForTimeout(240);
    const host = await openSurfaces();
    const hostBg = await st(() => getComputedStyle(document.documentElement).getPropertyValue('--background-primary').trim());
    const rgb = h => { const n = h.replace('#', ''); return 'rgb(' + [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16)).join(', ') + ')'; };
    ok(light.attr === 'identity' && !light.dark, 'light default: attr=' + light.attr + ' dark=' + light.dark);
    ok(light.modal !== null && light.overlay !== null && light.menu !== null,
      'surfaces missing: modal=' + light.modal + ' menu=' + light.menu);
    ok(light.grid === 'rgb(250, 246, 240)' && light.modal === 'rgb(255, 253, 249)' && light.menu === 'rgb(255, 253, 249)',
      'identity light: grid ' + light.grid + ', dialog ' + light.modal + ', menu ' + light.menu);
    ok(dark.dark && dark.modal && lum(dark.modal) < 0.05 && lum(dark.grid) < 0.05,
      'dark: html has theme-dark=' + dark.dark + ', dialog ' + dark.modal + ' (lum ' + (dark.modal && lum(dark.modal)) + ')');
    ok(dark.menu && lum(dark.menu) < 0.05 && dark.toast && lum(dark.toast.split(' / ')[0]) > 0.5,
      'dark menu ' + dark.menu + ', toast ' + dark.toast);
    const hostRaised = await st(() => getComputedStyle(document.documentElement).getPropertyValue('--background-secondary').trim());
    ok(host.attr === 'host' && host.grid === rgb(hostBg) && host.modal === rgb(hostRaised),
      'host mode: attr=' + host.attr + ' grid ' + host.grid + ' vs --background-primary ' + hostBg +
      ', dialog ' + host.modal + ' vs --background-secondary ' + hostRaised);
    return 'identity light grid ' + light.grid + ' / dialog ' + light.modal + '; dark dialog ' + dark.modal +
      ' (lum ' + lum(dark.modal) + '), menu ' + dark.menu + '; host mode grid ' + host.grid + ' = --background-primary ' + hostBg;
  });

  await check('focus: one clay ring for the keyboard, nothing on a mouse click', async () => {
    const probe = () => st(() => {
      const a = document.activeElement; const s = getComputedStyle(a);
      const html = getComputedStyle(document.documentElement);
      return { cls: (a.className || a.tagName).toString(), style: s.outlineStyle,
        w: parseFloat(s.outlineWidth), color: s.outlineColor, off: parseFloat(s.outlineOffset),
        token: html.getPropertyValue('--tablify-focus').trim() };
    });
    const rgb = h => { const n = h.replace('#', ''); return 'rgb(' + [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16)).join(', ') + ')'; };
    let ring = null;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      ring = await probe();
      if (await st(() => document.activeElement.classList.contains('tablify-root'))) break;
    }
    ok(ring && ring.style === 'solid' && ring.w >= 2 && ring.off >= 1, 'keyboard: ' + JSON.stringify(ring));
    ok(ring.color === rgb(ring.token), 'ring ' + ring.color + ' vs --tablify-focus ' + ring.token);
    /* a mouse click must not paint it — a real click, because .click() never moves focus */
    await page.locator('.tablify-toolbar .tablify-btn').first().click();
    const clicked = await st(() => { const a = document.activeElement; const s = getComputedStyle(a);
      return (a.className || a.tagName) + ' → ' + s.outlineStyle + ' ' + s.outlineWidth; });
    ok(/→ none/.test(clicked), 'mouse click painted ' + clicked);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.locator('.harness-btn', { hasText: 'Dark' }).click(); await page.waitForTimeout(240);
    let darkRing = null;                       /* again by real keyboard traversal: a programmatic
                                                  focus() after a click does not match :focus-visible */
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if (await st(() => document.activeElement.classList.contains('tablify-root'))) { darkRing = await probe(); break; }
    }
    ok(darkRing && darkRing.style === 'solid' && darkRing.color === rgb(darkRing.token) && darkRing.color !== ring.color,
      'dark ring ' + JSON.stringify(darkRing));
    return 'keyboard → ' + ring.style + ' ' + ring.w + 'px ' + ring.color + ' offset ' + ring.off +
      '; mouse click → ' + clicked + '; dark ring ' + darkRing.color + ' (token ' + darkRing.token + ')';
  });

  await check('tokens: one file owns every colour, no !important, no stray ring suppression', async () => {
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '..', 'css');
    const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '');   /* a comment can never trip a gate */
    const read = f => strip(fs.readFileSync(path.join(dir, f), 'utf8'));
    const tokens = read('tokens.css'), owners = { 'tokens.css': tokens, 'tablify.css': read('tablify.css'), 'obsidian.css': read('obsidian.css') };
    const declared = {};
    Object.keys(owners).forEach(f => { declared[f] = (owners[f].match(/--tablify-[\w-]+\s*:/g) || []).length; });
    ok(declared['tokens.css'] > 20 && declared['tablify.css'] === 0 && declared['obsidian.css'] === 0, JSON.stringify(declared));
    const bang = Object.keys(owners).filter(f => /!important/.test(owners[f]));
    ok(!bang.length, '!important in ' + bang.join(', '));
    const known = new Set((tokens.match(/--tablify-[\w-]+/g) || []));
    const missing = new Set();
    ['tablify.css', 'obsidian.css'].forEach(f => (owners[f].match(/var\((--tablify-[\w-]+)/g) || [])
      .forEach(m => { const n = m.replace('var(', ''); if (!known.has(n)) missing.add(n); }));
    ok(!missing.size, 'referenced but never declared: ' + Array.from(missing).join(', '));
    const supp = (owners['tablify.css'].match(/outline:\s*none/g) || []).length;
    const suppHost = (owners['obsidian.css'].match(/outline:\s*none/g) || []).length;
    ok(supp === 1 && suppHost === 0, 'outline:none — tablify.css ' + supp + ', obsidian.css ' + suppHost);
    return declared['tokens.css'] + ' tokens owned by tokens.css, 0 elsewhere; 0 !important; every var() resolves; ' +
      '1 documented outline:none (.cell-editor)';
  });

  /* ══════════════════ motion: the frequency table, enforced ══════════════════ */
  await check('motion: occasional surfaces animate briefly, frequent ones never do', async () => {
    const mctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'no-preference' });
    const mp = await mctx.newPage();
    const mErrs = []; mp.on('pageerror', e => mErrs.push(e.message));
    await mp.goto(URL); await mp.waitForSelector('.tablify-root .cell'); await mp.waitForTimeout(300);
    const running = () => mp.evaluate(() => document.getAnimations().map(a => ({
      target: (a.effect.target.className || a.effect.target.tagName).toString(),
      prop: a.transitionProperty || a.animationName,
      dur: a.effect.getTiming().duration })));
    /* the surfaces a user sees thousands of times a day */
    const frequent = await mp.evaluate(() => ['.cell', '.grid-row', '.hcell', '.tablify-toolbar', '.tablify-statusbar']
      .map(sel => sel + '=' + getComputedStyle(document.querySelector(sel)).transitionDuration).join(' '));
    /* a menu is opened dozens of times an hour: it must be instant */
    await mp.locator('.tablify-toolbar .tablify-btn').first().click();
    await mp.waitForSelector('.menu .menu-item');
    const menuAnims = (await running()).filter(a => a.target.indexOf('menu') !== -1).length;
    await mp.keyboard.press('Escape'); await mp.waitForTimeout(160);
    /* a dialog is occasional: 240 ms in, nothing left running, 160 ms out */
    await mp.locator('.tablify-toolbar .tablify-btn', { hasText: 'View' }).first().click();
    await mp.waitForSelector('.modal-overlay');
    const enter = await running();
    await mp.waitForTimeout(340);
    const settled = await running();
    await mp.keyboard.press('Escape');
    const exit = await running();
    const pe = await mp.evaluate(() => getComputedStyle(document.querySelector('.modal-overlay')).pointerEvents);
    await mp.waitForTimeout(280);
    const gone = await mp.evaluate(() => !document.querySelector('.modal-overlay'));
    /* press feedback: a real mousedown, measured while the transition runs */
    await mp.locator('.tablify-toolbar .tablify-btn', { hasText: 'View' }).first().click();
    await mp.waitForSelector('.modal-overlay'); await mp.waitForTimeout(300);
    const box = await mp.locator('.modal-overlay .ob-btn').first().boundingBox();
    await mp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await mp.mouse.down(); await mp.waitForTimeout(110);
    const pressed = await mp.evaluate(() => getComputedStyle(document.querySelector('.modal-overlay .ob-btn')).transform);
    await mp.mouse.up(); await mp.waitForTimeout(240);
    const released = await mp.evaluate(() => getComputedStyle(document.querySelector('.modal-overlay .ob-btn')).transform);
    await mp.keyboard.press('Escape'); await mp.waitForTimeout(280);
    /* a popover enters from the cell that opened it */
    await mp.locator('.tablify-rows .cell[data-field-id="f_conf"]').first().dblclick();
    await mp.waitForSelector('.pop span');
    const popAnims = await running();
    const popOrigin = await mp.evaluate(() => getComputedStyle(document.querySelector('.pop')).transformOrigin);
    await mp.keyboard.press('Escape'); await mp.waitForTimeout(160);
    /* the toast fade is real now: 260 ms in, leaving at ~2.3 s, gone by ~2.5 s */
    await mp.evaluate(() => window.TF.toast.show('motion check'));
    await mp.waitForTimeout(80);
    const toastAnims = (await running()).filter(a => a.target.indexOf('toast') !== -1);
    await mp.waitForTimeout(2280);
    const leaving = await mp.evaluate(() => { const t = document.querySelector('.toast');
      return t ? t.className + '|' + getComputedStyle(t).opacity : null; });
    await mp.waitForTimeout(420);
    const toastGone = await mp.evaluate(() => !document.querySelector('.toast'));
    await mctx.close();
    const has = (list, target, prop, dur) => list.some(a => a.target.indexOf(target) !== -1 && a.prop === prop && a.dur === dur);
    ok(/\.cell=0s .grid-row=0s .hcell=0s .tablify-toolbar=0s .tablify-statusbar=0s/.test(frequent), 'frequent surfaces: ' + frequent);
    ok(menuAnims === 0, menuAnims + ' animations on the menu');
    ok(has(enter, 'modal-overlay', 'opacity', 240) && has(enter, 'modal', 'transform', 240), 'enter: ' + JSON.stringify(enter));
    ok(settled.length === 0, 'still animating after 340 ms: ' + JSON.stringify(settled));
    const exitModal = exit.filter(a => a.target.indexOf('modal') !== -1);
    ok(exitModal.length > 0 && exitModal.every(a => a.dur === 160), 'exit: ' + JSON.stringify(exit));
    ok(pe === 'none' && gone, 'closing overlay: pointer-events ' + pe + ', removed ' + gone);
    ok(/^matrix\(0\.9[0-9]/.test(pressed) && released === 'none', 'press: ' + pressed + ' → ' + released);
    ok(has(popAnims, 'pop', 'opacity', 160) && has(popAnims, 'pop', 'transform', 160), 'popover: ' + JSON.stringify(popAnims));
    ok(/px/.test(popOrigin), 'popover transform-origin: ' + popOrigin);
    ok(has(toastAnims, 'toast', 'opacity', 260) && has(toastAnims, 'toast', 'transform', 260), 'toast enter: ' + JSON.stringify(toastAnims));
    const leaveOpacity = leaving ? parseFloat(leaving.split('|')[1]) : null;   /* the exit is in flight */
    ok(leaving && /is-leaving/.test(leaving) && leaveOpacity < 1, 'toast at 2.3 s: ' + leaving);
    ok(toastGone && !mErrs.length, 'toast removed ' + toastGone + (mErrs.length ? ' errors ' + mErrs.join('; ') : ''));
    return 'menus instant (0 animations; the 120 ms entry in the exit sample is the button\'s own hover fade), dialog 240 ms in / 160 ms out with pointer-events none, press scale ' +
      pressed.replace(/matrix\(([\d.]+).*/, '$1') + ' → ' + released + ', popover 160 ms from ' + popOrigin +
      ', toast 260 ms in / 180 ms out, cells+rows+header+toolbar+statusbar ' + /0s/.test(frequent) + ' (0s)';
  });

  await check('motion: reduced motion removes movement and never delays the UI', async () => {
    const rctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    const rp = await rctx.newPage();
    const rErrs = []; rp.on('pageerror', e => rErrs.push(e.message));
    await rp.goto(URL); await rp.waitForSelector('.tablify-root .cell');
    const flag = await rp.evaluate(() => window.TF.motion.reduced());
    const toks = await rp.evaluate(() => ['--tablify-dur-modal', '--tablify-dur-toast', '--tablify-dur-press', '--tablify-enter-scale']
      .map(t => getComputedStyle(document.documentElement).getPropertyValue(t).trim()).join('/'));
    await rp.locator('.tablify-toolbar .tablify-btn', { hasText: 'View' }).first().click();
    const moving = await rp.evaluate(() => document.getAnimations().filter(a => a.effect.getTiming().duration > 0).length);
    const opened = await rp.evaluate(() => !!document.querySelector('.modal-overlay'));
    await rp.keyboard.press('Escape');
    const goneNow = await rp.evaluate(() => !document.querySelector('.modal-overlay'));
    await rp.evaluate(() => window.TF.toast.show('reduce check'));
    await rp.waitForTimeout(2300);
    const toastGone = await rp.evaluate(() => !document.querySelector('.toast'));
    await rctx.close();
    ok(flag === true, 'TF.motion.reduced() = ' + flag);
    ok(toks === '0ms/0ms/0ms/1', 'duration tokens under reduced motion: ' + toks);
    ok(moving === 0 && opened, moving + ' animations over 0 ms while the dialog opened (' + opened + ')');
    ok(goneNow, 'the dialog was not removed synchronously — the exit delay leaked into reduced motion');
    ok(toastGone && !rErrs.length, 'toast ' + toastGone + (rErrs.length ? ' errors ' + rErrs.join('; ') : ''));
    return 'reduced: durations ' + toks + ', 0 animations, dialog present immediately and removed in the same tick, toast removed with no exit';
  });

  /* ══════════════════ Advanced settings → Content ══════════════════ */
  await check('content: every switch under Advanced → Content starts on, and really hides content', async () => {
    const defaults = await store('[s.get().settings.showToolbar, s.get().settings.showStatusBar, s.get().settings.showGroupHeaders, s.get().settings.showSummaryRow, s.view().rowNumbers]');
    await page.locator('.harness-btn', { hasText: 'Settings' }).click();
    await page.waitForSelector('#settings-host .set-subgroup', { timeout: 3000 });
    const group = await page.evaluate(() => {
      const host = document.getElementById('settings-host');
      const label = host.querySelector('.set-subgroup');
      const titles = Array.from(host.querySelectorAll('.set-group-title')).map(t => t.textContent);
      const rows = []; let n = label.nextElementSibling;
      while (n && !n.classList.contains('set-group-title') && !n.classList.contains('set-subgroup')) {
        if (n.classList.contains('set-row')) rows.push(n.querySelector('.set-row-name').textContent + ':' + n.querySelector('input.ob-check').checked);
        n = n.nextElementSibling;
      }
      return { label: label.textContent, rows: rows, advanced: titles.indexOf('Advanced settings') };
    });
    ok(defaults.every(Boolean), 'one of the five defaults was off: ' + JSON.stringify(defaults));
    ok(group.label === 'Content' && group.advanced !== -1 && group.rows.length === 5 && group.rows.every(r => /:true$/.test(r)),
      'group "' + group.label + '" under "Advanced settings" (index ' + group.advanced + '): ' + JSON.stringify(group.rows));
    /* one switch driven from the UI, to prove the row is wired through the store */
    const toolbarBox = page.locator('#settings-host .set-row', { hasText: /^Toolbar/ }).first().locator('input.ob-check');
    await toolbarBox.uncheck();
    await page.waitForTimeout(240);
    const fromUi = await store('s.get().settings.showToolbar');
    await toolbarBox.check();
    await page.waitForTimeout(240);
    const backFromUi = await store('s.get().settings.showToolbar');
    ok(fromUi === false && backFromUi === true, 'the Toolbar row wrote ' + fromUi + ' then ' + backFromUi);
    await page.locator('.harness-btn', { hasText: 'Tablify grid' }).first().click();
    await page.waitForSelector('.tablify-rows .cell', { timeout: 3000 });
    /* the other four through the store, then look at the pixels */
    await page.evaluate(() => {
      const s = window.TF.store, g = window.TF.harness.ctx().grid;
      s.updateSettings({ showToolbar: false, showStatusBar: false, showSummaryRow: false, showGroupHeaders: false, rowNumbers: false });
      s.setView({ rowNumbers: false }, 'toggle gutters');
      s.setGroupBy('f_status');
      g.render();
    });
    await page.waitForTimeout(320);
    const off = await st(() => ({
      toolbar: getComputedStyle(document.querySelector('.tablify-toolbar')).display,
      status: getComputedStyle(document.querySelector('.tablify-statusbar')).display,
      summary: getComputedStyle(document.querySelector('.tablify-summary')).display,
      groupBars: document.querySelectorAll('.tablify-rows .group-bar').length,
      rows: document.querySelectorAll('.tablify-rows .grid-row').length,
      rowChecks: document.querySelectorAll('.tablify-root .gutter .checkbox').length,
      checkAll: document.querySelectorAll('.tablify-checkall').length,
      handles: document.querySelectorAll('.tablify-root .gutter-handle').length,
    }));
    ok(off.toolbar === 'none' && off.status === 'none' && off.summary === 'none', JSON.stringify(off));
    ok(off.groupBars === 0 && off.rows > 0, 'group headers off: ' + off.groupBars + ' bars, ' + off.rows + ' rows still there');
    ok(off.rowChecks === 0 && off.checkAll === 0, 'gutter content off: ' + off.rowChecks + ' row checkboxes, ' + off.checkAll + ' check-all');
    ok(off.handles > 0, 'the drag handle is structure and must survive: ' + off.handles);
    /* all of it back on */
    await page.evaluate(() => {
      const s = window.TF.store, g = window.TF.harness.ctx().grid;
      s.updateSettings({ showToolbar: true, showStatusBar: true, showSummaryRow: true, showGroupHeaders: true, rowNumbers: true });
      s.setView({ rowNumbers: true }, 'toggle gutters');
      g.render();
    });
    await page.waitForTimeout(320);
    const on = await st(() => ({
      toolbar: getComputedStyle(document.querySelector('.tablify-toolbar')).display,
      status: getComputedStyle(document.querySelector('.tablify-statusbar')).display,
      summary: document.querySelectorAll('.tablify-summary .summary-cell').length,
      groupBars: document.querySelectorAll('.tablify-rows .group-bar').length,
      rowChecks: document.querySelectorAll('.tablify-root .gutter .checkbox').length,
      rows: document.querySelectorAll('.tablify-rows .grid-row').length,
      lane: window.TF.harness.ctx().grid.laneWidth(),
    }));
    ok(on.toolbar !== 'none' && on.status !== 'none' && on.summary > 0 && on.groupBars > 0 && on.rowChecks > 0 && on.rows > 0,
      JSON.stringify(on));
    return 'Content: 5 switches on by default; off → toolbar/status/summary hidden, 0 group bars with ' + off.rows +
      ' rows still present, 0 row checkboxes but ' + off.handles + ' drag handles; on → ' + on.summary + ' summary cells, ' +
      on.groupBars + ' group bars, ' + on.rowChecks + ' row checkboxes, ' + on.rows + ' rows in a ' + on.lane + 'px lane';
  });

  await check('content: the summary row is real arithmetic and stays under its columns', async () => {
    const dom = await st(() => {
      const cell = id => { const n = document.querySelector('.tablify-summary .summary-cell[data-field-id="' + id + '"]'); return n ? n.textContent : null; };
      const gutter = document.querySelector('.tablify-summary .summary-gutter');
      return { cells: document.querySelectorAll('.tablify-summary .summary-cell').length,
        gutter: gutter ? gutter.textContent : null, height: document.querySelector('.tablify-summary').offsetHeight,
        budget: cell('f_budget'), owner: cell('f_owner'), conf: cell('f_conf'), done: cell('f_done') };
    });
    const truth = await store(`(() => {
      const D = window.TF.data, t = s.table();
      const f = id => t.fields.filter(x => x.id === id)[0];
      const vals = id => t.rows.map(r => r.cells[id]).filter(v => v !== null && v !== undefined && v !== '');
      const sum = id => vals(id).reduce((n, v) => n + (Number(v) || 0), 0);
      return { budget: D.formatCell(f('f_budget'), sum('f_budget')).text,
               ownerN: vals('f_owner').length,
               confAvg: Math.round((sum('f_conf') / vals('f_conf').length) * 10) / 10,
               done: vals('f_done').filter(v => v === true).length + ' of ' + vals('f_done').length,
               fields: t.fields.length, rows: t.rows.length };
    })()`);
    ok(dom.cells === truth.fields && dom.gutter === 'Summary', dom.cells + ' summary cells for ' + truth.fields + ' visible fields, gutter "' + dom.gutter + '"');
    ok(dom.budget === '\u03a3 ' + truth.budget, 'budget cell "' + dom.budget + '" vs recomputed "\u03a3 ' + truth.budget + '"');
    ok(dom.owner === String(truth.ownerN), 'owner count "' + dom.owner + '" vs ' + truth.ownerN);
    ok(dom.conf === '\u2300 ' + truth.confAvg, 'rating average "' + dom.conf + '" vs \u2300 ' + truth.confAvg);
    ok(dom.done === truth.done, 'checkbox cell "' + dom.done + '" vs ' + truth.done);
    /* the row must sit under the columns it labels, at rest and while scrolled */
    const align = () => st(() => ['f_budget', 'f_owner', 'f_notes', 'f_status'].map(id => {
      const h = document.querySelector('.tablify-header .hcell[data-field-id="' + id + '"]');
      const c = document.querySelector('.tablify-summary .summary-cell[data-field-id="' + id + '"]');
      if (!h || !c) return 'missing ' + id;
      return Math.abs(h.getBoundingClientRect().x - c.getBoundingClientRect().x) < 1 ? 'ok' : id + ' ' + Math.round(h.getBoundingClientRect().x) + '≠' + Math.round(c.getBoundingClientRect().x);
    }));
    const atRest = await align();
    await page.evaluate(() => { document.querySelector('.tablify-scroller').scrollLeft = 260; });
    await page.waitForTimeout(300);
    const scrolled = await align();
    await page.evaluate(() => { document.querySelector('.tablify-scroller').scrollLeft = 0; });
    await page.waitForTimeout(240);
    ok(atRest.every(v => v === 'ok'), 'aligned at rest: ' + JSON.stringify(atRest));
    ok(scrolled.every(v => v === 'ok'), 'aligned after 260px of horizontal scroll: ' + JSON.stringify(scrolled));
    /* switching it off returns the height to the grid — it is a row, not an overlay */
    const areaOn = await st(() => document.querySelector('.tablify-grid-area').clientHeight);
    await page.evaluate(() => { window.TF.store.updateSettings({ showSummaryRow: false }); window.TF.harness.ctx().grid.render(); });
    await page.waitForTimeout(300);
    const areaOff = await st(() => document.querySelector('.tablify-grid-area').clientHeight);
    const rowsBack = await st(() => document.querySelectorAll('.tablify-rows .grid-row').length);
    await page.evaluate(() => { window.TF.store.updateSettings({ showSummaryRow: true }); window.TF.harness.ctx().grid.render(); });
    await page.waitForTimeout(300);
    ok(areaOff > areaOn, 'grid area ' + areaOn + 'px → ' + areaOff + 'px with the summary row off');
    return dom.cells + ' summary cells (' + dom.height + 'px row) matching recomputed sums, averages and counts over ' +
      truth.rows + ' rows; header-aligned at rest and after 260px; grid area ' + areaOn + '→' + areaOff + 'px when switched off (' + rowsBack + ' rows still mounted)';
  });

  /* ══════════════════ persistence: save · reset · Esc · parity ══════════════════ */
  await check('persistence: the view you leave is the view you come back to', async () => {
    const more = page.locator('.tablify-toolbar .tablify-btn[title="More"]');
    await openMenuOn(more);
    await page.locator('.menu .menu-item', { hasText: 'Tall (64)' }).click();
    await page.waitForTimeout(250);
    await openMenuOn(hcell('f_notes'));
    await page.locator('.menu .menu-item', { hasText: 'Hide field' }).click();
    await page.waitForTimeout(250);
    await openMenuOn(hcell('f_budget'));
    await page.locator('.menu .menu-item', { hasText: 'Sort descending' }).click();
    await page.waitForTimeout(800);            /* past the 260 ms save debounce */
    const stored = await st(() => { try { return localStorage.getItem('tablify.prototype.v3') || ''; } catch (e) { return ''; } });
    ok(/"rowHeight":"tall"/.test(stored) && /"hiddenFieldIds":\["[^"]+"/.test(stored) && stored.length > 1000,
      'snapshot ' + stored.length + ' bytes, tallRowHeight=' + /"rowHeight":"tall"/.test(stored) + ', hiddenField=' + /"hiddenFieldIds":\["[^"]+"/.test(stored));
    await page.reload();
    await page.waitForSelector('.tablify-rows .cell', { timeout: 5000 });
    await page.waitForTimeout(320);
    const back = await st(() => {
      const v = window.TF.store.get().view;
      return { rowHeight: v.rowHeight, rowH: document.querySelector('.tablify-rows .grid-row').offsetHeight,
        hidden: v.hiddenFieldIds.length, notesCells: document.querySelectorAll('.tablify-rows .cell[data-field-id="f_notes"]').length,
        visible: window.TF.store.visibleFields().length,
        sort: v.sorts[0] ? v.sorts[0].fieldId + ':' + v.sorts[0].dir : null };
    });
    ok(back.rowHeight === 'tall' && back.rowH === 64, 'after reload: rowHeight=' + back.rowHeight + ' rendered ' + back.rowH + 'px');
    ok(back.hidden === 1 && back.notesCells === 0, 'hidden=' + back.hidden + ' but ' + back.notesCells + ' Notes cells still rendered');
    ok(back.sort === 'f_budget:desc', 'sort after reload: ' + back.sort);
    ok(back.visible === 18, 'visible fields after reload: ' + back.visible);
    return 'tall rows (' + back.rowH + 'px), one hidden field (0 cells), ' + back.visible + ' visible fields, sort ' +
      back.sort + ', snapshot ' + stored.length + ' bytes — all restored after a real reload';
  });

  await check('persistence: reset to the sample table, and the reset survives too', async () => {
    await page.locator('.harness-btn', { hasText: '+400' }).click();
    await page.waitForTimeout(500);
    await openMenuOn(page.locator('.tablify-toolbar .tablify-btn[title="More"]'));
    await page.locator('.menu .menu-item', { hasText: 'Tall (64)' }).click();
    await page.waitForTimeout(300);
    const before = await store('({ rows: s.table().rows.length, h: s.get().view.rowHeight })');
    await page.locator('.harness-btn', { hasText: 'Reset' }).click();
    await page.waitForTimeout(700);
    const after = await store('({ rows: s.table().rows.length, fields: s.table().fields.length, h: s.get().view.rowHeight, tables: s.get().tables.length })');
    ok(before.rows === 430 && before.h === 'tall', 'before reset: ' + JSON.stringify(before));
    ok(after.rows === 30 && after.fields === 19 && after.h === 'medium' && after.tables === 1, 'after reset: ' + JSON.stringify(after));
    await page.waitForTimeout(700);            /* let the fresh sample reach localStorage */
    const stored = await st(() => { try { return localStorage.getItem('tablify.prototype.v3') || ''; } catch (e) { return ''; } });
    await page.reload();
    await page.waitForSelector('.tablify-rows .cell', { timeout: 5000 });
    await page.waitForTimeout(320);
    const reloaded = await store('({ rows: s.table().rows.length, fields: s.table().fields.length, h: s.get().view.rowHeight })');
    ok(reloaded.rows === 30 && reloaded.fields === 19 && reloaded.h === 'medium', 'reloaded: ' + JSON.stringify(reloaded));
    return '430 rows @ tall → reset → ' + after.rows + ' rows / ' + after.fields + ' fields / ' + after.h +
      ' rows, and a reload still shows ' + reloaded.rows + ' rows (' + stored.length + ' byte snapshot)';
  });

  await check('keyboard: Escape closes the top surface only, leaves no nodes and no stuck grid', async () => {
    const more = page.locator('.tablify-toolbar .tablify-btn[title="More"]');
    await openMenuOn(more);
    const items = await page.locator('.menu .menu-item').count();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
    const afterMenu = await st(() => ({ menus: document.querySelectorAll('.menu').length,
      closing: document.querySelectorAll('.menu.is-closing, .pop.is-closing, .modal-overlay.is-closing').length,
      focus: (document.activeElement && (document.activeElement.getAttribute('title') || document.activeElement.className)) || '' }));
    ok(items > 0 && afterMenu.menus === 0 && afterMenu.closing === 0, items + ' items, then menus=' + afterMenu.menus + ' closing=' + afterMenu.closing);
    ok(/More/.test(afterMenu.focus), 'focus went to "' + afterMenu.focus + '" instead of the ⋯ button');
    /* a popover over the grid: Esc closes it and the grid still edits */
    await fcell('f_conf', 0).dblclick();
    await page.waitForSelector('.pop', { timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
    const pops = await st(() => document.querySelectorAll('.pop').length);
    await fcell('f_notes', 1).dblclick();
    await page.waitForSelector('.pop', { timeout: 3000 });
    const reopened = await st(() => document.querySelectorAll('.pop').length);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
    const clean = await st(() => document.querySelectorAll('.pop, .menu, .modal-overlay').length);
    ok(pops === 0 && reopened === 1 && clean === 0, 'popovers: after Esc ' + pops + ', reopened ' + reopened + ', final ' + clean);
    return items + '-item menu closed by Esc with focus back on ⋯ and 0 leftover nodes; rating popover closed, Notes popover reopened on the next ' +
      'edit, 0 surfaces left at the end';
  });

  await check('parity: the ⋯ menu and the Advanced settings row are the same switch', async () => {
    await openMenuOn(page.locator('.tablify-toolbar .tablify-btn[title="More"]'));
    await page.locator('.menu .menu-item', { hasText: 'Row checkboxes + numbering' }).click();
    await page.waitForTimeout(320);
    const gridOff = await st(() => document.querySelectorAll('.tablify-root .gutter .checkbox').length);
    await page.locator('.harness-btn', { hasText: 'Settings' }).click();
    await page.waitForSelector('#settings-host .set-row', { timeout: 3000 });
    const rowBox = page.locator('#settings-host .set-row', { hasText: /^Row numbers/ }).first().locator('input.ob-check');
    const settingsReads = await rowBox.isChecked();
    await rowBox.check();
    await page.waitForTimeout(320);
    const settingsWrote = await rowBox.isChecked();
    await page.locator('.harness-btn', { hasText: 'Tablify grid' }).first().click();
    await page.waitForTimeout(340);
    const gridBack = await st(() => document.querySelectorAll('.tablify-root .gutter .checkbox').length);
    await openMenuOn(page.locator('.tablify-toolbar .tablify-btn[title="More"]'));
    const menuChecked = await page.locator('.menu .menu-item', { hasText: 'Row checkboxes + numbering' }).first().evaluate(n => /\u2713/.test(n.textContent));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok(gridOff === 0 && settingsReads === false, 'menu wrote off: ' + gridOff + ' checkboxes in the grid, settings row read ' + settingsReads);
    ok(settingsWrote === true && gridBack > 0, 'settings wrote on: row ' + settingsWrote + ', grid ' + gridBack + ' checkboxes');
    ok(menuChecked, 'the ⋯ menu item did not come back checked');
    return '⋯ menu → off (' + gridOff + ' row checkboxes) → settings reads off → settings → on (' + gridBack +
      ' checkboxes) → ⋯ menu ticks again';
  });

  console.log('\n═════════ Tablify prototype — interaction audit ═════════\n');
  R.forEach((r, i) => console.log('  ' + (r[0] ? '✓' : '✗') + ' ' + String(i + 1).padStart(2) + '. ' + r[1] + (r[2] ? '\n        ' + r[2] : '')));
  const bad = R.filter(r => !r[0]);
  console.log('\n  ' + R.filter(r => r[0]).length + ' passed, ' + bad.length + ' failed, ' + R.length + ' total');
  if (bad.length) console.log('  failing: ' + bad.map(r => r[1]).join(' · '));
  console.log('  page errors / console errors during the run: ' + (errors.length ? errors.length + ' → ' + errors.slice(0, 3).join(' | ') : 'none'));
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();

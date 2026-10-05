/* Geometry + scrolling verification (header offset, wheel over every region,
   both docked thumbs, edge auto-scroll). Same setup as interaction-audit.js. */
const { chromium } = require('playwright-core');
const URL = process.env.TABLIFY_URL || 'http://127.0.0.1:8090/index.html';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('.tablify-root .cell');
  await page.waitForTimeout(200);
  const geo = await page.evaluate(() => {
    const q = s => document.querySelector(s), b = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const sc = q('.tablify-scroller');
    return {
      header: b(q('.tablify-header')), rows: b(q('.tablify-rows')),
      firstRow: b(q('.tablify-rows .grid-row')), firstCell: b(q('.tablify-rows .cell')),
      hbar: b(q('.tablify-hbar')), hthumb: b(q('.tablify-hthumb')),
      vbar: b(q('.tablify-vbar')), vthumb: b(q('.tablify-vthumb')),
      spacer: { w: q('.tablify-spacer').offsetWidth, h: q('.tablify-spacer').offsetHeight },
      scroller: { sw: sc.scrollWidth, sh: sc.scrollHeight, cw: sc.clientWidth, ch: sc.clientHeight },
    };
  });
  console.log('HEADER y', geo.header.y, 'h', geo.header.h, '| FIRST ROW y', geo.firstRow.y, '→ gap =', geo.firstRow.y - (geo.header.y + geo.header.h), 'px');
  console.log('HBAR', JSON.stringify(geo.hbar), 'thumb', JSON.stringify(geo.hthumb));
  console.log('VBAR', JSON.stringify(geo.vbar), 'thumb', JSON.stringify(geo.vthumb));
  console.log('SCROLLER content', JSON.stringify(geo.scroller), 'spacer', JSON.stringify(geo.spacer));

  const scrollOf = () => page.evaluate(() => { const s = document.querySelector('.tablify-scroller'); return { t: s.scrollTop, l: s.scrollLeft }; });
  const laneTransform = () => page.evaluate(() => ({
    rows: getComputedStyle(document.querySelector('.tablify-rows .lane')).transform,
    header: getComputedStyle(document.querySelector('.tablify-header .lane')).transform,
  }));

  async function wheelOn(selector, dy, dx = 0) {
    await page.evaluate(() => { const s = document.querySelector('.tablify-scroller'); s.scrollTop = 0; s.scrollLeft = 0; });
    await page.waitForTimeout(60);
    const box = await page.locator(selector).first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(90);
    return { pos: await scrollOf(), lanes: await laneTransform() };
  }
  for (const sel of ['.tablify-rows .cell', '.tablify-header .hcell', '.tablify-frozen .gutter', '.tablify-corner']) {
    const r = await wheelOn(sel, 300, 240);
    console.log('WHEEL over', sel.padEnd(24), '→ scrollTop', r.pos.t, 'scrollLeft', r.pos.l, '| lane rows transform', r.lanes.rows);
  }

  // drag the vertical thumb
  await page.evaluate(() => { const s = document.querySelector('.tablify-scroller'); s.scrollTop = 0; s.scrollLeft = 0; });
  const vt = await page.locator('.tablify-vthumb').boundingBox();
  await page.mouse.move(vt.x + vt.width / 2, vt.y + vt.height / 2);
  await page.mouse.down();
  await page.mouse.move(vt.x + vt.width / 2, vt.y + vt.height / 2 + 150, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const afterVDrag = await scrollOf();
  const ht = await page.locator('.tablify-hthumb').boundingBox();
  await page.mouse.move(ht.x + ht.width / 2, ht.y + ht.height / 2);
  await page.mouse.down();
  await page.mouse.move(ht.x + ht.width / 2 + 200, ht.y + ht.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const afterHDrag = await scrollOf();
  console.log('DRAG vthumb → scrollTop', afterVDrag.t, '| DRAG hthumb → scrollLeft', afterHDrag.l);

  // drag select past the bottom edge (auto-scroll)
  await page.evaluate(() => { const s = document.querySelector('.tablify-scroller'); s.scrollTop = 0; s.scrollLeft = 0; });
  const c1 = await page.locator('.tablify-rows .cell').first().boundingBox();
  await page.mouse.move(c1.x + 20, c1.y + 20);
  await page.mouse.down();
  const area = await page.locator('.tablify-grid-area').boundingBox();
  await page.mouse.move(area.x + 200, area.y + area.height - 10, { steps: 6 });
  await page.waitForTimeout(400);
  const during = await scrollOf();
  await page.mouse.up();
  const sel = await page.evaluate(() => {
    const s = window.TF.store, g = window.TF.harness.ctx().grid;
    const r = g.getSelection();
    return { rows: r.rows.length, fields: r.fields.length, cells: document.querySelectorAll('.cell.in-range').length };
  });
  console.log('DRAG-SELECT past the edge → auto-scrolled to', during.t, ', selection', JSON.stringify(sel));

  console.log('PAGE ERRORS:', errs.length ? errs : 'none');
  await browser.close();
})();

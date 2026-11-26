const assert = require('node:assert/strict');
const test = require('node:test');
const { loadAnalyzer } = require('../scripts/analyzer-source.cjs');
const { analyzer, html } = loadAnalyzer();
const { parse, interrupts, analyze, clock, key, ID } = analyzer;

function fixture(build) {
  let lines = [], cmd = 0;
  const line = (op, args, status = 'OK') => lines.push(`[CMD@L${++cmd}] ${op} [Param] ${args} : ${status}`);
  const chip = addr => line('SetChipAddr', analyzer.hex(addr));
  const read = (reg, value) => {
    line('IICRead', analyzer.hex(reg), value === 'fail' ? 'ERROR' : 'OK');
    if (Number.isInteger(value)) lines.push(`Read Value:${analyzer.hex(value)}`);
  };
  const select = (base, node, status) => {
    chip(base);
    line('IICWrite', `0x18 ${analyzer.hex(node)}`, status);
    chip(base + 1);
  };
  const round = (time, repeat = true) => {
    lines.push(`--- Compile Start: ${time} ---`);
    if (repeat) lines.push('--- Repeat Times:1 ---');
    cmd = 0;
    line('SetIICMode', 'A8D8');
  };
  build({ round, line, chip, select, read, lines });
  return parse([{ name: 'fixture.log', text: lines.join('\n') }]);
}
const get = (report, b, n, r) => report.rows.find(c => c.base === b && c.node === n && c.reg === r);

test('discovers more than four chains, counts actual slave 0x73, and counts only exactly 0x01 for 0x2E', () => {
  const bases = [0x42, 0x68, 0x6A, 0x6C, 0x6E, 0x70];
  const ds = fixture(({ round, chip, select, read }) => {
    round('2026/11/25 20:20:55');
    for (const b of bases) {
      chip(b); read(0x73, 0x11); read(0x12, 0xFF); read(0x73, 0x11); read(0x2E, 0x03); read(0x2E, 0x01);
      select(b, 1); read(0x73, 0x20); read(0x12, 0x13); read(0x2D, 0x80);
      read(0x2E, 0x00); read(0x2E, 0x03); read(0x2E, 0x01); read(0x2F, 0x00);
    }
  });
  const r = interrupts(ds);
  assert.deepEqual(r.pairs, bases.map(b => [b, b + 1]));
  for (const b of bases) {
    assert.equal(get(r, b, 0, 0x73).hits, 2);
    assert.equal(get(r, b, 0, 0x73).hitRounds, 1);
    assert.equal(get(r, b, 0, 0x2E).hits, 1);
    assert.equal(get(r, b, 1, 0x73).hits, 1);
    assert.equal(get(r, b, 1, 0x2E).hits, 1);
    assert.equal(get(r, b, 1, 0x2E).other2E, 1);
    assert.equal(get(r, b, 1, 0x2E).checked, 3);
    assert.equal(get(r, b, 1, 0x2F).checked, 1);
    assert.equal(get(r, b, 1, 0x2F).hits, 0);
    assert.equal(get(r, b, 1, 0x12), undefined);
    assert.equal(analyze(ds).cells.get(key(b, 1, 0x2E)).first.value, 1);
  }
});

test('wrong, missing, failed and contradictory identity never validate a different visit or round', () => {
  const ds = fixture(({ round, select, read }) => {
    round('2026/11/25 20:20:55');
    select(0x68, 1); read(0x12, 0x13); read(0x2D, 1);
    select(0x68, 1); read(0x73, 2); read(0x12, 0x12); read(0x2D, 2);
    select(0x68, 2); read(0x2D, 4);
    select(0x68, 3); read(0x12, 'fail'); read(0x2D, 8);
    select(0x68, 4); read(0x12, 0x13); read(0x12, 0xFF); read(0x2D, 16);
    select(0x68, 5); read(0x12, 0x13); read(0x2D, 'fail');
    select(0x6A, 1); read(0x2D, 1);
    round('2026/11/26 0:00:55');
    select(0x68, 1); read(0x2D, 32);
  });
  const r = interrupts(ds);
  const a = get(r, 0x68, 1, 0x2D);
  assert.deepEqual([a.hits, a.wrongId, a.unknownId], [1, 1, 1]);
  assert.equal(get(r, 0x68, 1, 0x73).wrongId, 1);
  assert.equal(get(r, 0x68, 2, 0x2D).unknownId, 1);
  assert.equal(get(r, 0x68, 3, 0x2D).unknownId, 1);
  assert.equal(get(r, 0x68, 4, 0x2D).wrongId, 1);
  assert.equal(get(r, 0x68, 5, 0x2D).invalid, 1);
  assert.equal(get(r, 0x6A, 1, 0x2D).unknownId, 1);
});

test('burst covers both the gate and target registers; failed remote select is not reused', () => {
  const ds = fixture(({ round, line, select, read, lines }) => {
    round('2026/11/26 0:00:55');
    select(0x6E, 1);
    line('IICBurstRead', '0x12 30');
    const values = Array(30).fill('0x00');
    values[0] = '0x13'; values[0x2E - 0x12] = '0x01'; values[0x2F - 0x12] = '0x33';
    lines.push('Burst Read from Reg 0x12, RegData:' + values.join(','));
    select(0x6E, 2, 'ERROR'); read(0x2E, 1);
  });
  const r = interrupts(ds);
  assert.equal(get(r, 0x6E, 1, 0x2E).hits, 1);
  assert.equal(get(r, 0x6E, 1, 0x2F).hits, 1);
  assert.equal(get(r, 0x6E, 2, 0x2E), undefined);
  assert.equal(ds.quality.unassigned, 1);
  assert.equal(ds.runs[0][4][0][7], ID.match);
});

test('time limits use Compile Start, including single-digit hours; patrol scope stays separate', () => {
  const ds = fixture(({ round, chip, read }) => {
    round('2026/11/25 2:00:46'); chip(0x68); read(0x73, 5);
    round('2026/11/25 20:20:55', false); chip(0x68); read(0x73, 6);
    round('2026/11/26 0:00:55'); chip(0x68); read(0x73, 7);
  });
  const from = clock('2026-11-25 20:00:00');
  assert.equal(interrupts(ds, { from }).rounds, 2);
  assert.equal(interrupts(ds, { from, mode: 'repeat' }).rounds, 1);
  assert.equal(interrupts(ds, { from, to: clock('2026-11-25 20:30:00') }).rounds, 1);
});

test('published aggregate has no per-read rows, filenames, or source paths', () => {
  const model = JSON.parse(html.match(/id="interruptSnapshot">([^<]*)<\/script>/)[1]);
  for (const r of Object.values(model.modes)) {
    assert.deepEqual(Object.keys(r).sort(), ['fileCount','from','pairs','rounds','rows','to'].sort());
    for (const c of r.rows) assert.deepEqual(Object.keys(c).sort(), ['base','node','reg','hits','hitRounds','checked','invalid','wrongId','unknownId','other2E'].sort());
  }
});

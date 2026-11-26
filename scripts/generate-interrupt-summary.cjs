const fs = require('node:fs');
const path = require('node:path');
const { loadAnalyzer } = require('./analyzer-source.cjs');

const [, , directory, lower, upper] = process.argv;
if (!directory) throw new Error('Usage: node scripts/generate-interrupt-summary.cjs <log-directory> ["YYYY-MM-DD HH:mm:ss"] [end-time]');
const { analyzer, html, htmlPath } = loadAnalyzer();
const from = lower ? analyzer.clock(lower) : null;
const to = upper ? analyzer.clock(upper) : null;
if ((lower && from === null) || (upper && to === null) || (from !== null && to !== null && from > to)) {
  throw new Error('Enter a valid time window in the log clock');
}

function decode(b) {
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('gb18030').decode(b); }
}

function sources(root, entry = root) {
  const result = [];
  for (const ent of fs.readdirSync(entry, { withFileTypes: true })) {
    const name = path.join(entry, ent.name);
    if (ent.isDirectory()) result.push(...sources(root, name));
    else if (ent.isFile() && /\.(log|txt|script)$/i.test(ent.name)) {
      result.push({ name: path.relative(root, name), text: decode(fs.readFileSync(name)) });
    }
  }
  return result;
}

const input = analyzer.parse(sources(path.resolve(directory)));
const modes = Object.fromEntries(['all', 'repeat'].map(mode => [mode, analyzer.interrupts(input, { mode, from, to })]));
if (!modes.all.pairs.length) throw new Error('No target reads in the chosen time window');
// Publish only counters and the overall time range; never copy logs, values per read,
// file names, file paths, line numbers, or unrelated registers into the snapshot.
const payload = JSON.stringify({ version: 1, fromRequested: from, toRequested: to, modes });
const block = /(<script type="application\/json" id="interruptSnapshot">)[^<]*(<\/script>)/;
if (!block.test(html)) throw new Error('No interrupt snapshot block found');
fs.writeFileSync(htmlPath, html.replace(block, (_, open, close) => open + payload + close));
console.log(JSON.stringify({
  pairs: modes.all.pairs.map(p => p.map(analyzer.hex)),
  files: modes.all.fileCount, rounds: modes.all.rounds,
  from: analyzer.stamp(modes.all.from), to: analyzer.stamp(modes.all.to),
  hits: Object.fromEntries(analyzer.REGS.map(r => [analyzer.hex(r), modes.all.rows.filter(c => c.reg === r).reduce((n, c) => n + c.hits, 0)])),
}, null, 2));

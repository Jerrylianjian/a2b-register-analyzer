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
const selected=analyzer.interruptRounds(input).filter(([time]) => (from === null || time >= from) && (to === null || time <= to));
const report=analyzer.interrupts({pairs:input.pairs,irqRounds:selected});
if (!report.pairs.length) throw new Error('No target reads in the chosen time window');
// Publish time-aligned counts only, using a shared dictionary for repeated summaries.
// No read values, raw commands, file names, file indices, or unrelated registers.
const patterns=[], patternIds=new Map();
const rounds=selected.map(([time,patrol,counts]) => {
  const key=JSON.stringify(counts);
  if(!patternIds.has(key)) patternIds.set(key,patterns.push(counts)-1);
  return [time,patrol,patternIds.get(key)];
});
const payload = JSON.stringify({ version: 2, fromRequested: from, toRequested: to,
  fileCount: report.fileCount, pairs: report.pairs, patterns, rounds });
const block = /(<script type="application\/json" id="interruptSnapshot">)[^<]*(<\/script>)/;
if (!block.test(html)) throw new Error('No interrupt snapshot block found');
fs.writeFileSync(htmlPath, html.replace(block, (_, open, close) => open + payload + close));
console.log(JSON.stringify({
  pairs: report.pairs.map(p => p.map(analyzer.hex)),
  files: report.fileCount, rounds: report.rounds,
  from: analyzer.stamp(report.from), to: analyzer.stamp(report.to),
  hits: Object.fromEntries(analyzer.REGS.map(r => [analyzer.hex(r), report.rows.filter(c => c.reg === r).reduce((n, c) => n + c.hits, 0)])),
}, null, 2));

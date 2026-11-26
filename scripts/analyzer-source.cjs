const fs = require('node:fs');
const path = require('node:path');

// The public dashboard is a self-contained HTML file, including when opened offline.
// Reuse its parser for tests and snapshots so both use exactly the same counting rules.
function loadAnalyzer() {
  const htmlPath = path.resolve(__dirname, '../index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const start = html.indexOf('\nconst A2B = (() => {');
  const end = html.indexOf('\nif (typeof module === "object" && module.exports) module.exports = A2B;', start);
  if (start === -1 || end === -1) throw new Error('Dashboard analyzer source not found');
  const analyzer = Function('"use strict";' + html.slice(start, end) + '\nreturn A2B;')();
  return { analyzer, html, htmlPath };
}

module.exports = { loadAnalyzer };

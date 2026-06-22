/**
 * Packs the built plugin into `agentwa.zip`, ready to import from the OpenWA dashboard.
 * Layout inside the zip (manifest.json at the root, next to the compiled `index.js`):
 *   manifest.json
 *   index.js
 *   core/*.js  brand/*.js  knowledge/*.js  guardrails/*.js  llm/*.js  adapters/*.js
 * Uses adm-zip (resolved from the parent OpenWA repo's node_modules).
 */
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const root = __dirname;
const distDir = path.join(root, 'dist');
const manifest = path.join(root, 'manifest.json');
const out = path.join(root, 'agentwa.zip');

if (!fs.existsSync(distDir)) {
  console.error('dist/ not found — run the build first (tsc -p tsconfig.json).');
  process.exit(1);
}

const zip = new AdmZip();
zip.addLocalFile(manifest); // -> /manifest.json
zip.addLocalFolder(distDir, ''); // dist/* -> zip root
zip.writeZip(out);

console.log('Wrote', out);
for (const e of zip.getEntries()) console.log('  ', e.entryName);

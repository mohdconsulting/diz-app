// Generates the iOS app's text resources from src/i18n.ts so the web app and the iPhone app share the same wording.
//   node scripts/gen-ios-strings.mjs      -> ios/Diz/Resources/strings.json and catalog.json
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = join(tmpdir(), 'diz-i18n-' + process.pid + '.mjs');
await build({ entryPoints: ['src/i18n.ts'], bundle: true, format: 'esm', outfile: tmp, platform: 'node', logLevel: 'error' });
const { I18N } = await import(pathToFileURL(tmp).href);

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, String(v).replace(/<br\s*\/?>/g, '\n')]]);
const strings = {};
for (const lang of ['ar', 'sv', 'en']) strings[lang] = Object.fromEntries(flat(I18N[lang]));

// Ordered service catalog (the order of keys in the dictionaries is the order shown in the app).
const catalog = Object.entries(I18N.sv.services).map(([key, s]) => ({
  key, needsToAddr: !!s.needsToAddr,
  categories: Object.keys(s.categories), sizes: Object.keys(s.sizes).map(Number),
}));

mkdirSync('ios/Diz/Resources', { recursive: true });
writeFileSync('ios/Diz/Resources/strings.json', JSON.stringify(strings, null, 1));
writeFileSync('ios/Diz/Resources/catalog.json', JSON.stringify(catalog, null, 1));
console.log('keys per language:', Object.fromEntries(Object.entries(strings).map(([l, d]) => [l, Object.keys(d).length])), 'services:', catalog.length);

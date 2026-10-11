#!/usr/bin/env node
/* Bundles index.html + js/*.js into a single-file build:
 *   dist/scorched-opus.html  - standalone page (double-click to play)
 *   dist/index.html          - the same page, for web hosts to serve at /
 * Third-party scripts in vendor/ keep their own <script> tag; fonts/ are embedded as data URIs,
 * so the built page fetches nothing from anywhere.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const block = html.match(/<!-- build:scripts -->([\s\S]*?)<!-- \/build:scripts -->/);
if (!block) throw new Error('index.html is missing the build:scripts markers');

const srcs = [...block[1].matchAll(/src="([^"]+)"/g)].map(m => m[1]);
const ours = srcs.filter(s => !s.startsWith('vendor/')), vendor = srcs.filter(s => s.startsWith('vendor/'));
const tag = code => '<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
const js = ours.map(s => {
  const code = fs.readFileSync(path.join(root, s), 'utf8');
  return '/* ---------- ' + s + ' ---------- */\n' + code;
}).join('\n');
const vendored = vendor.map(s => tag('/* ---------- ' + s + ' ---------- */\n' + fs.readFileSync(path.join(root, s), 'utf8'))).join('\n');

const fonts = h => h.replace(/url\((fonts\/[^)]+\.woff2)\)/g, (m, f) =>
  'url(data:font/woff2;base64,' + fs.readFileSync(path.join(root, f)).toString('base64') + ')');
const inlined = fonts(html).replace(block[0], () => (vendored ? vendored + '\n' : '') + tag(js));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'scorched-opus.html'), inlined);
fs.writeFileSync(path.join(dist, 'index.html'), inlined);                       // what a web host serves at /
fs.writeFileSync(path.join(dist, '.assetsignore'), '.assetsignore\n');   // Cloudflare: don't serve this

const kb = f => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(1) + ' KB';
console.log('built dist/scorched-opus.html (' + kb('scorched-opus.html') + ') from ' + srcs.length + ' scripts');

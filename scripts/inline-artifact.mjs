// Turns the `vite build --mode artifact` output into a single HTML body
// fragment (inline CSS + JS) suitable for publishing as a claude.ai Artifact.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-artifact';
let html = readFileSync(join(dir, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, file) => {
  return `<style>\n${readFileSync(join(dir, file), 'utf8')}\n</style>`;
});
let script = '';
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, file) => {
  script = readFileSync(join(dir, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '';
});
if (!script) throw new Error('bundle script not found');

const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/i)[0];
const styles = [...head.matchAll(/<style>[\s\S]*?<\/style>/gi)].map((m) => m[0]).join('\n');
const out = `${title}\n${styles}\n${body.trim()}\n<script type="module">\n${script}\n</script>\n`;
writeFileSync(join(dir, 'cd-stream.html'), out);
console.log(`wrote ${join(dir, 'cd-stream.html')} (${(out.length / 1024).toFixed(0)} KB)`);

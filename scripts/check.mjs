import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json')));
const referenced = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page,
  ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(c => [...c.js, ...(c.css || [])])];
for (const file of referenced) await access(path.join(root, file));
for (const file of await readdir(root)) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(root, file)]);
  if (file.endsWith('.html')) {
    const html = await readFile(path.join(root, file), 'utf8');
    if (/\son\w+\s*=|<script(?![^>]*src=)/i.test(html)) throw new Error(`${file} 包含内联脚本`);
    for (const [, target] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (/^(https?:|data:)/.test(target)) throw new Error(`${file} 引用外部资源 ${target}`);
      const [resource, fragment] = target.split('#');
      await access(path.join(root, resource));
      if (resource.endsWith('.svg') && fragment) {
        const svg = await readFile(path.join(root, resource), 'utf8');
        if (!svg.includes(`id="${fragment}"`)) throw new Error(`${file} 引用不存在的图标 ${target}`);
      }
    }
  }
}
console.log('通过：Manifest 资源、JavaScript 语法、扩展页 CSP 和本地依赖检查。');

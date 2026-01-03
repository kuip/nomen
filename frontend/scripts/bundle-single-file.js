#!/usr/bin/env node

/**
 * Bundles Next.js static export into a single HTML file.
 * Run after `npm run build`
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'out');
const OUTPUT_DIR = path.join(__dirname, '..', 'outsingle');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'index.html');

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Check if out/ exists
if (!fs.existsSync(path.join(OUT_DIR, 'index.html'))) {
  console.error('Error: out/index.html not found. Run `npm run build` first.');
  process.exit(1);
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readBinary(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.css': 'text/css',
    '.js': 'application/javascript',
  };
  return types[ext] || 'application/octet-stream';
}

function toDataUri(filePath) {
  const data = readBinary(filePath);
  if (!data) return null;
  const mime = getMimeType(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

function resolveAssetPath(href, baseDir) {
  // Remove query strings
  const cleanHref = href.split('?')[0];

  if (cleanHref.startsWith('/')) {
    return path.join(OUT_DIR, cleanHref);
  }
  return path.join(baseDir, cleanHref);
}

function getAllFiles(dir, pattern) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...getAllFiles(fullPath, pattern));
    } else if (pattern.test(item.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

console.log('Bundling into single HTML file...\n');

let html = readFile(path.join(OUT_DIR, 'index.html'));

// Collect all CSS
const cssFiles = getAllFiles(OUT_DIR, /\.css$/);
let allCss = '';
for (const file of cssFiles) {
  let css = readFile(file);
  if (css) {
    // Inline url() references in CSS
    css = css.replace(/url\(["']?([^"')]+)["']?\)/g, (match, url) => {
      if (url.startsWith('data:')) return match;
      const assetPath = resolveAssetPath(url, path.dirname(file));
      const dataUri = toDataUri(assetPath);
      return dataUri ? `url(${dataUri})` : match;
    });
    allCss += css + '\n';
  }
}

// Collect all JS files
const jsFiles = getAllFiles(OUT_DIR, /\.js$/);
let allJs = '';

// Sort: runtime first, then framework, then others
jsFiles.sort((a, b) => {
  const aName = path.basename(a);
  const bName = path.basename(b);
  if (aName.includes('webpack') || aName.includes('runtime')) return -1;
  if (bName.includes('webpack') || bName.includes('runtime')) return 1;
  if (aName.includes('framework')) return -1;
  if (bName.includes('framework')) return 1;
  return 0;
});

for (const file of jsFiles) {
  const js = readFile(file);
  if (js) {
    allJs += `\n// ${path.basename(file)}\n${js}\n`;
  }
}

// Remove external stylesheet links
html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');

// Remove external script tags (we'll inline them)
html = html.replace(/<script[^>]*src=["'][^"']+["'][^>]*><\/script>/gi, '');

// Inline images in HTML
html = html.replace(/(<img[^>]*src=["'])([^"']+)(["'][^>]*>)/gi, (match, pre, src, post) => {
  if (src.startsWith('data:') || src.startsWith('http')) return match;
  const assetPath = resolveAssetPath(src, OUT_DIR);
  const dataUri = toDataUri(assetPath);
  return dataUri ? `${pre}${dataUri}${post}` : match;
});

// Inline favicon/icon links
html = html.replace(/(<link[^>]*href=["'])([^"']+)(["'][^>]*>)/gi, (match, pre, href, post) => {
  if (href.startsWith('data:') || href.startsWith('http')) return match;
  if (!match.includes('icon')) return match;
  const assetPath = resolveAssetPath(href, OUT_DIR);
  const dataUri = toDataUri(assetPath);
  return dataUri ? `${pre}${dataUri}${post}` : match;
});

// Remove font preload links (fonts are inlined in CSS)
html = html.replace(/<link[^>]*rel=["']preload["'][^>]*as=["']font["'][^>]*>/gi, '');

// Remove other preload links
html = html.replace(/<link[^>]*rel=["']preload["'][^>]*>/gi, '');

// Inject inlined CSS before </head>
html = html.replace('</head>', `<style>\n${allCss}\n</style>\n</head>`);

// Inject inlined JS before </body>
html = html.replace('</body>', `<script>\n${allJs}\n</script>\n</body>`);

// Write output
fs.writeFileSync(OUTPUT_FILE, html);

const stats = fs.statSync(OUTPUT_FILE);
console.log(`✓ Created: ${OUTPUT_FILE}`);
console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`  CSS files inlined: ${cssFiles.length}`);
console.log(`  JS files inlined: ${jsFiles.length}`);
console.log('\nNote: This bundles the landing page. Other routes require the full build.');

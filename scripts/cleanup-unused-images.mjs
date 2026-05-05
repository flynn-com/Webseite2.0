/**
 * Cleanup unused images in public/uploads/
 *
 * Finds all image files under public/uploads/ that are not referenced
 * in any source file (src/ content, pages, layouts, components).
 * Deletes them via `git rm` so the removal is tracked in version control.
 *
 * Usage: node scripts/cleanup-unused-images.mjs [--dry-run]
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';

const ROOT       = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const UPLOADS    = join(ROOT, 'public', 'uploads');
const SRC_DIRS   = [join(ROOT, 'src'), join(ROOT, 'public', 'admin')];
const SRC_EXTS   = ['.md', '.astro', '.json', '.ts', '.js', '.jsx', '.tsx', '.yml', '.yaml'];
const IMG_EXTS   = ['.avif', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];

const DRY_RUN = process.argv.includes('--dry-run');

// ── 1. Collect all upload files ──────────────────────────────────────────────
function walk(dir) {
  const results = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

const allUploads = walk(UPLOADS).filter(f =>
  IMG_EXTS.includes('.' + f.split('.').pop().toLowerCase())
);

// ── 2. Collect all source text ────────────────────────────────────────────────
let sourceText = '';
for (const dir of SRC_DIRS) {
  try {
    for (const f of walk(dir)) {
      if (SRC_EXTS.includes('.' + f.split('.').pop().toLowerCase())) {
        try { sourceText += readFileSync(f, 'utf8') + '\n'; } catch (_) {}
      }
    }
  } catch (_) {}
}

// ── 3. Find unused uploads ────────────────────────────────────────────────────
const unused = allUploads.filter(file => {
  // Convert to the public path as it appears in source: /uploads/...
  const rel = '/' + relative(join(ROOT, 'public'), file).replace(/\\/g, '/');
  return !sourceText.includes(rel);
});

// ── 4. Report & delete ────────────────────────────────────────────────────────
if (unused.length === 0) {
  console.log('✅ Keine ungenutzten Bilder gefunden.');
  process.exit(0);
}

console.log(`\n🗑  ${unused.length} ungenutzte Datei(en) gefunden:\n`);
for (const f of unused) {
  console.log(' -', relative(ROOT, f));
}

if (DRY_RUN) {
  console.log('\n(Dry-run — nichts gelöscht)');
  process.exit(0);
}

console.log('\nLösche via git rm …');
for (const f of unused) {
  try {
    execSync(`git rm -f "${f.replace(/\\/g, '/')}"`, { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    // File not tracked by git — just skip
    console.warn(`  Warnung: ${relative(ROOT, f)} nicht in git — übersprungen`);
  }
}

console.log('\n✅ Fertig. Änderungen noch commiten + pushen.');

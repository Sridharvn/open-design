// @ts-nocheck
// Angular 21 scaffold and code-generation business logic.
//
// Three responsibilities:
//  1. `scaffoldAngularProject` — runs `ng new` via Angular CLI 21 to create a
//     real Angular workspace inside the project directory, then overlays the
//     canonical architecture files from the apps/angular-ui/ template.
//  2. `generateAngularArtifact` — runs `ng generate` inside an existing Angular
//     workspace to create components, stores, pages, services, etc.
//  3. `installAngularSkills` — reads the bundled skills-lock.json and calls the
//     existing `installFromGithub` for each skill not already present.

import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFromTarget } from './library-install.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the apps/angular-ui reference app (compiled and installed alongside
// the daemon). In development, resolve relative to this source file location.
const ANGULAR_UI_TEMPLATE_DIR = path.resolve(__dirname, '../../angular-ui');
const SKILLS_LOCK_PATH = path.join(ANGULAR_UI_TEMPLATE_DIR, 'skills-lock.json');

// Architecture overlay directories that are copied on top of every `ng new`
// output. These are the files that embody the user's custom architecture.
const OVERLAY_DIRS = ['src/app/models', 'src/app/constants', 'src/app/services',
  'src/app/stores', 'src/app/interceptors', 'src/app/guards', 'src/app/pages',
  'src/app/components', 'src/app/layouts', 'src/app/pipes', 'src/styles'];
const OVERLAY_SINGLES = [
  'src/app/app.config.ts', 'src/app/app.routes.ts',
  'src/app/app.ts', 'src/app/app.html',
  'src/styles.scss', 'src/index.html', 'src/main.ts',
  'src/environments/environment.ts', 'src/environments/environment.prod.ts',
  'proxy.conf.json',
];

/**
 * Scaffold a new Angular 21 workspace inside `projectDir` and overlay the
 * canonical architecture template from apps/angular-ui/.
 *
 * @param {string} projectDir  - Absolute path to the Open Design project folder.
 * @param {{ appName: string, style?: string, skipGit?: boolean }} req
 * @returns {Promise<{ ok: boolean, entryFile: string, angularVersion?: string, error?: string }>}
 */
export async function scaffoldAngularProject(projectDir, req) {
  const appName = (req.appName || 'angular-app')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'angular-app';
  const style = req.style || 'scss';

  // 1. Run `ng new` — uses @angular/cli@21 via npx so no global install needed.
  let angularVersion;
  try {
    await fs.promises.mkdir(projectDir, { recursive: true });
    await runCommand('npx', [
      '--yes',
      '@angular/cli@21',
      'new',
      appName,
      '--directory', '.',
      '--standalone',
      `--style=${style}`,
      '--routing',
      '--skip-git',
      '--skip-install',
      '--no-interactive',
    ], { cwd: projectDir, timeout: 300_000 });

    // Detect installed Angular CLI version from package.json
    const pkgRaw = await readFile(path.join(projectDir, 'package.json'), 'utf8').catch(() => '{}');
    const pkg = JSON.parse(pkgRaw);
    angularVersion = pkg.dependencies?.['@angular/core'] ?? pkg.devDependencies?.['@angular/cli'];
  } catch (err) {
    return { ok: false, error: `ng new failed: ${err.message}` };
  }

  // 2. Overlay the canonical architecture files from apps/angular-ui/.
  try {
    await applyArchitectureOverlays(projectDir);
  } catch (err) {
    // Non-fatal: workspace was created, overlays just failed.
    console.warn('[od-angular] overlay failed:', err.message);
  }

  return { ok: true, entryFile: 'src/index.html', angularVersion };
}

/**
 * Copy the canonical architecture files from apps/angular-ui/ on top of the
 * freshly scaffolded workspace. Directories are merged recursively; existing
 * files are overwritten so the architecture always wins over `ng new` defaults.
 */
async function applyArchitectureOverlays(projectDir) {
  // Copy full directory trees
  for (const dir of OVERLAY_DIRS) {
    const src = path.join(ANGULAR_UI_TEMPLATE_DIR, dir);
    const dest = path.join(projectDir, dir);
    const exists = await stat(src).then(() => true).catch(() => false);
    if (!exists) continue;
    await mkdir(dest, { recursive: true });
    await cp(src, dest, { recursive: true, force: true });
  }

  // Copy single overlay files
  for (const file of OVERLAY_SINGLES) {
    const src = path.join(ANGULAR_UI_TEMPLATE_DIR, file);
    const dest = path.join(projectDir, file);
    const exists = await stat(src).then(() => true).catch(() => false);
    if (!exists) continue;
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest, { force: true });
  }

  // Copy skills-lock.json into the project so users can re-run install later.
  await cp(
    SKILLS_LOCK_PATH,
    path.join(projectDir, 'skills-lock.json'),
    { force: true },
  ).catch(() => {});
}

/**
 * Run `ng generate <schematic> <name>` inside an existing Angular workspace.
 *
 * @param {string} projectDir
 * @param {{ schematic: string, name: string, path?: string, flags?: string[] }} req
 * @returns {Promise<{ ok: boolean, created: string[], modified: string[], error?: string }>}
 */
export async function generateAngularArtifact(projectDir, req) {
  const { schematic, name, path: artifactPath, flags = [] } = req;

  // `store` is not a standard Angular schematic — map it to a service with a
  // naming convention the architecture uses (e.g. `my-feature.store.ts`).
  const resolvedSchematic = schematic === 'store' ? 'service' : schematic;
  const resolvedName = schematic === 'store' && !name.endsWith('.store')
    ? `${name}.store`
    : name;

  const args = ['generate', resolvedSchematic, resolvedName];
  if (artifactPath) args.push(`--path=src/app/${artifactPath}`);
  // Always use OnPush for components and skip tests by default.
  if (schematic === 'component' || schematic === 'page') {
    args.push('--change-detection=OnPush', '--skip-tests');
  }
  if (schematic === 'page') {
    // Pages are just components — add inline template + flat structure.
    args.push('--inline-template=false');
  }
  args.push(...flags, '--dry-run=false');

  let stdout = '';
  try {
    stdout = await runCommand('npx', ['ng', ...args], { cwd: projectDir, timeout: 60_000 });
  } catch (err) {
    return { ok: false, created: [], modified: [], error: err.message };
  }

  // Parse `ng generate` output: lines starting with CREATE / UPDATE.
  const created = [];
  const modified = [];
  for (const line of stdout.split('\n')) {
    const create = /^CREATE\s+(.+)/.exec(line.trim());
    const update = /^UPDATE\s+(.+)/.exec(line.trim());
    if (create) created.push(create[1].trim());
    if (update) modified.push(update[1].trim());
  }

  return { ok: true, created, modified };
}

/**
 * Install all skills from the bundled skills-lock.json into the daemon's user
 * skills directory. Already-installed skills are silently skipped (idempotent).
 *
 * @param {string} userSkillsDir  - Daemon's user-writable skills root.
 * @returns {Promise<{ installed: string[], skipped: string[], failed: string[] }>}
 */
export async function installAngularSkills(userSkillsDir) {
  const installed = [];
  const skipped = [];
  const failed = [];

  let lock;
  try {
    const raw = await readFile(SKILLS_LOCK_PATH, 'utf8');
    lock = JSON.parse(raw);
  } catch {
    // No skills-lock.json bundled — silently skip.
    return { installed, skipped, failed };
  }

  const skills = lock?.skills ?? {};
  for (const [skillName, entry] of Object.entries(skills)) {
    if (!entry.source || entry.sourceType !== 'github') {
      skipped.push(skillName);
      continue;
    }
    const githubUrl = `https://github.com/${entry.source}`;
    const result = await installFromTarget({ source: 'github', url: githubUrl }, userSkillsDir, 'skill');
    if (result.ok) {
      installed.push(skillName);
    } else if (result.error?.includes('already installed')) {
      skipped.push(skillName);
    } else {
      failed.push(skillName);
      console.warn(`[od-angular] skill install failed: ${skillName} — ${result.error}`);
    }
  }

  return { installed, skipped, failed };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function runCommand(cmd, args, { cwd, timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => chunks.push(d)); // include stderr for diagnostic output
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`command timed out after ${timeout}ms: ${cmd} ${args.join(' ')}`));
    }, timeout);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      if (code !== 0) {
        reject(new Error(`exit ${code}: ${output.slice(-400)}`));
      } else {
        resolve(output);
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

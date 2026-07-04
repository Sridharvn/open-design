// DTOs for the Angular 21 scaffold and code-generation capability.
// Both surfaces speak this shape: the daemon API routes and the `od angular`
// CLI subcommand. Keep this file pure TypeScript — no Node, DOM, or runtime
// deps — per the contracts boundary.

/** A single skill entry from skills-lock.json. */
export interface AngularSkillLockEntry {
  source: string;
  sourceType: 'github';
  skillPath: string;
  computedHash?: string;
}

/** Full skills-lock.json schema bundled with the Angular reference app. */
export interface AngularSkillsLock {
  version: 1;
  skills: Record<string, AngularSkillLockEntry>;
}

/** POST /api/angular/:projectId/scaffold */
export interface AngularScaffoldRequest {
  /** Angular app name used in package.json and `ng new` (slug-safe). */
  appName: string;
  /** Style preprocessor — always 'scss' for this architecture. */
  style?: 'scss';
  /** Skip running `git init` inside the scaffolded workspace. */
  skipGit?: boolean;
  /** Also install the bundled skills-lock.json skills. Default: true. */
  installSkills?: boolean;
}

export interface AngularScaffoldResponse {
  ok: boolean;
  projectId: string;
  /** Absolute path of the scaffolded workspace on disk. */
  resolvedDir: string;
  /** The project-relative entry file (e.g. 'src/index.html'). */
  entryFile: string;
  /** Angular CLI version that ran `ng new`. */
  angularVersion?: string;
  /** Skills successfully installed from skills-lock.json. */
  skillsInstalled: string[];
  /** Skills that were already present — skipped. */
  skillsSkipped: string[];
  /** Skills where the git clone failed (non-fatal). */
  skillsFailed: string[];
}

/** Schematics the daemon can run via `ng generate`. */
export type AngularGenerateSchematic =
  | 'component'
  | 'service'
  | 'store'
  | 'page'
  | 'interceptor'
  | 'guard'
  | 'pipe'
  | 'directive';

/** POST /api/angular/:projectId/generate */
export interface AngularGenerateRequest {
  schematic: AngularGenerateSchematic;
  /** CamelCase or kebab-case artifact name (e.g. 'my-button', 'ExportStore'). */
  name: string;
  /**
   * Target path inside src/app/ (e.g. 'components/my-button').
   * Defaults to the schematic's conventional directory.
   */
  path?: string;
  /** Extra flags forwarded verbatim to `ng generate` (e.g. ['--skip-tests']). */
  flags?: string[];
}

export interface AngularGenerateResponse {
  ok: boolean;
  /** Project-relative paths of newly created files. */
  created: string[];
  /** Project-relative paths of files modified by the schematic. */
  modified: string[];
}

/** POST /api/angular/:projectId/install-skills */
export interface AngularInstallSkillsResponse {
  ok: boolean;
  skillsInstalled: string[];
  skillsSkipped: string[];
  skillsFailed: string[];
}

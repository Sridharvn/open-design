// @ts-nocheck
// Angular 21 scaffold and code-generation HTTP routes.
//
// Registers two resource routes on the express app:
//   POST /api/angular/:projectId/scaffold        — runs ng new + architecture overlay
//   POST /api/angular/:projectId/generate        — runs ng generate inside workspace
//   POST /api/angular/:projectId/install-skills  — installs bundled skills-lock.json skills
//
// Convention: follows the same `registerXxxRoutes(app, deps)` pattern as every
// other route module in this daemon so it composes cleanly with server.ts.

import { sendApiError } from './http/api-errors.js';
import {
  scaffoldAngularProject,
  generateAngularArtifact,
  installAngularSkills,
} from './angular-scaffold.js';

const ANGULAR_GENERATE_SCHEMATICS = new Set([
  'component', 'service', 'store', 'page', 'interceptor', 'guard', 'pipe', 'directive',
]);

/**
 * @param {import('express').Application} app
 * @param {{
 *   db: import('better-sqlite3').Database;
 *   paths: {
 *     PROJECTS_DIR: string;
 *     USER_SKILLS_DIR: string;
 *   };
 *   projectStore: { getProject: (db: any, id: string) => any; resolveProjectDir: (dir: string, id: string, meta: any) => string; };
 * }} deps
 */
export function registerAngularRoutes(app, deps) {
  const { db, paths, projectStore } = deps;
  const { PROJECTS_DIR, USER_SKILLS_DIR } = paths;
  const { getProject, resolveProjectDir } = projectStore;

  // -------------------------------------------------------------------------
  // POST /api/angular/:id/scaffold
  // Body: AngularScaffoldRequest
  // -------------------------------------------------------------------------
  app.post('/api/angular/:id/scaffold', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const appName = typeof body.appName === 'string' && body.appName.trim()
        ? body.appName.trim()
        : (project.metadata?.title || 'angular-app');
      const skipGit = body.skipGit === true;
      const installSkills = body.installSkills !== false; // default: true

      const projectDir = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata);

      // Run ng new + overlays
      const scaffoldResult = await scaffoldAngularProject(projectDir, {
        appName,
        style: 'scss',
        skipGit,
      });

      if (!scaffoldResult.ok) {
        return sendApiError(res, 500, 'SCAFFOLD_FAILED', scaffoldResult.error ?? 'scaffold failed');
      }

      // Optionally install bundled skills
      let skillsInstalled = [];
      let skillsSkipped = [];
      let skillsFailed = [];
      if (installSkills && USER_SKILLS_DIR) {
        const skillsResult = await installAngularSkills(USER_SKILLS_DIR);
        skillsInstalled = skillsResult.installed;
        skillsSkipped = skillsResult.skipped;
        skillsFailed = skillsResult.failed;
      }

      return res.json({
        ok: true,
        projectId: req.params.id,
        resolvedDir: projectDir,
        entryFile: scaffoldResult.entryFile,
        angularVersion: scaffoldResult.angularVersion,
        skillsInstalled,
        skillsSkipped,
        skillsFailed,
      });
    } catch (err) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/angular/:id/generate
  // Body: AngularGenerateRequest
  // -------------------------------------------------------------------------
  app.post('/api/angular/:id/generate', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const schematic = body.schematic;
      const name = typeof body.name === 'string' ? body.name.trim() : '';

      if (!schematic || !ANGULAR_GENERATE_SCHEMATICS.has(schematic)) {
        return sendApiError(
          res, 400, 'BAD_REQUEST',
          `schematic is required and must be one of: ${[...ANGULAR_GENERATE_SCHEMATICS].join(', ')}`,
        );
      }
      if (!name) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name is required');
      }

      const projectDir = resolveProjectDir(PROJECTS_DIR, req.params.id, project.metadata);

      const result = await generateAngularArtifact(projectDir, {
        schematic,
        name,
        path: typeof body.path === 'string' ? body.path.trim() : undefined,
        flags: Array.isArray(body.flags) ? body.flags.filter((f) => typeof f === 'string') : [],
      });

      if (!result.ok) {
        return sendApiError(res, 500, 'GENERATE_FAILED', result.error ?? 'generate failed');
      }

      return res.json({ ok: true, created: result.created, modified: result.modified });
    } catch (err) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/angular/:id/install-skills
  // (Re-)installs the bundled skills-lock.json skills. Idempotent.
  // -------------------------------------------------------------------------
  app.post('/api/angular/:id/install-skills', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }

      if (!USER_SKILLS_DIR) {
        return sendApiError(res, 503, 'UNAVAILABLE', 'user skills directory not configured');
      }

      const result = await installAngularSkills(USER_SKILLS_DIR);
      return res.json({
        ok: true,
        skillsInstalled: result.installed,
        skillsSkipped: result.skipped,
        skillsFailed: result.failed,
      });
    } catch (err) {
      return sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message ?? err));
    }
  });
}

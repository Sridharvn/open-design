import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerAngularRoutes } from '../src/angular-routes';
import * as angularScaffold from '../src/angular-scaffold';

vi.mock('../src/angular-scaffold', () => ({
  scaffoldAngularProject: vi.fn(),
  installAngularSkills: vi.fn().mockResolvedValue({ installed: [], skipped: [], failed: [] }),
}));

describe('angular-routes', () => {
  let mockDeps: any;
  let scaffoldHandler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(angularScaffold.installAngularSkills).mockResolvedValue({ installed: [], skipped: [], failed: [] });
    
    mockDeps = {
      db: {},
      paths: {
        PROJECTS_DIR: '/test/projects',
        USER_SKILLS_DIR: '/test/skills',
      },
      projectStore: {
        getProject: vi.fn().mockReturnValue({ id: 'proj_123', metadata: { baseDir: '/custom/target' } }),
        resolveProjectDir: vi.fn().mockReturnValue('/custom/target'),
      },
    };
    
    const mockApp = {
      post: vi.fn((path, handler) => {
        if (path === '/api/angular/:id/scaffold') {
          scaffoldHandler = handler;
        }
      }),
    };
    
    registerAngularRoutes(mockApp as any, mockDeps);
  });

  function createMockRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('returns 404 if project is not found', async () => {
    mockDeps.projectStore.getProject.mockReturnValue(null);
    const req = { params: { id: 'proj_999' }, body: {} };
    const res = createMockRes();
    
    await scaffoldHandler(req, res);
      
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'PROJECT_NOT_FOUND', message: 'project not found' } }));
  });

  it('calls scaffoldAngularProject and returns 200 on success', async () => {
    vi.mocked(angularScaffold.scaffoldAngularProject).mockResolvedValue({
      ok: true,
      entryFile: 'src/main.ts',
      angularVersion: '21.0.0',
    });

    const req = { params: { id: 'proj_123' }, body: { targetDir: '/path/to/target' } };
    const res = createMockRes();
    
    await scaffoldHandler(req, res);
      
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      resolvedDir: '/path/to/target',
      entryFile: 'src/main.ts',
      angularVersion: '21.0.0',
    }));
    expect(angularScaffold.scaffoldAngularProject).toHaveBeenCalledWith(
      '/path/to/target',
      expect.any(Object)
    );
  });

  it('returns 500 if scaffoldAngularProject returns ok: false', async () => {
    vi.mocked(angularScaffold.scaffoldAngularProject).mockResolvedValue({
      ok: false,
      error: 'Scaffold failed',
    });

    const req = { params: { id: 'proj_123' }, body: { targetDir: '/path/to/target' } };
    const res = createMockRes();
    
    await scaffoldHandler(req, res);
      
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'SCAFFOLD_FAILED', message: 'Scaffold failed' } });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scaffoldAngularProject } from '../src/angular-scaffold';
import * as child_process from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import EventEmitter from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    cp: vi.fn(),
    readdir: vi.fn(),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      promises: {
        mkdir: vi.fn(),
        stat: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        cp: vi.fn(),
        readdir: vi.fn(),
      }
    },
    promises: {
      mkdir: vi.fn(),
      stat: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      cp: vi.fn(),
      readdir: vi.fn(),
    }
  };
});

describe('angular-scaffold', () => {
  let mockSpawn: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockSpawn = vi.mocked(child_process.spawn);
    
    // Mock fs operations by default to prevent actual filesystem modifications
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.cp).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readdir).mockResolvedValue(['some-file.ts'] as any);
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({
      dependencies: { '@angular/core': '21.0.0' }
    }));

    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.cp).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.promises.readdir).mockResolvedValue(['some-file.ts'] as any);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      dependencies: { '@angular/core': '21.0.0' }
    }));
  });

  function setupSpawnMock({ exitCode = 0, stdout = 'success', stderr = '' } = {}) {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = vi.fn();
    
    mockSpawn.mockReturnValue(mockProcess);
    
    // Defer emitting to allow promise setup
    setTimeout(() => {
      if (stdout) mockProcess.stdout.emit('data', Buffer.from(stdout));
      if (stderr) mockProcess.stderr.emit('data', Buffer.from(stderr));
      mockProcess.emit('close', exitCode);
    }, 0);
    
    return mockProcess;
  }

  it('runs ng new when workspace does not exist', async () => {
    setupSpawnMock();
    vi.mocked(fsPromises.stat).mockRejectedValue(new Error('ENOENT')); // no angular.json

    const result = await scaffoldAngularProject('/test/dir', { appName: 'test-app' });

    console.log(result.error);
    expect(result.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith('npx', expect.arrayContaining([
      '--yes', '@angular/cli@21', 'new', 'test-app'
    ]), expect.any(Object));
  });

  it('skips ng new if angular.json already exists', async () => {
    setupSpawnMock();
    // stat succeeds for angular.json
    vi.mocked(fsPromises.stat).mockImplementation(async (filePath: any) => {
      if (filePath.toString().endsWith('angular.json')) return {} as any;
      throw new Error('ENOENT');
    });

    const result = await scaffoldAngularProject('/test/dir', { appName: 'test-app' });

    expect(result.ok).toBe(true);
    expect(mockSpawn).not.toHaveBeenCalledWith('npx', expect.arrayContaining(['new']), expect.any(Object));
  });

  it('returns false if ng new fails', async () => {
    setupSpawnMock({ exitCode: 1, stdout: '', stderr: 'Command failed' });
    vi.mocked(fsPromises.stat).mockRejectedValue(new Error('ENOENT'));

    const result = await scaffoldAngularProject('/test/dir', { appName: 'test-app' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ng new failed/);
  });
});

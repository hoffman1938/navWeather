import { describe, expect, it } from 'vitest';
import { apiPaths, normalizeApiPath } from './v1';

describe('API v1 routing', () => {
  it('serves /api/v1/… and the unversioned /api/… (clients from before versioning) as the same route', () => {
    expect(normalizeApiPath('/api/v1/reports')).toBe('/api/reports');
    expect(normalizeApiPath('/api/reports')).toBe('/api/reports');
    expect(normalizeApiPath('/api/v1/share/abc/ws')).toBe('/api/share/abc/ws');
    expect(normalizeApiPath('/api/v1')).toBe('/api/');
    expect(normalizeApiPath('/api/v1/health')).toBe('/api/health');
  });

  it('refuses versions it does not serve, and leaves the app (static assets) alone', () => {
    expect(normalizeApiPath('/api/v2/reports')).toBe('unsupported');
    expect(normalizeApiPath('/api/v0/reports')).toBe('unsupported');
    expect(normalizeApiPath('/')).toBeNull();
    expect(normalizeApiPath('/assets/index.js')).toBeNull();
    expect(normalizeApiPath('/apiary')).toBeNull();
  });

  it('the web client calls the versioned paths', () => {
    expect(apiPaths.reports).toBe('/api/v1/reports');
    expect(apiPaths.shareItem('a/b')).toBe('/api/v1/share/a%2Fb');
    expect(apiPaths.shareSocket('x')).toBe('/api/v1/share/x/ws');
  });
});

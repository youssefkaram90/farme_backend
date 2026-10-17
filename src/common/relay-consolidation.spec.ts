import * as fs from 'fs';
import * as path from 'path';

/**
 * Every web API route forwards through `Frontend/app/lib/backend-relay.ts` (X-09).
 *
 * The helper exists because the four things a relay needs — the caller's cookie, a
 * timeout, the backend's status and its `Set-Cookie` headers — had been hand-copied
 * into 34 files, each with its own idea of what to say when the backend was slow or
 * unreachable: `Backend request timed out` in some, a raw 500 in others, and a
 * non-JSON answer reported as "could not reach the server" when the server had in
 * fact answered. All 34 were converted on 2026-10-08 (TNL-3); this test keeps them
 * converted. A route that mentions `BACKEND_URL` is building its own proxy again.
 *
 * The web folder is not part of the backend's build, so this SKIPS with a message
 * when it is not on disk rather than failing an isolated `Backend/` checkout.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const apiRoot = path.join(repoRoot, 'Frontend', 'app', 'api');

/** Every `route.ts` under the web's `app/api`, however deep. */
function routeFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

describe('the web relays every call through one helper (X-09 / TNL-3)', () => {
  const files = routeFiles(apiRoot);

  it('no route builds its own proxy', () => {
    if (files.length === 0) {
      // Deliberately not a failure: the backend must be testable on its own.
      console.warn(
        `[relay] no route files found under ${apiRoot} — nothing was checked.`,
      );
      return;
    }

    const offenders = files
      .filter((file) => fs.readFileSync(file, 'utf8').includes('BACKEND_URL'))
      .map((file) => path.relative(repoRoot, file).replace(/\\/g, '/'));

    // The failure message lists them, so the fix is obvious: forward with
    // `relay` / `relayBody` instead.
    expect(offenders).toEqual([]);
  });
});

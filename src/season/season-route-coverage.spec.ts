import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES } from './season-write.interceptor';

/**
 * Every route that NAMES a record has to be judged by the season that record
 * belongs to. When one is not, the closed-season rule silently stops
 * applying to it — which is exactly how nine routes escaped before X-01, and why
 * `season-write.interceptor.ts` is deliberately forgiving instead of loud.
 *
 * This walks the real controllers rather than a hand-kept list, so a new route
 * cannot quietly fall outside. No database and no running server: it only reads
 * source.
 *
 * A route that carries its record id in the BODY (the two `/execute` routes)
 * cannot be seen here; those still need a human eye.
 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Routes that name a record and still need no rule, each with its reason. An
 * entry without a reason is a smell: either a guard makes it unreachable for
 * anyone who could be refused, or the record is not season-scoped at all.
 */
const EXEMPT: Record<string, string> = {
  'PATCH /seasons/:id/activate':
    'ADMIN-only: opening a season is never a grantable permission',
  'POST /seasons/:id/close':
    'ADMIN-only: closing a season is never a grantable permission',
  'GET /seasons/:id': 'ADMIN-only: a closed season is only for administrators',
  'GET /seasons/:id/close-preview': 'ADMIN-only',
  'PATCH /users/:id/role': 'ADMIN-only',
  'GET /users/:id': 'a user is not season-scoped',
  'POST /permissions/users/:userId': 'ADMIN-only',
  'GET /permissions/users/:userId': 'permissions are not season-scoped',
  'POST /agri-inputs/:id/adjust': 'ADMIN-only',
  'POST /harvested-products/:id/writeoff': 'ADMIN-only',
  'GET /phytosanitary-products/:id':
    'the product catalogue is GLOBAL — typed once, not per season — so it belongs to no season',
};

type Route = { method: string; path: string };

/** `:anything` becomes `:`, so a rule and a controller agree on the shape. */
const normalise = (path: string): string => path.replace(/:[^/]+/g, ':');

const joinPath = (...parts: string[]): string =>
  '/' + parts.filter((part) => part.length > 0).join('/');

function controllerFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      // The generated Prisma client has no controllers, and is huge.
      if (entry.name !== 'generated') {
        files.push(...controllerFiles(full));
      }
    } else if (entry.name.endsWith('.controller.ts')) {
      files.push(full);
    }
  }

  return files;
}

function collectRoutes(): Route[] {
  const routes: Route[] = [];

  for (const file of controllerFiles(join(__dirname, '..'))) {
    const source = readFileSync(file, 'utf8');
    const prefix =
      (/@Controller\(\s*(?:'([^']*)')?\s*\)/.exec(source) ?? [])[1] ?? '';

    for (const [, method, path] of source.matchAll(
      /@(Post|Put|Patch|Delete|Get)\(\s*(?:'([^']*)')?\s*\)/g,
    )) {
      routes.push({
        method: method.toUpperCase(),
        path: normalise(joinPath(prefix, path ?? '')),
      });
    }
  }

  return routes;
}

describe('season scope coverage', () => {
  const routes = collectRoutes();
  const judged = new Set(RULES.map((rule) => normalise(rule.path)));
  const exempt = new Map(
    Object.entries(EXEMPT).map(([key, reason]) => [normalise(key), reason]),
  );

  /** Only routes that name a record can be judged by a season. */
  const named = routes.filter(
    (route) =>
      route.path.includes(':') &&
      (WRITE_METHODS.has(route.method) || route.method === 'GET'),
  );

  it('reads the controllers - a broken scan must not pass on nothing', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(named.length).toBeGreaterThan(30);
  });

  it('judges every route that names a record', () => {
    const unjudged = named
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !judged.has(normalise(key).split(' ')[1] ?? ''))
      .filter((key) => !exempt.has(normalise(key)));

    expect(unjudged).toEqual([]);
  });

  it('has no exemption left behind by a route that no longer exists', () => {
    const known = new Set(
      routes.map((route) => normalise(`${route.method} ${route.path}`)),
    );

    expect([...exempt.keys()].filter((key) => !known.has(key))).toEqual([]);
  });
});

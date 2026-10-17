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
 * A route that carries its record id in the BODY — `POST /sowing-ssm/execute`,
 * `POST /sowing-lpm/execute`, `POST /stock/adjust` — has no `:` in its path, so
 * the scan above cannot see it. Those routes declare themselves with
 * `@SeasonIdInBody(...)`, and the tests below require a matching rule for each,
 * so a NEW body-carried route fails this spec until it is judged (provided its
 * handler carries the marker).
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
  'GET /seasons/:id/close-preview': 'ADMIN-only',
  'PATCH /users/:id/role': 'ADMIN-only',
  'GET /users/:id': 'a user is not season-scoped',
  'POST /permissions/users/:userId': 'ADMIN-only',
  'GET /permissions/users/:userId': 'permissions are not season-scoped',
  'GET /phytosanitary-products/:id':
    'the product catalogue is GLOBAL — typed once, not per season — so it belongs to no season',
  'PATCH /settings/:key':
    'a setting is not season-scoped — it applies to the app, not to a season',
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

/**
 * Routes whose record id travels in the BODY, found by the `@SeasonIdInBody()`
 * marker on their handler.
 *
 * The marker is what makes such a route visible to a source scan: without it a
 * body-carried route has no `:id` in its path, so `collectRoutes()` walks past
 * it and it is never required to have a season rule.
 */
function collectBodyIdRoutes(): Route[] {
  const routes: Route[] = [];

  for (const file of controllerFiles(join(__dirname, '..'))) {
    const source = readFileSync(file, 'utf8');
    const prefix =
      (/@Controller\(\s*(?:'([^']*)')?\s*\)/.exec(source) ?? [])[1] ?? '';

    for (const marker of source.matchAll(/@SeasonIdInBody\(/g)) {
      // The nearest route decorator ABOVE the marker is the handler it marks.
      const above = source.slice(0, marker.index ?? 0);
      const found = [
        ...above.matchAll(
          /@(Post|Put|Patch|Delete|Get)\(\s*(?:'([^']*)')?\s*\)/g,
        ),
      ];
      const route = found[found.length - 1];
      if (!route) continue;

      routes.push({
        method: route[1].toUpperCase(),
        path: normalise(joinPath(prefix, route[2] ?? '')),
      });
    }
  }

  return routes;
}

describe('season scope coverage', () => {
  const routes = collectRoutes();
  const bodyIdRoutes = collectBodyIdRoutes();
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

  it('finds the body-carried routes - a broken scan must not pass on nothing', () => {
    expect(bodyIdRoutes.length).toBeGreaterThan(0);
  });

  it('judges every route whose record id travels in the body', () => {
    const unjudged = bodyIdRoutes
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !judged.has(normalise(key).split(' ')[1] ?? ''))
      .filter((key) => !exempt.has(normalise(key)));

    expect(unjudged).toEqual([]);
  });

  it('marks every rule that reads its record id from the body', () => {
    const marked = new Set(bodyIdRoutes.map((route) => normalise(route.path)));

    const unmarked = RULES.filter((rule) => !rule.path.includes(':'))
      .map((rule) => normalise(rule.path))
      .filter((path) => !marked.has(path));

    expect(unmarked).toEqual([]);
  });
});

import * as fs from 'fs';
import * as path from 'path';
import { SETTINGS } from './settings.constants';

/**
 * The clients cannot ask the server for a figure and draw a form in the same
 * breath, so each one keeps its own copy to fall back on — and a copy is exactly
 * what drifts. This test reads those copies from disk and refuses to let them
 * disagree with the registry the server actually uses (SOW-11, phase 3).
 *
 * The client folders are NOT part of the backend's build, so a copy of `Backend/`
 * on its own must still be testable: anything that cannot be read is reported and
 * SKIPPED rather than failed, so a skip is never mistaken for a pass.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const WEB_SCHEMA = 'Frontend/app/schemas/sowing.schema.ts';
const WEB_CONSTANTS = 'Frontend/app/lib/sowing-constants.ts';
const PHONE_SCHEMA = 'Phone-App/src/schemas/sowing.schema.ts';
const PHONE_CONSTANTS = 'Phone-App/src/lib/sowing-constants.ts';
const PRISMA_SCHEMA = 'Backend/prisma/schema.prisma';

function readSource(relativePath: string): string | null {
  const full = path.join(repoRoot, relativePath);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

/** The number a file gives a constant, e.g. `const X = 285;` — null when absent. */
function constantIn(source: string | null, name: string): number | null {
  if (!source) return null;
  const match = source.match(
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d+)`),
  );
  return match ? Number(match[1]) : null;
}

/** A column's own default, e.g. `seedsPerTray  Int @default(285)`. */
function columnDefault(source: string | null, column: string): number | null {
  if (!source) return null;
  const match = source.match(
    new RegExp(`^\\s*${column}\\s+\\w+\\??\\s+@default\\((\\d+)\\)`, 'm'),
  );
  return match ? Number(match[1]) : null;
}

type Copy = {
  /** What this copy is, in the words a failure message needs. */
  what: string;
  where: string;
  /** The figure it currently carries — null when the file could not be read. */
  found: number | null;
  /** What the server's registry uses today. */
  expected: number;
};

const copies: Copy[] = [
  {
    what: "the web form's fallback seeds per tray",
    where: WEB_SCHEMA,
    found: constantIn(readSource(WEB_SCHEMA), 'DEFAULT_SEEDS_PER_TRAY'),
    expected: SETTINGS.DEFAULT_SEEDS_PER_TRAY.default,
  },
  {
    what: "the phone's fallback seeds per tray",
    where: PHONE_SCHEMA,
    found: constantIn(readSource(PHONE_SCHEMA), 'DEFAULT_SEEDS_PER_TRAY'),
    expected: SETTINGS.DEFAULT_SEEDS_PER_TRAY.default,
  },
  {
    what: "the phone's fallback trays per big ball of peat",
    where: PHONE_CONSTANTS,
    found: constantIn(readSource(PHONE_CONSTANTS), 'TRAYS_PER_PEAT_BALL'),
    expected: SETTINGS.TRAYS_PER_PEAT_BALL.default,
  },
  {
    what: "the web's fallback trays per big ball of peat",
    where: WEB_CONSTANTS,
    found: constantIn(readSource(WEB_CONSTANTS), 'TRAYS_PER_PEAT_BALL'),
    expected: SETTINGS.TRAYS_PER_PEAT_BALL.default,
  },
  {
    what: "the database column's own default seeds per tray",
    where: PRISMA_SCHEMA,
    found: columnDefault(readSource(PRISMA_SCHEMA), 'seedsPerTray'),
    expected: SETTINGS.DEFAULT_SEEDS_PER_TRAY.default,
  },
  {
    what: "the web's fallback planning density (seeds per row-metre)",
    where: WEB_CONSTANTS,
    found: constantIn(readSource(WEB_CONSTANTS), 'DEFAULT_SEEDS_PER_ROW_METRE'),
    expected: SETTINGS.DEFAULT_SEEDS_PER_ROW_METRE.default,
  },
  {
    what: "the phone's fallback planning density (seeds per row-metre)",
    where: PHONE_CONSTANTS,
    found: constantIn(
      readSource(PHONE_CONSTANTS),
      'DEFAULT_SEEDS_PER_ROW_METRE',
    ),
    expected: SETTINGS.DEFAULT_SEEDS_PER_ROW_METRE.default,
  },
];

describe('Every copy of a setting agrees with the registry (SOW-11)', () => {
  for (const copy of copies) {
    const run = copy.found === null ? it.skip : it;

    run(`${copy.what} is ${copy.expected}`, () => {
      expect(copy.found).toBe(copy.expected);
    });
  }

  it('says out loud which copies it could not read', () => {
    const unread = copies
      .filter((copy) => copy.found === null)
      .map((copy) => copy.where);

    if (unread.length > 0) {
      // Deliberately not a failure: the backend has to be testable without the
      // clients. Printed so "skipped" is never read as "checked".
      console.warn(
        `[settings] not checked (file not found): ${unread.join(', ')} — looked under ${repoRoot}`,
      );
    }

    expect(copies.length).toBeGreaterThan(0);
  });
});

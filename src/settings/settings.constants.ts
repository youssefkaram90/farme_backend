import {
  DEFAULT_SEEDS_PER_ROW_METRE,
  DEFAULT_SEEDS_PER_TRAY,
  TRAYS_PER_PEAT_BALL,
} from '../common/sowing.constants';

/**
 * The settings this app has, and everything known about each one.
 *
 * **The registry is code; the table holds only values.** That is deliberate:
 *
 * - the table can never collect a mistyped key, because `set()` refuses a key that
 *   is not in here;
 * - every setting has a type and bounds, so a form cannot store `"abc"` or `0`;
 * - the label and the help text are reviewed with the change instead of being typed
 *   into a form, where they could be edited into nonsense;
 * - `default` is the compiled constant, so an absent row — or a table that cannot
 *   be read — is never an error. The app falls back to the figure it shipped with
 *   rather than blocking a sowing in the field (SOW-11, phase 2).
 *
 * Only figures that are safe to change **after** records exist belong here. A
 * number that stored records were derived from must be versioned or stored on the
 * row first — which is what phase 1 did for peat before `TRAYS_PER_PEAT_BALL`
 * could be added below.
 */
/** The settings that exist. Adding one means adding an entry to `SETTINGS`. */
export type SettingKey =
  | 'DEFAULT_SEEDS_PER_TRAY'
  | 'TRAYS_PER_PEAT_BALL'
  | 'DEFAULT_SEEDS_PER_ROW_METRE';

export type SettingType = 'int';

export type SettingDefinition = {
  key: SettingKey;
  /** Shown as the field's label. */
  label: string;
  /** Shown under the field. Plain language, and it says what does NOT change. */
  help: string;
  type: SettingType;
  min: number;
  max: number;
  /** The figure the app shipped with — used when no row exists. */
  default: number;
};

export const SETTINGS: Record<SettingKey, SettingDefinition> = {
  DEFAULT_SEEDS_PER_TRAY: {
    key: 'DEFAULT_SEEDS_PER_TRAY',
    label: 'Seeds per tray',
    help: 'How many seeds one tray holds. Used as the default when a sowing is recorded — sowings already recorded keep the number they were recorded with.',
    type: 'int',
    min: 1,
    max: 100_000,
    default: DEFAULT_SEEDS_PER_TRAY,
  },
  TRAYS_PER_PEAT_BALL: {
    key: 'TRAYS_PER_PEAT_BALL',
    label: 'Trays per big ball of peat',
    help: 'How many trays one big ball of peat fills. Used to work out the peat a NEW sowing takes — sowings already recorded keep the figure they were recorded with, so correcting or deleting them gives back exactly what they took.',
    type: 'int',
    min: 1,
    max: 100_000,
    default: TRAYS_PER_PEAT_BALL,
  },
  DEFAULT_SEEDS_PER_ROW_METRE: {
    key: 'DEFAULT_SEEDS_PER_ROW_METRE',
    label: 'Seeds per metre of row (field planning)',
    help: 'The density a field (LPM) line is planned at, per metre of ROW. A field plan works its seed out from this, the lines and the metres per line — so nobody has to type a seed total. Same for every variety, and for PLANNING only: what a sowing actually used is recorded when it is executed. Plans already made keep the rate they were planned with.',
    type: 'int',
    min: 1,
    max: 10_000,
    default: DEFAULT_SEEDS_PER_ROW_METRE,
  },
};

/** Whether a string names a setting this app knows about. */
export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTINGS, value);
}

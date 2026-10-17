import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SETTINGS,
  isSettingKey,
  type SettingDefinition,
  type SettingKey,
} from './settings.constants';
import type { Actor } from '../common/actor';

/** One setting, as the settings page and the clients read it. */
export type SettingView = {
  key: SettingKey;
  /** The figure in force: the stored row, or the compiled default. */
  value: number;
  /** `null` when no row exists — the app is running on its built-in figure. */
  storedValue: string | null;
  label: string;
  help: string;
  min: number;
  max: number;
  default: number;
  updatedAt: Date | null;
  updatedBy: string | null;
};

/**
 * The figures the farm can change without a developer (SOW-11, phase 2).
 *
 * ## Never an error
 *
 * `get()` answers with the compiled default when the row is missing, and also when
 * the stored text does not parse. Every path that uses these numbers today
 * *cannot fail*, and making a sowing depend on a settings lookup succeeding would
 * trade a wrong number for a blocked field worker. A bad value is refused at the
 * door by `set()` and repaired by the settings page; it is never a reason to
 * refuse work.
 *
 * That promise has to cover the table and not only a row in it. It did not: on a
 * database that had no `Setting` table yet, the read raised P2021 and travelled all
 * the way out, so **a sowing could not be recorded because a figure could not be
 * looked up** (found 2026-10-07). A missing table now takes the same road as a
 * missing row.
 *
 * ## No cache
 *
 * Each `get()` is one primary-key lookup. A cache would need invalidating on write,
 * and a stale figure here is exactly the class of bug this work exists to remove —
 * so the read is repeated and correctness is not traded for a query.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  /** Whether the "cannot read the table" warning has been printed yet. */
  private warnedAboutTable = false;

  constructor(private readonly prismaService: PrismaService) {}

  /** The value in force for one setting. */
  async get(key: SettingKey): Promise<number> {
    const row = await this.readRow(key);

    return this.readValue(key, row?.value);
  }

  /** Every setting with its value and its last change — the settings page payload. */
  async findAll(): Promise<SettingView[]> {
    const rows = await this.readRows();
    const byKey = new Map(rows.map((row) => [row.key, row]));

    return Object.values(SETTINGS).map((definition) => {
      const row = byKey.get(definition.key);

      return {
        key: definition.key,
        value: this.readValue(definition.key, row?.value),
        storedValue: row?.value ?? null,
        label: definition.label,
        help: definition.help,
        min: definition.min,
        max: definition.max,
        default: definition.default,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
  }

  /**
   * Store a value.
   *
   * Refuses a key that is not in the registry, so the table cannot fill up with
   * settings nothing reads, and refuses a value outside the setting's own bounds
   * with a sentence naming the field — see `update-setting.dto.ts`.
   */
  async set(key: string, raw: unknown, actor: Actor): Promise<SettingView> {
    if (!isSettingKey(key)) {
      throw new BadRequestException(`There is no setting called "${key}".`);
    }

    const definition = SETTINGS[key];
    const value = this.parse(raw, definition);

    try {
      await this.prismaService.setting.upsert({
        where: { key },
        create: { key, value: String(value), updatedBy: actor.name },
        update: { value: String(value), updatedBy: actor.name },
      });
    } catch (error) {
      // Reads fall back quietly; a WRITE reports. A figure the farm asked for must
      // never come back looking saved when it was not stored.
      this.logger.error(
        `Storing the setting "${key}" failed. (${this.reason(error)})`,
      );
      throw new ServiceUnavailableException(
        'The figure could not be saved. Nothing was changed — please try again.',
      );
    }

    const all = await this.findAll();
    return all.find((setting) => setting.key === key)!;
  }

  /** The stored text, or the compiled default when there is nothing usable. */
  private readValue(key: SettingKey, raw: string | undefined): number {
    const definition = SETTINGS[key];
    if (raw === undefined) return definition.default;

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : definition.default;
  }

  /**
   * One row — or `null` when the table cannot be read at all.
   *
   * Not the same thing as a missing row, which is the ordinary "use the built-in
   * figure" case. A database without the table raises P2021 here, and that error
   * used to travel all the way out of a sowing.
   */
  private async readRow(key: SettingKey) {
    try {
      return await this.prismaService.setting.findUnique({ where: { key } });
    } catch (error) {
      this.warnOnce(error);
      return null;
    }
  }

  /** Every row — or none when the table cannot be read. See `readRow`. */
  private async readRows() {
    try {
      return await this.prismaService.setting.findMany();
    } catch (error) {
      this.warnOnce(error);
      return [];
    }
  }

  /**
   * Say it once per process.
   *
   * One sowing reads two of these and one settings page reads the lot, so a warning
   * per failure would bury the line that matters under itself.
   */
  private warnOnce(error: unknown): void {
    if (this.warnedAboutTable) return;
    this.warnedAboutTable = true;

    this.logger.warn(
      `The settings table could not be read, so the built-in figures are in use. (${this.reason(error)})`,
    );
  }

  /** The first line of a failure, without the driver's code frame. */
  private reason(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    return error.message.split('\n')[0];
  }

  /** Validate what was sent, with a sentence a person can act on. */
  private parse(raw: unknown, definition: SettingDefinition): number {
    const text = typeof raw === 'string' ? raw.trim() : raw;

    if (text === '' || text === null || text === undefined) {
      throw new BadRequestException(`${definition.label} needs a value.`);
    }

    const value = Number(text);

    if (!Number.isFinite(value)) {
      throw new BadRequestException(
        `${definition.label} must be a whole number.`,
      );
    }

    if (definition.type === 'int' && !Number.isInteger(value)) {
      throw new BadRequestException(
        `${definition.label} must be a whole number.`,
      );
    }

    if (value < definition.min || value > definition.max) {
      throw new BadRequestException(
        `${definition.label} must be between ${definition.min} and ${definition.max}.`,
      );
    }

    return value;
  }
}

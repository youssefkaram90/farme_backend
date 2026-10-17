import { NotFoundException } from '@nestjs/common';
import { TrayTransportService } from './tray-transport.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SeasonService } from '../season/season.service';

/**
 * TRAY-06 — leaving a tunnel has to be recorded.
 *
 * `PlantStock.location` is the copy that the plant-stock list falls back to for a
 * batch with no transport rows ("not transported yet → planned location"), and only
 * `assign` ever wrote it. Removing the last transport therefore left the batch filed
 * under a tunnel it had left: the variety stayed in that tunnel's plant stock and the
 * tunnel looked occupied for ever.
 *
 * These tests pin the two halves of the rule — the surviving tunnel wins, and nothing
 * surviving means "Not assigned" — and that the correction happens inside the SAME
 * transaction as the delete, so the two can never disagree.
 */

type AssignmentRow = {
  id: string;
  ssmSowingId: string;
  tunnelId: string;
  numberOfTrays: number;
  transportDate: Date;
  tunnel: { number: string };
};

type StockRow = { id: string; ssmSowingId: string; location: string };

type SowingRow = {
  id: string;
  tunnelId: string | null;
  tunnelNumber: string | null;
};

class FakeTray {
  assignments: AssignmentRow[] = [];
  stockRows: StockRow[] = [];
  sowings: SowingRow[] = [];

  /** Every sowing-tunnel correction the service made, in order. */
  sowingWrites: { tunnelId: string | null; tunnelNumber: string | null }[] = [];

  /** True while `$transaction` runs, so a test can prove the write stayed inside it. */
  inTransaction = false;

  /** Every `updateMany` the service made, in order. */
  locationWrites: {
    ssmSowingId: string;
    location: string;
    inTransaction: boolean;
  }[] = [];

  sowingTunnelAssignment = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.assignments.find((a) => a.id === where.id) ?? null),

    /** Only the `ssmSowingId` + `transportDate desc` query the service makes. */
    findFirst: ({ where }: { where: { ssmSowingId: string } }) => {
      const mine = this.assignments
        .filter((a) => a.ssmSowingId === where.ssmSowingId)
        .sort((a, b) => b.transportDate.getTime() - a.transportDate.getTime());

      return Promise.resolve(mine[0] ?? null);
    },

    delete: ({ where }: { where: { id: string } }) => {
      const row = this.assignments.find((a) => a.id === where.id);
      this.assignments = this.assignments.filter((a) => a.id !== where.id);
      return Promise.resolve(row);
    },
  };

  plantStock = {
    updateMany: ({
      where,
      data,
    }: {
      where: { ssmSowingId: string };
      data: { location: string };
    }) => {
      let count = 0;

      for (const row of this.stockRows) {
        if (row.ssmSowingId === where.ssmSowingId) {
          row.location = data.location;
          count += 1;
        }
      }

      this.locationWrites.push({
        ssmSowingId: where.ssmSowingId,
        location: data.location,
        inTransaction: this.inTransaction,
      });

      return Promise.resolve({ count });
    },
  };

  sowingSSM = {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.sowings.find((s) => s.id === where.id) ?? null),

    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: { tunnelId: string | null; tunnelNumber: string | null };
    }) => {
      const row = this.sowings.find((s) => s.id === where.id);

      if (row) {
        row.tunnelId = data.tunnelId;
        row.tunnelNumber = data.tunnelNumber;
      }

      this.sowingWrites.push({
        tunnelId: data.tunnelId,
        tunnelNumber: data.tunnelNumber,
      });

      return Promise.resolve(row);
    },
  };

  $transaction = async (callback: (tx: FakeTray) => Promise<unknown>) => {
    const assignments = [...this.assignments];
    const stockRows = this.stockRows.map((row) => ({ ...row }));
    const sowings = this.sowings.map((row) => ({ ...row }));

    this.inTransaction = true;
    try {
      return await callback(this);
    } catch (error) {
      this.assignments = assignments;
      this.stockRows = stockRows;
      this.sowings = sowings;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  };
}

const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const db = new FakeTray();
  db.stockRows.push({ id: 'ps-1', ssmSowingId: 'sowing-1', location: 'T2' });
  db.sowings.push({
    id: 'sowing-1',
    tunnelId: 'tunnel-T2',
    tunnelNumber: 'T2',
  });

  const service = new TrayTransportService(
    db as unknown as PrismaService,
    {} as unknown as SeasonService,
  );

  return { service, db };
}

const transport = (
  id: string,
  tunnelNumber: string,
  daysAgo: number,
): AssignmentRow => ({
  id,
  ssmSowingId: 'sowing-1',
  tunnelId: `tunnel-${tunnelNumber}`,
  numberOfTrays: 10,
  transportDate: new Date(Date.now() - daysAgo * DAY),
  tunnel: { number: tunnelNumber },
});

describe('leaving a tunnel is recorded (TRAY-06)', () => {
  it('takes the batch out of the tunnel when the last transport goes', async () => {
    const { service, db } = setup();
    db.assignments.push(transport('a-1', 'T2', 1));

    const result = await service.remove('a-1');

    expect(result).toEqual({ message: 'Assignment removed' });
    expect(db.assignments).toHaveLength(0);
    // The plant stock no longer claims to be in T2.
    expect(db.stockRows[0].location).toBe('Not assigned');
  });

  it('re-points the batch at the tunnel that is left', async () => {
    const { service, db } = setup();
    db.assignments.push(transport('a-1', 'T1', 5));
    db.assignments.push(transport('a-2', 'T2', 1));

    await service.remove('a-2');

    // The most recent surviving transport wins: the batch is in T1 now.
    expect(db.stockRows[0].location).toBe('T1');
  });

  it('writes the location inside the same transaction as the delete', async () => {
    const { service, db } = setup();
    db.assignments.push(transport('a-1', 'T2', 1));

    await service.remove('a-1');

    expect(db.locationWrites).toHaveLength(1);
    expect(db.locationWrites[0].inTransaction).toBe(true);
  });

  it('refuses a transport that does not exist, and writes nothing', async () => {
    const { service, db } = setup();

    await expect(service.remove('a-gone')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(db.locationWrites).toHaveLength(0);
    expect(db.stockRows[0].location).toBe('T2');
  });
});

describe('emptying a tunnel releases it (TRAY-07)', () => {
  it('lets go of the sowing that pointed at it, so the tunnel can be corrected', async () => {
    const { service, db } = setup();
    db.assignments.push(transport('a-1', 'T2', 1));

    await service.remove('a-1');

    // The sowing stops claiming to be in T2 — this is what kept the tunnel "in use"
    // and made `canEdit` false for ever in the tunnels screen.
    expect(db.sowings[0].tunnelId).toBeNull();
    expect(db.sowings[0].tunnelNumber).toBeNull();
    expect(db.stockRows[0].location).toBe('Not assigned');
  });

  it('moves the sowing to the transport that is left, not to nothing', async () => {
    const { service, db } = setup();
    db.assignments.push(transport('a-1', 'T1', 5));
    db.assignments.push(transport('a-2', 'T2', 1));

    await service.remove('a-2');

    expect(db.sowings[0].tunnelId).toBe('tunnel-T1');
    expect(db.sowings[0].tunnelNumber).toBe('T1');
  });

  it('leaves a tunnel the sowing never pointed at alone', async () => {
    const { service, db } = setup();
    // The operator recorded the sowing against T9; the trays went to T2.
    db.sowings[0].tunnelId = 'tunnel-T9';
    db.sowings[0].tunnelNumber = 'T9';
    db.assignments.push(transport('a-1', 'T2', 1));

    await service.remove('a-1');

    // T9 was a decision, not a description: an unrelated removal must not wipe it.
    expect(db.sowings[0].tunnelId).toBe('tunnel-T9');
    expect(db.sowings[0].tunnelNumber).toBe('T9');
    expect(db.sowingWrites).toHaveLength(0);
    // The plant stock still follows the trays, because that copy describes reality.
    expect(db.stockRows[0].location).toBe('Not assigned');
  });
});

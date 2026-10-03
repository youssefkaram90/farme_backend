import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { ERROR_MESSAGES } from '../../common/error-messages';
import { UserRole } from '../../users/enums/userRole.enum';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The permission boundary (PERM-04).
 *
 * This is the code that decides whether a signed-in person may call a route, so
 * it is the one place where "it looked right" is not good enough. Four things
 * are being pinned down here:
 *
 *   1. ADMIN bypasses everything, and does so without a database round-trip.
 *   2. A route listing several permissions demands **all** of them.
 *   3. Nobody signed in gets **401**; signed in but not allowed gets **403**.
 *   4. The permission list is read fresh on every request — deliberately not
 *      cached, so a revoked permission stops working on the next request, not
 *      when some timer expires.
 *
 * The controller below is a stand-in for the real ones: the guard reads the
 * permissions a route asks for via the `@RequirePermissions` metadata, so the
 * test drives that metadata the same way Nest does.
 */

type Handler = (...args: never[]) => unknown;

class StaffController {
  @RequirePermissions('users.view')
  list() {
    /* stand-in */
  }

  @RequirePermissions('stock.adjust', 'stock.view')
  adjust() {
    /* stand-in */
  }

  /** No `@RequirePermissions` at all — the guard must not touch this route. */
  ping() {
    /* stand-in */
  }
}

const handlerOf = (name: keyof StaffController): Handler =>
  Object.getOwnPropertyDescriptor(StaffController.prototype, name)!
    .value as Handler;

function contextFor(handler: Handler, user?: unknown): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => StaffController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

type Link = { userId: string; permission: { name: string } };

const link = (userId: string, name: string): Link => ({
  userId,
  permission: { name },
});

/**
 * The guard and the fake table it reads, so a test can also ask *whether* the
 * query ran and *what* it was asked for.
 */
function build(links: Link[] = []) {
  const findMany = jest.fn(({ where }: { where: { userId: string } }) =>
    Promise.resolve(links.filter((row) => row.userId === where.userId)),
  );

  const prisma = {
    userPermission: { findMany },
  } as unknown as PrismaService;

  return { guard: new PermissionsGuard(new Reflector(), prisma), findMany };
}

const MANAGER = { id: 'user-1', role: UserRole.MANAGER };
const ADMIN = { id: 'admin-1', role: UserRole.ADMIN };

describe('PermissionsGuard', () => {
  describe('the ADMIN bypass', () => {
    it('lets an ADMIN through without reading the permission table', async () => {
      const { guard, findMany } = build();

      await expect(
        guard.canActivate(contextFor(handlerOf('list'), ADMIN)),
      ).resolves.toBe(true);

      expect(findMany).not.toHaveBeenCalled();
    });

    it('lets an ADMIN through even on a route no other role may call', async () => {
      const { guard } = build();

      await expect(
        guard.canActivate(contextFor(handlerOf('adjust'), ADMIN)),
      ).resolves.toBe(true);
    });
  });

  describe('everyone else', () => {
    it('allows a user who holds the required permission', async () => {
      const { guard } = build([link(MANAGER.id, 'users.view')]);

      await expect(
        guard.canActivate(contextFor(handlerOf('list'), MANAGER)),
      ).resolves.toBe(true);
    });

    it('does not care about the role label once the permission is held', async () => {
      const plainUser = { id: 'user-2', role: UserRole.USER };
      const { guard } = build([link(plainUser.id, 'users.view')]);

      await expect(
        guard.canActivate(contextFor(handlerOf('list'), plainUser)),
      ).resolves.toBe(true);
    });

    it('refuses with 403 when the permission is missing', async () => {
      const { guard } = build([link(MANAGER.id, 'stock.view')]);

      await expect(
        guard.canActivate(contextFor(handlerOf('list'), MANAGER)),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        guard.canActivate(contextFor(handlerOf('list'), MANAGER)),
      ).rejects.toThrow(ERROR_MESSAGES.notAllowed);
    });

    it('demands EVERY permission a route lists, not just one of them', async () => {
      const { guard } = build([link(MANAGER.id, 'stock.view')]);

      await expect(
        guard.canActivate(contextFor(handlerOf('adjust'), MANAGER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("asks for the caller's own permissions, nobody else's", async () => {
      const { guard, findMany } = build([link(MANAGER.id, 'users.view')]);

      await guard.canActivate(contextFor(handlerOf('list'), MANAGER));

      expect(findMany).toHaveBeenCalledWith({
        where: { userId: MANAGER.id },
        include: { permission: true },
      });
    });
  });

  describe('nobody signed in', () => {
    it('answers 401 — not 403 — on a guarded route', async () => {
      const { guard, findMany } = build();

      await expect(
        guard.canActivate(contextFor(handlerOf('list'))),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      await expect(
        guard.canActivate(contextFor(handlerOf('list'))),
      ).rejects.toThrow(ERROR_MESSAGES.notSignedIn);

      expect(findMany).not.toHaveBeenCalled();
    });

    it('leaves a route that asks for no permission alone', async () => {
      const { guard, findMany } = build();

      await expect(
        guard.canActivate(contextFor(handlerOf('ping'))),
      ).resolves.toBe(true);

      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('the deliberate lack of a cache', () => {
    it('reads the permissions again on the next request', async () => {
      const { guard, findMany } = build([link(MANAGER.id, 'users.view')]);
      const context = () => contextFor(handlerOf('list'), MANAGER);

      await guard.canActivate(context());
      await guard.canActivate(context());

      expect(findMany).toHaveBeenCalledTimes(2);
    });

    it('refuses the very next request after the permission is revoked', async () => {
      const links = [link(MANAGER.id, 'users.view')];
      const { guard, findMany } = build(links);

      await expect(
        guard.canActivate(contextFor(handlerOf('list'), MANAGER)),
      ).resolves.toBe(true);

      // What an admin clicking "save" on the permissions screen would do.
      links.length = 0;

      await expect(
        guard.canActivate(contextFor(handlerOf('list'), MANAGER)),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(findMany).toHaveBeenCalledTimes(2);
    });
  });
});

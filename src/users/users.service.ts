import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import * as argon2 from 'argon2';
import { ERROR_MESSAGES } from '../common/error-messages';
import { UserRole } from './enums/userRole.enum';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}

  /**
   * Create a user, hashing the password.
   *
   * No `P2002` catch of its own: the global filter already answers a duplicate
   * with the catalogued sentence for `User.name` — "A user with this name already
   * exists." — where a catch here replaced it with "Name already exists"
   * (USERS-06).
   */
  async create(data: CreateUserDto) {
    const hash = await argon2.hash(data.password);

    return this.prismaService.user.create({
      data: { ...data, password: hash },
      omit: { password: true },
    });
  }

  /**
   * A user WITH the password hash — the credential lookup behind sign-in.
   *
   * Only `AuthService.verifyUser` should use this. Anything that hands a user to
   * a client, or onto a request, wants `getUserSafe` (USERS-02).
   */
  async getUser(where: Prisma.UserWhereInput) {
    const user = await this.prismaService.user.findFirst({ where });

    if (!user) throw new NotFoundException(ERROR_MESSAGES.userNotFound);

    return user;
  }

  /**
   * A user WITHOUT the password hash.
   *
   * `getUser` keeps returning the hash because sign-in needs it to verify a
   * password; this is the one every other caller wants. It is what stops the hash
   * riding along on `/users/me`, on the user detail screen, and — worst of all —
   * on `request.user`, which the JWT strategy builds from this on EVERY
   * authenticated request (USERS-02 / X-09).
   */
  async getUserSafe(where: Prisma.UserWhereInput) {
    const user = await this.prismaService.user.findFirst({
      where,
      omit: { password: true },
    });

    if (!user) throw new NotFoundException(ERROR_MESSAGES.userNotFound);

    return user;
  }

  /**
   * The staff list, optionally narrowed by the search box.
   *
   * `name` and `lastName` are `contains` matches — typing part of a name is how a
   * search box is actually used. `role` is an `equals` match: it used to be
   * `contains`, which meant a substring search over a fixed vocabulary, so typing
   * "us" listed every USER and "an" listed every MANAGER (USERS-03). A role is
   * only ever meant exactly or not at all.
   *
   * Unpaginated on purpose (decided 2026-10-01): this is a farm's staff list —
   * tens of rows — and no screen polls it. Revisit if it grows into the hundreds;
   * paging with no paging UI would silently hide people.
   */
  async getUsers(q?: string) {
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            { role: { equals: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    return this.prismaService.user.findMany({
      where,
      omit: {
        password: true,
      },
    });
  }

  /**
   * Change one user's role.
   *
   * `updateMany` answered `{ count: 0 }` with a 200 whenever the id matched
   * nobody, so a typo'd id looked like success and the role silently stayed as it
   * was (USERS-01). `update` cannot do that: a missing row raises P2025, which is
   * turned into the ordinary "no such user" 404.
   */
  async updateUserRole(id: string, role: UserRole) {
    try {
      return await this.prismaService.user.update({
        where: { id },
        data: { role },
        omit: { password: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(ERROR_MESSAGES.userNotFound);
      }

      throw error;
    }
  }
}

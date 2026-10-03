import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import { User } from '../generated/prisma/client';
import { Response, Request } from 'express';
import { TokenPayload } from './token-payload';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ERROR_MESSAGES } from '../common/error-messages';

@Injectable()
export class AuthService {
  constructor(
    private userService: UsersService,
    private configService: ConfigService,
    private jwtService: JwtService,
    private prismaService: PrismaService,
  ) {}

  /**
   * Sign an access/refresh pair for one user.
   *
   * Shared by `signin` and `rotateRefreshToken`, which used to carry identical
   * copies of the expiries, the payloads and the two signing calls. That is how
   * a security setting — a cookie flag, a token lifetime — ends up changed in
   * one copy only (AUTH-05).
   */
  private signTokens(userId: string, familyId: string) {
    const accessExpiresAt = new Date(
      Date.now() +
        parseInt(
          this.configService.getOrThrow<string>('ACCESS_TOKEN_EXPIRATION'),
          10,
        ),
    );

    const refreshExpiresAt = new Date(
      Date.now() +
        parseInt(
          this.configService.getOrThrow<string>('REFRESH_TOKEN_EXPIRATION'),
          10,
        ),
    );

    const jti = randomUUID();

    const accessPayload: TokenPayload = {
      sub: userId,
      jti: '',
      type: 'access',
    };

    const refreshPayload: TokenPayload = {
      sub: userId,
      jti,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.configService.getOrThrow('JWT_ACCESS_TOKEN_SECRET'),
      expiresIn: `${this.configService.getOrThrow('ACCESS_TOKEN_EXPIRATION')}ms`,
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.getOrThrow('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: `${this.configService.getOrThrow('REFRESH_TOKEN_EXPIRATION')}ms`,
    });

    return {
      jti,
      familyId,
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
    };
  }

  /** Both auth cookies, with the flags they must always share. */
  private setAuthCookies(
    response: Response,
    tokens: {
      accessToken: string;
      refreshToken: string;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
    },
  ) {
    const secure = this.configService.get('NODE_ENV') === 'production';

    response.cookie('Authentication', tokens.accessToken, {
      httpOnly: true,
      secure,
      expires: tokens.accessExpiresAt,
      sameSite: 'lax',
    });

    response.cookie('Refresh', tokens.refreshToken, {
      httpOnly: true,
      secure,
      expires: tokens.refreshExpiresAt,
      sameSite: 'lax',
      path: '/',
    });
  }

  async signin(
    user: User,
    response: Response,
    metadata?: {
      deviceId?: string;
      deviceName?: string;
      userAgent?: string;
      ipAddress?: string;
    },
  ) {
    const familyId = randomUUID();
    const tokens = this.signTokens(user.id, familyId);

    await this.prismaService.refreshToken.create({
      data: {
        userId: user.id,
        jti: tokens.jti,
        familyId,
        hashedToken: await argon2.hash(tokens.refreshToken),
        deviceId: metadata?.deviceId,
        deviceName: metadata?.deviceName,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        expiresAt: tokens.refreshExpiresAt,
        lastUsedAt: new Date(),
      },
    });

    this.setAuthCookies(response, tokens);

    // RETURNED, not written: the controller owns the HTTP response (AUTH-05). The
    // body stays because the phone app keeps its tokens from it — the cookies are
    // for the browser.
    return {
      id: user.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async verifyUser(name: string, password: string) {
    try {
      const user = await this.userService.getUser({ name });
      const validPassword = await argon2.verify(user.password, password);

      if (!validPassword) throw new UnauthorizedException();

      return user;
    } catch (error) {
      // Only two things mean "wrong credentials": no such name, and a password
      // that does not match. Mapping EVERY failure onto that sentence is how a
      // database hiccup told the user their password was wrong, leaving them to
      // retype it while the server was broken (AUTH-09). Anything else is
      // rethrown, so the global filter logs it and answers 500.
      if (
        error instanceof UnauthorizedException ||
        error instanceof NotFoundException
      ) {
        throw new UnauthorizedException(ERROR_MESSAGES.invalidCredentials);
      }

      throw error;
    }
  }

  async verifyRefreshToken(refreshToken: string, jti: string) {
    try {
      const tokenRecord = await this.prismaService.refreshToken.findUnique({
        where: { jti },
      });

      if (!tokenRecord)
        throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);

      if (tokenRecord.expiresAt < new Date()) {
        throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
      }

      const isValid = await argon2.verify(
        tokenRecord.hashedToken,
        refreshToken,
      );
      if (!isValid) throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);

      // A REVOKED token is deliberately NOT refused here. `rotateRefreshToken`
      // owns that decision, because a token revoked a moment ago by the same
      // browser is a legitimate double refresh rather than an attack (AUTH-02).

      // Update last used timestamp — only for a live token, so a revoked one
      // never looks "used".
      if (!tokenRecord.revokedAt) {
        await this.prismaService.refreshToken.update({
          where: { id: tokenRecord.id },
          data: { lastUsedAt: new Date() },
        });
      }

      return tokenRecord;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
      }

      // A database hiccup is NOT a bad token: it used to be reported as one,
      // which signed the user out for something a retry would have fixed and hid
      // the real cause from the log. Letting it through means the global filter
      // logs it and answers 500 (AUTH-05).
      throw error;
    }
  }

  async rotateRefreshToken(
    oldTokenRecord: { id: string; familyId: string; userId: string },
    response: Response,
    metadata?: {
      deviceId?: string;
      deviceName?: string;
      userAgent?: string;
      ipAddress?: string;
    },
  ) {
    const tokens = this.signTokens(
      oldTokenRecord.userId,
      oldTokenRecord.familyId,
    );

    const hashedToken = await argon2.hash(tokens.refreshToken);

    // Claim the old token by flipping `revokedAt` in ONE conditional statement.
    // Whoever wins this race owns the rotation; the loser finds count === 0.
    //
    // This is what makes reuse detection real. The check in
    // `verifyRefreshToken` and this write used to be separate, so two requests
    // arriving together both passed every check and both handed out a live
    // token — the tripwire could only ever see what was revoked BEFORE the
    // request started (AUTH-02). Postgres blocks the losing UPDATE on the
    // winner's open transaction and re-evaluates the condition afterwards, so
    // the loser reliably sees count === 0 and the winner's new row.
    const outcome = await this.prismaService.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: oldTokenRecord.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (claimed.count === 0) {
        const previous = await tx.refreshToken.findUnique({
          where: { id: oldTokenRecord.id },
          select: {
            revokedAt: true,
            ipAddress: true,
            userAgent: true,
            deviceId: true,
          },
        });

        // A live row in the same family means this token was ROTATED moments
        // ago. After a sign-out the whole family is revoked, and a grace window
        // must never quietly undo a sign-out.
        const liveInFamily = await tx.refreshToken.count({
          where: { familyId: oldTokenRecord.familyId, revokedAt: null },
        });

        if (liveInFamily === 0 || !this.isDoubleRefresh(previous, metadata)) {
          // Handled OUTSIDE the transaction, so the family revocation is not
          // rolled back by the refusal that follows it.
          return 'reuse' as const;
        }
      }

      // Create new token with same familyId
      await tx.refreshToken.create({
        data: {
          userId: oldTokenRecord.userId,
          jti: tokens.jti,
          familyId: oldTokenRecord.familyId,
          hashedToken,
          deviceId: metadata?.deviceId,
          deviceName: metadata?.deviceName,
          userAgent: metadata?.userAgent,
          ipAddress: metadata?.ipAddress,
          expiresAt: tokens.refreshExpiresAt,
          lastUsedAt: new Date(),
        },
      });

      return 'rotated' as const;
    });

    if (outcome === 'reuse') {
      // A copy of a token that was already rotated — from another device, or
      // long after the rotation. Kill the whole family: every token descending
      // from that one login.
      await this.prismaService.refreshToken.updateMany({
        where: { familyId: oldTokenRecord.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
    }

    this.setAuthCookies(response, tokens);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * How long after a rotation a second refresh of the SAME token is still
   * accepted.
   *
   * The legitimate case is one browser with two tabs, both hitting the expired
   * token within milliseconds of each other (decided 2026-09-30). Seconds, not
   * minutes: long enough for the two requests to land, short enough that a
   * replay a minute later still trips the wire.
   */
  private static readonly DOUBLE_REFRESH_GRACE_MS = 15_000;

  /**
   * Is this the same browser refreshing twice, rather than a replay?
   *
   * Only fields the original request actually recorded are compared: a value
   * that was never stored cannot be compared, so it does not constrain.
   */
  private isDoubleRefresh(
    previous: {
      revokedAt: Date | null;
      ipAddress: string | null;
      userAgent: string | null;
      deviceId: string | null;
    } | null,
    metadata?: { deviceId?: string; userAgent?: string; ipAddress?: string },
  ): boolean {
    if (!previous?.revokedAt) return false;

    const ageMs = Date.now() - previous.revokedAt.getTime();
    if (ageMs > AuthService.DOUBLE_REFRESH_GRACE_MS) return false;

    return (
      AuthService.matches(previous.ipAddress, metadata?.ipAddress) &&
      AuthService.matches(previous.userAgent, metadata?.userAgent) &&
      AuthService.matches(previous.deviceId, metadata?.deviceId)
    );
  }

  private static matches(stored: string | null, sent: string | undefined) {
    if (!stored) return true;

    return stored === sent;
  }

  /**
   * Revoke the refresh token the caller presented — and only that one.
   *
   * The token is VERIFIED with the refresh secret first (AUTH-01): decoding it
   * unverified meant acting on a claim nobody had checked, and a payload that
   * was not well-formed base64url crashed with a 500 (AUTH-03).
   *
   * `updateMany` rather than `update`, scoped to `userId`: signing out twice is
   * not an error (AUTH-07 — `update` raised P2025, which the filter turned into
   * a 404 that aborted the controller *before* the cookies were cleared, leaving
   * the device signed in), and one account can never revoke another's token.
   */
  async signoutByToken(rawRefreshToken: string, userId: string) {
    let jti: string;

    try {
      jti = this.jwtService.verify<TokenPayload>(rawRefreshToken, {
        secret: this.configService.getOrThrow('JWT_REFRESH_TOKEN_SECRET'),
      }).jti;
    } catch {
      // Malformed, expired, or signed with another secret: there is nothing of
      // this user's to revoke, and that is not worth an error.
      return;
    }

    await this.prismaService.refreshToken.updateMany({
      where: { jti, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async signoutAll(userId: string) {
    await this.prismaService.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

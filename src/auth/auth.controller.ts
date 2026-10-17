import { Controller, Post, UseGuards, Res, Req, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { User } from '../generated/prisma/client';
import type { Response, Request } from 'express';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Sign in.
   *
   * There is deliberately NO rate limit here (decided 2026-10-05, AUTH-19). Every
   * attempt costs an argon2 verification — a tenth of a second of CPU by design,
   * which is exactly what makes guessing a password expensive — and nothing
   * counts how fast the attempts arrive.
   *
   * The reasoning, so this is not mistaken for an oversight: this is an internal
   * tool, on a private network, used by people who already have an account, so
   * the realistic threat is low; and an address-based limit punishes a whole farm
   * office that shares one internet connection.
   *
   * If that ever changes — the API becoming reachable from outside, or a role
   * worth protecting harder — add `@nestjs/throttler` and put the tight limit
   * HERE (a handful of attempts a minute per address), rather than a
   * hand-rolled counter: that lives in one process, resets on restart, and would
   * silently halve itself the day a second backend is started. Whatever the
   * limit, the refusal must be a plain sentence written backend-side (429), so
   * the web and the phone show the same words.
   */
  @Post('signin')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(LocalAuthGuard)
  signin(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    return this.authService.signin(user, response, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });
  }

  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtRefreshAuthGuard)
  async refreshToken(
    @CurrentUser()
    tokenRecord: { id: string; familyId: string; userId: string },
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    return this.authService.rotateRefreshToken(tokenRecord, response, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });
  }

  /**
   * Sign out.
   *
   * Deliberately NOT behind `JwtAuthGuard` (AUTH-13). Requiring a live access
   * token here meant that a user idle long enough for it to expire got a 401
   * *before* the cookies were cleared: the button looked like it worked, but the
   * still-valid `Refresh` cookie kept the session alive and the next page load
   * signed them back in. Presenting the refresh token IS the proof of ownership —
   * there is nothing else to authorise, so this endpoint can never answer "you
   * are not allowed to sign out".
   */
  @Post('signout')
  async signout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body('refreshToken') bodyRefreshToken?: string,
  ) {
    // The refresh token comes from the cookie (web) or the body (mobile).

    const cookieRefreshToken: unknown = request.cookies?.Refresh;

    const rawRefreshToken =
      typeof cookieRefreshToken === 'string'
        ? cookieRefreshToken
        : bodyRefreshToken;

    if (typeof rawRefreshToken === 'string' && rawRefreshToken.length > 0) {
      await this.authService.signoutByToken(rawRefreshToken);
    }

    // Always cleared, whatever happened above: a sign-out that leaves the
    // cookies behind is worse than one that reports a failure.
    response.clearCookie('Authentication');
    response.clearCookie('Refresh', { path: '/' });
    return { message: 'signed out' };
  }

  @Post('signout-all')
  @UseGuards(JwtAuthGuard)
  async signoutAll(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.signoutAll(user.id);
    response.clearCookie('Authentication');
    response.clearCookie('Refresh', { path: '/' });
    return { message: 'Logged out from all devices' };
  }
}

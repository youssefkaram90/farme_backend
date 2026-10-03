import { Controller, Post, UseGuards, Res, Req, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { localAuthGuard } from './guards/local-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { User } from '../generated/prisma/client';
import type { Response, Request } from 'express';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signin')
  @UseGuards(localAuthGuard)
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

  @Post('signout')
  @UseGuards(JwtAuthGuard)
  async signout(
    @CurrentUser() user: User,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body('refreshToken') bodyRefreshToken?: string,
  ) {
    // The refresh token comes from the cookie (web) or the body (mobile).
    const rawRefreshToken = request.cookies?.Refresh ?? bodyRefreshToken;

    if (rawRefreshToken) {
      // Verified inside, and only ever the caller's own token — anything else is
      // ignored rather than crashed on (AUTH-01 / AUTH-03 / AUTH-07).
      await this.authService.signoutByToken(rawRefreshToken, user.id);
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

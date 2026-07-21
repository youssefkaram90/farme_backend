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
    user: {
      user: User;
      tokenRecord: { id: string; familyId: string; userId: string };
    },
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    return this.authService.rotateRefreshToken(user.tokenRecord, response, {
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
    // Extract the refresh token from: cookie (web) or request body (mobile)
    const rawRefreshToken = request.cookies?.Refresh ?? bodyRefreshToken;

    if (rawRefreshToken) {
      // Decode the JWT to get jti (without verifying — access token already verified by guard)
      const payload = JSON.parse(
        Buffer.from(rawRefreshToken.split('.')[1], 'base64').toString(),
      );
      if (payload.jti) {
        await this.authService.signout(payload.jti);
      }
    }

    response.clearCookie('Authentication');
    response.clearCookie('Refresh', { path: '/auth/refresh' });
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
    response.clearCookie('Refresh', { path: '/auth/refresh' });
    return { message: 'Logged out from all devices' };
  }
}

import { Controller, Post, UseGuards, Res, Get, Req } from '@nestjs/common';
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
    @CurrentUser() user: { user: User; tokenRecord: { id: string; familyId: string; userId: string } },
    @Res({ passthrough: true }) response: Response,
    @Req() request: Request,
  ) {
    return this.authService.rotateRefreshToken(
      user.tokenRecord,
      response,
      {
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      },
    );
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: User,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Extract jti from the access token — we'd need to decode it
    // For simplicity, clear cookies
    response.clearCookie('Authentication');
    response.clearCookie('Refresh');
    return { message: 'Logged out' };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  async logoutAll(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logoutAll(user.id);
    response.clearCookie('Authentication');
    response.clearCookie('Refresh');
    return { message: 'Logged out from all devices' };
  }
}
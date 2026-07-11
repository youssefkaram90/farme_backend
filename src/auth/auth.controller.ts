import { Controller, Post, UseGuards, Res, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { localAuthGuard } from './guards/local-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { User } from '../generated/prisma/client';
import type { Response } from 'express';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signin')
  @UseGuards(localAuthGuard)
  signin(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.signin(user, response);
  }

  @Post('refresh')
  @UseGuards(JwtRefreshAuthGuard)
  async refreshToken(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.signin(user, response);
  }
}

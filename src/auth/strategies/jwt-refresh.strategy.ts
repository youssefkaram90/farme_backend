import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { TokenPayload } from '../token-payload';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        JwtRefreshStrategy.refreshTokenExtractor,
      ]),
      secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_TOKEN_SECRET'),
      passReqToCallback: true,
    });
  }

  private static refreshTokenExtractor(request: Request) {
    if (request.cookies?.Refresh) return request.cookies.Refresh;

    const refreshToken = request.headers.authorization;
    if (!refreshToken?.startsWith('Bearer')) return null;

    return refreshToken.split(' ')[1];
  }

  async validate(request: Request, payload: TokenPayload) {
    const token = JwtRefreshStrategy.refreshTokenExtractor(request);
    if (!token) throw new UnauthorizedException('Refresh token not found');

    return this.authService.verifyRefreshToken(token, payload.jti);
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ERROR_MESSAGES } from '../../common/error-messages';
import { AuthService } from '../auth.service';
import { RefreshTokenPayload } from '../token-payload';

function extractRefreshToken(request: Request): string | null {
  const typedRequest = request as unknown as {
    cookies?: Record<string, unknown>;
  };

  const cookieToken = typedRequest.cookies?.['Refresh'];

  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  const authHeader = request.headers.authorization;

  if (typeof authHeader !== 'string') {
    return null;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);

  return match?.[1] ?? null;
}

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
      jwtFromRequest: ExtractJwt.fromExtractors([extractRefreshToken]),
      secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_TOKEN_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(request: Request, payload: RefreshTokenPayload) {
    const token = extractRefreshToken(request);

    if (!token) {
      throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
    }

    if (payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
    }

    return this.authService.verifyRefreshToken(token, payload.jti);
  }
}

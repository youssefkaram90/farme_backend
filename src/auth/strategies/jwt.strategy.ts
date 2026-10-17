import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ERROR_MESSAGES } from '../../common/error-messages';
import { UsersService } from '../../users/users.service';
import { AccessTokenPayload } from '../token-payload';

function extractAccessToken(request: Request): string | null {
  const typedRequest = request as unknown as {
    cookies?: Record<string, unknown>;
  };

  const cookieToken = typedRequest.cookies?.['Authentication'];

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
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly userService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([extractAccessToken]),
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_TOKEN_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException(ERROR_MESSAGES.notSignedIn);
    }

    return this.userService.getUserSafe({ id: payload.sub });
  }
}

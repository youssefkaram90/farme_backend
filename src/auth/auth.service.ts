import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import { User } from '../generated/prisma/client';
import { Response, Request } from 'express';
import { TokenPayload } from './token-payload';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private userService: UsersService,
    private configService: ConfigService,
    private jwtService: JwtService,
    private prismaService: PrismaService,
  ) {}

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
    const expiresAccessToken = new Date();
    expiresAccessToken.setTime(
      expiresAccessToken.getTime() +
        parseInt(
          this.configService.getOrThrow<string>('ACCESS_TOKEN_EXPIRATION'),
          10,
        ),
    );

    const expiresRefreshToken = new Date();
    expiresRefreshToken.setTime(
      expiresRefreshToken.getTime() +
        parseInt(
          this.configService.getOrThrow<string>('REFRESH_TOKEN_EXPIRATION'),
          10,
        ),
    );

    const jti = randomUUID();
    const familyId = randomUUID();

    const refreshPayload: TokenPayload = {
      sub: user.id.toString(),
      jti,
      type: 'refresh',
    };

    const accessPayload: TokenPayload = {
      sub: user.id.toString(),
      jti: '',
      type: 'access',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.configService.getOrThrow('JWT_ACCESS_TOKEN_SECRET'),
      expiresIn: `${this.configService.getOrThrow('ACCESS_TOKEN_EXPIRATION')}ms`,
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.getOrThrow('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: `${this.configService.getOrThrow('REFRESH_TOKEN_EXPIRATION')}ms`,
    });

    await this.prismaService.refreshToken.create({
      data: {
        userId: user.id,
        jti,
        familyId,
        hashedToken: await argon2.hash(refreshToken),
        deviceId: metadata?.deviceId,
        deviceName: metadata?.deviceName,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        expiresAt: expiresRefreshToken,
        lastUsedAt: new Date(),
      },
    });

    response.cookie('Authentication', accessToken, {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') === 'production',
      expires: expiresAccessToken,
      sameSite: 'lax',
    });

    response.cookie('Refresh', refreshToken, {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') === 'production',
      expires: expiresRefreshToken,
      sameSite: 'lax',
      path: '/auth/refresh',
    });

    response.json({ id: user.id, accessToken, refreshToken });
  }

  async verifyUser(name: string, password: string) {
    try {
      const user = await this.userService.getUser({ name });
      const validPassword = await argon2.verify(user.password, password);

      if (!validPassword) throw new UnauthorizedException();

      return user;
    } catch (error) {
      throw new UnauthorizedException('Credentiels incorrect');
    }
  }

  async verifyRefreshToken(refreshToken: string, jti: string) {
    try {
      const tokenRecord = await this.prismaService.refreshToken.findUnique({
        where: { jti },
      });

      if (!tokenRecord) throw new UnauthorizedException('Refresh token not valid');

      if (tokenRecord.revokedAt) {
        // Reuse detection: this token was already rotated, revoke the entire family
        await this.prismaService.refreshToken.updateMany({
          where: { familyId: tokenRecord.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        throw new UnauthorizedException('Token has been revoked');
      }

      if (tokenRecord.expiresAt < new Date()) {
        throw new UnauthorizedException('Refresh token expired');
      }

      const isValid = await argon2.verify(
        tokenRecord.hashedToken,
        refreshToken,
      );
      if (!isValid) throw new UnauthorizedException('Refresh token not valid');

      // Update last used timestamp
      await this.prismaService.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { lastUsedAt: new Date() },
      });

      return { user: await this.userService.getUser({ id: tokenRecord.userId }), tokenRecord };
    } catch (error) {
      throw new UnauthorizedException('Refresh token not valid');
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
    const expiresAccessToken = new Date();
    expiresAccessToken.setTime(
      expiresAccessToken.getTime() +
        parseInt(
          this.configService.getOrThrow<string>('ACCESS_TOKEN_EXPIRATION'),
          10,
        ),
    );

    const expiresRefreshToken = new Date();
    expiresRefreshToken.setTime(
      expiresRefreshToken.getTime() +
        parseInt(
          this.configService.getOrThrow<string>('REFRESH_TOKEN_EXPIRATION'),
          10,
        ),
    );

    const jti = randomUUID();

    const refreshPayload: TokenPayload = {
      sub: oldTokenRecord.userId.toString(),
      jti,
      type: 'refresh',
    };

    const accessPayload: TokenPayload = {
      sub: oldTokenRecord.userId.toString(),
      jti: '',
      type: 'access',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.configService.getOrThrow('JWT_ACCESS_TOKEN_SECRET'),
      expiresIn: `${this.configService.getOrThrow('ACCESS_TOKEN_EXPIRATION')}ms`,
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.getOrThrow('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: `${this.configService.getOrThrow('REFRESH_TOKEN_EXPIRATION')}ms`,
    });

    // Revoke old token
    await this.prismaService.refreshToken.update({
      where: { id: oldTokenRecord.id },
      data: { revokedAt: new Date() },
    });

    // Create new token with same familyId
    await this.prismaService.refreshToken.create({
      data: {
        userId: oldTokenRecord.userId,
        jti,
        familyId: oldTokenRecord.familyId,
        hashedToken: await argon2.hash(refreshToken),
        deviceId: metadata?.deviceId,
        deviceName: metadata?.deviceName,
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        expiresAt: expiresRefreshToken,
        lastUsedAt: new Date(),
      },
    });

    response.cookie('Authentication', accessToken, {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') === 'production',
      expires: expiresAccessToken,
      sameSite: 'lax',
    });

    response.cookie('Refresh', refreshToken, {
      httpOnly: true,
      secure: this.configService.get('NODE_ENV') === 'production',
      expires: expiresRefreshToken,
      sameSite: 'lax',
      path: '/auth/refresh',
    });

    return { accessToken, refreshToken };
  }

  async signout(jti: string) {
    await this.prismaService.refreshToken.update({
      where: { jti },
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

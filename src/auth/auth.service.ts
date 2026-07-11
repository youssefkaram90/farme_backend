import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import { User } from '../generated/prisma/client';
import { Response } from 'express';
import { TokenPayload } from './token-payload';

@Injectable()
export class AuthService {
  constructor(
    private userService: UsersService,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {}

  async signin(user: User, response: Response) {
    const expiresAccessToken = new Date();
    expiresAccessToken.setMilliseconds(
      expiresAccessToken.getTime() +
        parseInt(
          this.configService.getOrThrow<string>('ACCESS_TOKEN_EXPIRATION'),
        ),
    );

    const expiresRefreshToken = new Date();
    expiresRefreshToken.setMilliseconds(
      expiresRefreshToken.getTime() +
        parseInt(
          this.configService.getOrThrow<string>('REFRESH_TOKEN_EXPIRATION'),
        ),
    );

    const payload: TokenPayload = {
      sub: user.id.toString(),
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow('JWT_ACCESS_TOKEN_SECRET'),
      expiresIn: `${this.configService.getOrThrow('ACCESS_TOKEN_EXPIRATION')}ms`,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow('JWT_REFRESH_TOKEN_SECRET'),
      expiresIn: `${this.configService.getOrThrow('REFRESH_TOKEN_EXPIRATION')}ms`,
    });

    await this.userService.updateUser(
      {
        id: user.id,
      },
      {
        refreshToken: await argon2.hash(refreshToken),
      },
    );

    response.cookie('Authentication', accessToken, {
      httpOnly: true,
      secure: this.configService.get('NOD_ENV') === 'production',
      expires: expiresAccessToken,
    });

    response.cookie('Refresh', refreshToken, {
      httpOnly: true,
      secure: this.configService.get('NOD_ENV') === 'production',
      expires: expiresRefreshToken,
    });
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

  async verifyRefeshToken(refreshToken: string, id: string) {
    try {
      const user = await this.userService.getUser({ id: Number(id) });

      if (!user.refreshToken) throw new UnauthorizedException("refresh not token");

      const authentication = argon2.verify(user.refreshToken,refreshToken);
      if (!authentication) throw new UnauthorizedException("refresh not hash");

      return user;
    } catch (eror) {
      throw new UnauthorizedException('Refresh token not valid');
    }
  }
}

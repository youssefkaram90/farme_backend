import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ERROR_MESSAGES } from './common/error-messages';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  /**
   * Which web origins may call this API **with credentials** (X-06).
   *
   * This was `origin: true`, which reflects whatever origin asked — read together
   * with `credentials: true`, that is every website on the internet allowed to
   * make cookie-carrying requests to the API from a visitor's browser.
   *
   * Comma-separated in `CORS_ORIGINS`, e.g.
   * `CORS_ORIGINS=https://farm.example.com,http://localhost:3000`.
   *
   * **The phone app is unaffected**: it is a native client, so it sends no
   * `Origin` header and CORS never applies to it. Same for the web app's own
   * route handlers, which call this API server-to-server.
   */
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      // class-validator output ("plannedTrays must be an integer number") is
      // developer-facing. Both clients display `message`, so return a single
      // sentence a non-technical user can act on.
      exceptionFactory: () =>
        new BadRequestException(ERROR_MESSAGES.invalidData),
    }),
  );
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 3333);
}
bootstrap();

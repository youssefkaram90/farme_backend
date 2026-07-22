import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: 'http://localhost:3000', // adjust as needed for production
    credentials: true,
  }
  );
  app.useGlobalPipes(new ValidationPipe({
    whitelist:true,
    transform:true,
    forbidNonWhitelisted:true,

  }));
  app.use(cookieParser());
  await app.listen(process.env.PORT ?? 3333);
}
bootstrap();

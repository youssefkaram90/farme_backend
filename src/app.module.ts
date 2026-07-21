import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { StockModule } from './stock/stock.module';
import { SowingModule } from './sowing/sowing.module';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    PrismaModule,
    DeliveriesModule,
    StockModule,
    SowingModule,
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}

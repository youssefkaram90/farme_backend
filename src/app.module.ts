import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { StockModule } from './stock/stock.module';
import { PermissionsModule } from './permissions/permissions.module';
import { TunnelsModule } from './tunnels/tunnels.module';
import { SectorsModule } from './sectors/sectors.module';
import { SowingPlanModule } from './sowing-plan/sowing-plan.module';
import { SowingSSMModule } from './sowing-ssm/sowing-ssm.module';
import { SowingLPMModule } from './sowing-lpm/sowing-lpm.module';
import { TrayTransportModule } from './tray-transport/tray-transport.module';
import { PlantStockModule } from './plant-stock/plant-stock.module';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    PrismaModule,
    DeliveriesModule,
    StockModule,
    PermissionsModule,
    TunnelsModule,
    SectorsModule,
    SowingPlanModule,
    SowingSSMModule,
    SowingLPMModule,
    TrayTransportModule,
    PlantStockModule,
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}

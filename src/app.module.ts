import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
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
import { CropCareModule } from './crop-care/crop-care.module';
import { AgriInputsModule } from './agri-inputs/agri-inputs.module';
import { HarvestModule } from './harvest/harvest.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { SeasonModule } from './season/season.module';
import { SeasonWriteInterceptor } from './season/season-write.interceptor';
import { SeasonViewInterceptor } from './season/season-view.interceptor';
import { SeasonFreshnessInterceptor } from './season/season-freshness.interceptor';

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
    CropCareModule,
    AgriInputsModule,
    HarvestModule,
    ShipmentsModule,
    SeasonModule,
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  // Global safety net: every exception reaches the client as a readable
  // `message`, including across phone/web clients.
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Re-reads the open season before each request, so no handler ever works
    // from a value cached at startup (P7-01). Deliberately first.
    { provide: APP_INTERCEPTOR, useClass: SeasonFreshnessInterceptor },
    // Lets an ADMIN browse another season by cookie; GETs only (P5-02). Before
    // the scope guard on purpose: it is what installs the viewed season for this
    // request, and the read check has to see it (X-02).
    { provide: APP_INTERCEPTOR, useClass: SeasonViewInterceptor },
    // Judges every write, and every read that names a record, against that
    // record's own season (P4-09 / P2-05 / P7-01 / X-02).
    { provide: APP_INTERCEPTOR, useClass: SeasonWriteInterceptor },
  ],
})
export class AppModule {}

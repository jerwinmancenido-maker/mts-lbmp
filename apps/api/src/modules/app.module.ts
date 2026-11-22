import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthGuard } from "./auth.guard.js";
import { LogisticsController } from "./logistics.controller.js";
import { LogisticsService } from "./logistics.service.js";
import { PersistenceFlushInterceptor } from "./persistence-flush.interceptor.js";
import { getAuthSecret } from "./security.js";

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: getAuthSecret()
    }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
        limit: Number(process.env.RATE_LIMIT_MAX ?? 180)
      }
    ])
  ],
  controllers: [LogisticsController],
  providers: [
    LogisticsService,
    {
      // FU-1 route (a): a mutating response is held until the saves it
      // queued are durable (see persistence-flush.interceptor.ts).
      provide: APP_INTERCEPTOR,
      useClass: PersistenceFlushInterceptor
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ]
})
export class AppModule {}

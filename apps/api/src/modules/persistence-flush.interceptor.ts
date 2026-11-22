import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { LogisticsService } from "./logistics.service.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * FU-1 route (a) — awaited saves at the HTTP boundary.
 *
 * FU1-DISCHARGE.md proved the Prisma path answered HTTP 201 for records
 * whose asynchronous save then failed: the acknowledged payment/expense
 * was readable for the rest of the run and vanished at restart. The
 * service layer is synchronous by architecture and cannot await its own
 * saves, so the awaiting lives here: for a mutating request, take the
 * service's persistence checkpoint before the handler runs and, once the
 * handler has produced its result, hold the response until
 * flushPersistence confirms every save queued since the checkpoint —
 * including the one carrying this request's state — has landed. A
 * rejected save turns the response into the fail-closed 500 and rolls
 * the in-memory change back (see LogisticsService.flushPersistence).
 *
 * Non-mutating requests (GET and friends) pass straight through: reads
 * are served from memory and never wait for an in-flight save. A
 * mutating handler that queued no save (a validation-only POST, an
 * idempotent replay answered from its stored result) also pays nothing —
 * its checkpoint is unchanged and the flush returns immediately. A
 * handler that throws never reaches the flush: its own error is the
 * response, as before.
 */
@Injectable()
export class PersistenceFlushInterceptor implements NestInterceptor {
  constructor(@Inject(LogisticsService) private readonly logistics: LogisticsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<{ method?: string }>();
    const method = (request?.method ?? "").toUpperCase();
    if (!MUTATING_METHODS.has(method)) return next.handle();
    const checkpoint = this.logistics.persistenceCheckpoint();
    return next.handle().pipe(
      mergeMap(async (data: unknown) => {
        await this.logistics.flushPersistence(checkpoint);
        return data;
      })
    );
  }
}

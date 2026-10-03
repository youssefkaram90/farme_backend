import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SeasonService } from './season.service';

/**
 * Keeps the open season in memory honest.
 *
 * `getActiveSeasonId()` is synchronous on purpose: about twenty services stamp
 * new rows with it, and threading an `await` through all of them would buy
 * nothing here. The trade is that the value has to be *refreshed* rather than
 * trusted — which is this interceptor's whole job: before any handler runs, the
 * cached season is at most `SEASON_CACHE_TTL_MS` old.
 *
 * The default TTL is 0, i.e. one indexed lookup per request. The table holds a
 * handful of rows, so that is cheap, and it means a season closed by another
 * process (or by a script, or by a restore) is noticed on the very next request
 * instead of "whenever this instance happens to restart" (P7-01).
 *
 * Registered globally, ahead of SeasonWriteInterceptor and
 * SeasonViewInterceptor, so both see a current value.
 */
@Injectable()
export class SeasonFreshnessInterceptor implements NestInterceptor {
  constructor(private readonly seasonService: SeasonService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    await this.seasonService.ensureFreshActive();

    return next.handle();
  }
}

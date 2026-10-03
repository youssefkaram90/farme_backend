import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, type Subscription } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../users/enums/userRole.enum';
import { seasonViewStore } from './season-view.store';

/**
 * Let an administrator look at another season — the switcher.
 *
 * The choice travels as a `season` cookie, which is why this is so small: every
 * read in the app already asks `SeasonService.getActiveSeasonId()`, so once the
 * viewed season is installed here, every list, summary and total follows it
 * without a single service or client call knowing about it.
 *
 * Two rules keep it safe, and both matter:
 *
 * 1. **GET and HEAD only.** A write therefore never runs with a viewed season,
 *    and a new record can never be stamped with an old one. The cookie is simply
 *    ignored on a POST/PATCH/DELETE.
 * 2. **Administrators only.** A normal user's cookie is ignored and they keep
 *    seeing the open season — a closed season is not a normal user's to read,
 *    whatever their browser sends.
 *
 * An empty or unknown season id does nothing at all, so clearing the cookie (or
 * deleting the season) puts the caller straight back on the open season.
 *
 * NOTE on the AsyncLocalStorage: the inner subscription is started INSIDE
 * `run()`, which is what carries the context through the controller and every
 * `await` after it.
 */
@Injectable()
export class SeasonViewInterceptor implements NestInterceptor {
  constructor(private readonly prismaService: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const method = String(request?.method ?? '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      return next.handle();
    }

    if (request?.user?.role !== UserRole.ADMIN) {
      return next.handle();
    }

    const requested = request?.cookies?.season;
    if (typeof requested !== 'string' || requested.length === 0) {
      return next.handle();
    }

    const season = await this.prismaService.season.findUnique({
      where: { id: requested },
      select: { id: true },
    });
    if (!season) {
      return next.handle();
    }

    return new Observable<unknown>((subscriber) => {
      let inner: Subscription | undefined;

      seasonViewStore.run(season.id, () => {
        inner = next.handle().subscribe(subscriber);
      });

      return () => inner?.unsubscribe();
    });
  }
}

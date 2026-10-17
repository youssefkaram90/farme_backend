import { Injectable, NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import { ERROR_MESSAGES } from '../error-messages';

/**
 * A record id taken from the URL, answered in plain language when it is not one.
 *
 * `ParseUUIDPipe` refuses a malformed id with its own wording — "Validation
 * failed (uuid is expected)" — which is written for a developer, not for the
 * person using the app. An id that is not a UUID names no row, so the honest
 * answer is the ordinary 404 a stale link gets everywhere else (U-2), the same
 * one the season interceptor answers with.
 *
 * Use it in place of `ParseUUIDPipe`:
 *
 * ```ts
 * @Get(':id')
 * findOne(@Param('id', RecordIdPipe) id: string) { … }
 * ```
 */
@Injectable()
export class RecordIdPipe extends ParseUUIDPipe {
  constructor() {
    super({
      exceptionFactory: () =>
        new NotFoundException(ERROR_MESSAGES.recordNotFound),
    });
  }
}

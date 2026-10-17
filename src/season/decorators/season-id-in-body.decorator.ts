import { SetMetadata } from '@nestjs/common';

/** Metadata key — read by the route-coverage test, not at runtime. */
export const SEASON_ID_IN_BODY = 'seasonIdInBody';

/**
 * Marks a route whose record id travels in the JSON BODY, not in the URL.
 *
 * `season-route-coverage.spec.ts` finds the routes it must check by looking for
 * a `:id` in the path, so a route like `POST /stock/adjust` — which names its
 * stock lot in the body — is invisible to that scan and could silently skip the
 * season rule. This decorator is how such a route declares itself, so the test
 * can require a matching rule for it.
 *
 * Purely declarative: nothing reads it at runtime. The season rule itself still
 * lives in `RULES` (`season-write.interceptor.ts`).
 *
 * @param field the body field that carries the record's id, e.g. `"planId"`
 */
export const SeasonIdInBody = (field: string) =>
  SetMetadata(SEASON_ID_IN_BODY, field);

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The season an ADMIN is browsing, for the length of one request.
 *
 * Deliberately NOT a field on `SeasonService`: that object is shared by every
 * request, so a field there would leak one person's choice into everybody
 * else's screens. AsyncLocalStorage keeps it per request.
 *
 * See `SeasonViewInterceptor` for the two rules that make it safe.
 */
export const seasonViewStore = new AsyncLocalStorage<string>();

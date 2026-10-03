/**
 * Shared pagination helpers.
 *
 * List endpoints accept optional `page` (1-based) and `pageSize` query params.
 * When both are omitted the endpoint keeps returning a plain array (backwards
 * compatible); when present it returns a `Paginated<T>` envelope so mobile
 * clients can implement infinite scroll.
 */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export function getPaginationParams(page?: string, pageSize?: string) {
  if (page === undefined && pageSize === undefined) return null;

  const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20));

  return {
    page: pageNum,
    pageSize: size,
    skip: (pageNum - 1) * size,
    take: size,
  };
}

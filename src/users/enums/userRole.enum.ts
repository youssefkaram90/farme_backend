/**
 * User roles.
 *
 * Only ADMIN is special-cased in code: it bypasses every permission check
 * (see PermissionsGuard) and it is the only role accepted by AdminOnlyGuard.
 * MANAGER and USER are otherwise plain labels — their capabilities come
 * entirely from the permission matrix.
 */
export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  USER = 'USER',
}

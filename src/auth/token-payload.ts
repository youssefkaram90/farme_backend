export interface TokenPayload {
  sub: string;
  jti: string;
  type: 'access' | 'refresh';
}

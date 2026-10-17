/**
 * The claims inside the two kinds of token (AUTH-18).
 *
 * They are two types rather than one shape with a `type` field, because the
 * difference between them is real and belongs in the code: a refresh token is an
 * identified, revocable row in the database (`jti`), while an access token is
 * nothing but "this is user X" for the next few minutes.
 *
 * `type` is not decoration. The two tokens are ALSO signed with two different
 * secrets, and that is what separates them in practice — but that separation
 * lives in configuration, where a copy-pasted value or a missing variable would
 * quietly erase it. If both secrets were ever the same, nothing else would
 * notice and a refresh token (days) would silently work as an access token
 * (minutes). Every strategy therefore checks the kind of token it was handed and
 * refuses the other, so the rule also exists in code.
 *
 * The access token keeps a `type` claim even though `sub` is all anything reads,
 * so that the check is written the same way in both strategies.
 */

/**
 * What an ACCESS token carries.
 *
 * There is deliberately NO `jti`: nothing identifies an access token
 * individually. The shared shape these two interfaces used to be forced a
 * placeholder `jti: ''` into every access token, which read like a bug — and an
 * empty string is falsy, so a future check on `jti` would have silently treated
 * every access token as "no id".
 */
export interface AccessTokenPayload {
  sub: string;
  type: 'access';
}

/**
 * What a REFRESH token carries.
 *
 * `jti` identifies the single `refresh_token` row this token stands for. It is
 * what rotation claims, what the reuse tripwire compares, and the only reason
 * signing out can revoke exactly the token that was presented rather than every
 * session the user has.
 */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

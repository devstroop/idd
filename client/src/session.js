/**
 * Session state for a tunnel connection.
 *
 * A session is created exactly once by the auth flow and is then treated as
 * immutable by the reconnection logic. Reconnects MUST reuse the exact same
 * session object — they never re-authenticate and never re-negotiate the
 * protocol (constraint from the intent: "Do not touch the auth flow").
 */
export function createSession({ sessionId, authToken, peer, createdAt = Date.now() }) {
  if (!sessionId || !authToken || !peer) {
    throw new Error('createSession requires sessionId, authToken and peer');
  }
  return Object.freeze({ sessionId, authToken, peer, createdAt });
}

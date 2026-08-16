import { EventEmitter } from 'node:events';

/**
 * Transport layer for the tunnel.
 *
 * In this repo (intent-stage pipeline) there is no real VPN transport, so
 * this is a thin, replaceable abstraction:
 *
 *   - `connect(session)`  — establishes the tunnel using an EXISTING session.
 *     It must never authenticate; the ConnectionManager guarantees the
 *     session already exists.
 *   - `disconnect()`      — tears down the transport.
 *   - `drop` event        — emitted by the real transport when the link is
 *     lost unexpectedly (e.g. Wi-Fi loss). Fake transports call
 *     `_onLinkLost()`.
 *
 * The real client repo replaces this class with its tunnel implementation;
 * the ConnectionManager only depends on this contract.
 */
export class Tunnel extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.session = null;
  }

  async connect(session) {
    if (!session || !session.sessionId || !session.authToken) {
      throw new Error('Tunnel.connect requires an existing session (no re-auth, no renegotiation)');
    }
    this.session = session;
    this.connected = true;
    return this;
  }

  async disconnect() {
    this.session = null;
    this.connected = false;
  }

  /** Transport signal: the link dropped unexpectedly. */
  _onLinkLost() {
    this.connected = false;
    this.emit('drop');
  }
}

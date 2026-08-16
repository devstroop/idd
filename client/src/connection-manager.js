import { EventEmitter } from 'node:events';

export const STATES = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  STOPPED: 'stopped',
});

/**
 * Owns the tunnel lifecycle and resumes connections after Wi-Fi drops.
 *
 * Guarantees (constraints from the intent):
 *   - Auth runs exactly once, on the very first connect. Every reconnect
 *     reuses the existing session object — the auth flow is never touched.
 *   - A drop tears down ONLY transport state (the tunnel); the session and
 *     all protocol/auth state survive untouched.
 *   - Once connectivity returns, the tunnel is re-established quickly: the
 *     first attempt fires immediately (no backoff), so reconnection lands
 *     well inside the 5-second window. Subsequent retries use bounded
 *     exponential backoff and give up after `reconnectBudgetMs` rather than
 *     spinning forever.
 *   - User-initiated `disconnect()` is respected — it stops the monitor and
 *     cancels any pending reconnect, so auto-reconnect never fights an
 *     intentional disconnect.
 *
 * Events: connected, reconnecting, reconnected, reconnect-failed,
 * reconnect-exhausted, disconnected.
 */
export class ConnectionManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {Tunnel} deps.tunnel
   * @param {NetworkMonitor} deps.monitor
   * @param {() => number} [deps.now]
   * @param {(ms: number) => Promise<void>} [deps.delay]
   * @param {number} [deps.reconnectDelayMs]  base backoff (default 1000)
   * @param {number} [deps.maxReconnectDelayMs]  backoff cap (default 4000)
   * @param {number} [deps.reconnectBudgetMs]  max time spent retrying per
   *   connectivity-returned window (default 5000)
   */
  constructor({
    tunnel,
    monitor,
    now = () => Date.now(),
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    reconnectDelayMs = 1000,
    maxReconnectDelayMs = 4000,
    reconnectBudgetMs = 5000,
  } = {}) {
    super();
    this.tunnel = tunnel;
    this.monitor = monitor;
    this._now = now;
    this._delay = delay;
    this.reconnectDelayMs = reconnectDelayMs;
    this.maxReconnectDelayMs = maxReconnectDelayMs;
    this.reconnectBudgetMs = reconnectBudgetMs;

    this.state = STATES.IDLE;
    this.session = null;
    this.authCount = 0;

    this._generation = 0; // bumped to cancel pending reconnect work
    this._pending = null; // in-flight reconnect attempt
    this._retry = 0; // failed attempts since the last successful connect
    this._budgetStartedAt = null; // when the current retry window began
    this._userStopped = false;
    this._started = false;
  }

  get connected() {
    return this.state === STATES.CONNECTED;
  }

  /**
   * Start the manager.
   *
   * @param {object} opts
   * @param {object} opts.session the existing session (if the caller already
   *   authenticated)
   * @param {() => Promise<object>} [opts.authenticate] runs the auth flow
   *   exactly once, on the very first connect
   */
  async start({ session = null, authenticate } = {}) {
    if (this._started) return;
    this._started = true;
    this._userStopped = false;
    this._generation += 1;

    this.monitor.on('down', () => this._onNetworkDown());
    this.monitor.on('up', () => this._onNetworkUp());
    this.tunnel.on('drop', () => this._onTransportDrop());

    await this._connect({ session, authenticate });
    this.monitor.start();
  }

  /** User-initiated disconnect: never auto-reconnects afterwards. */
  async disconnect() {
    this._userStopped = true;
    this._generation += 1;
    this._pending = null;
    this.monitor.stop();
    await this.tunnel.disconnect();
    this.state = STATES.STOPPED;
    this.emit('disconnected', { session: this.session });
  }

  async _connect({ session = null, authenticate } = {}) {
    if (this._userStopped) return;
    if (!this.session) {
      // Auth happens exactly once — only when no session exists yet.
      if (authenticate) {
        const authed = await authenticate();
        if (authed) this.session = authed;
      }
      this.session = this.session ?? session;
      this.authCount += 1;
    }
    if (!this.session) {
      throw new Error('ConnectionManager.start requires a session or an authenticate() callback');
    }
    this.state = STATES.CONNECTING;
    await this.tunnel.connect(this.session); // reuses this.session — never re-auth
    this.state = STATES.CONNECTED;
    this._retry = 0;
    this.emit('connected', { session: this.session, reconnected: false });
  }

  _onNetworkDown() {
    if (this._userStopped || this.state !== STATES.CONNECTED) return;
    this._enterReconnecting('network-down');
  }

  _onTransportDrop() {
    if (this._userStopped || this.state !== STATES.CONNECTED) return;
    this._enterReconnecting('transport-drop');
  }

  _enterReconnecting(reason) {
    this._generation += 1; // cancel any in-flight reconnect attempt
    this._pending = null;
    void this.tunnel.disconnect(); // teardown TRANSPORT only
    this._retry = 0;
    this._budgetStartedAt = this._now();
    this.state = STATES.RECONNECTING;
    this.emit('reconnecting', { reason });
    // If the link dropped while the network still looks up (transport-drop),
    // start reconnecting right away. If the network itself is down, we wait
    // for the monitor's `up` event.
    if (reason === 'transport-drop') {
      this._scheduleReconnect({ immediate: true });
    }
  }

  _onNetworkUp() {
    if (this._userStopped || this.state !== STATES.RECONNECTING) return;
    // Fresh budget per connectivity-returned window.
    this._budgetStartedAt = this._now();
    this._retry = 0;
    this._scheduleReconnect({ immediate: true });
  }

  _backoffMs() {
    return Math.min(this.reconnectDelayMs * 2 ** Math.max(0, this._retry - 1), this.maxReconnectDelayMs);
  }

  _scheduleReconnect({ immediate = false } = {}) {
    if (this._userStopped || this.state !== STATES.RECONNECTING || this._pending) return;
    if (this._now() - this._budgetStartedAt > this.reconnectBudgetMs) {
      this.emit('reconnect-exhausted', { retries: this._retry });
      return; // give up until the next down/up cycle — no infinite spinning
    }

    const token = this._generation;
    const work = (async () => {
      try {
        if (!immediate) await this._delay(this._backoffMs());
        if (token !== this._generation || this._userStopped || this.state !== STATES.RECONNECTING) return;
        if (this._now() - this._budgetStartedAt > this.reconnectBudgetMs) {
          this.emit('reconnect-exhausted', { retries: this._retry });
          return; // attempt would land outside the 5s window — skip it
        }
        await this.tunnel.connect(this.session); // reuses this.session — never re-auth
        if (token !== this._generation || this._userStopped) return;
        this.state = STATES.CONNECTED;
        this._retry = 0;
        this.emit('reconnected', { session: this.session });
      } catch (err) {
        if (token !== this._generation || this._userStopped) return;
        this._retry += 1;
        this.emit('reconnect-failed', { attempt: this._retry, error: err });
      } finally {
        if (token === this._generation) this._pending = null;
      }
    })();
    this._pending = work;
    // Chain the next attempt (with backoff) unless we connected or stopped.
    void work.then(() => {
      if (token !== this._generation || this._userStopped) return;
      if (this.state === STATES.RECONNECTING) this._scheduleReconnect();
    });
  }
}

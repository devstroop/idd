import { EventEmitter } from 'node:events';
import os from 'node:os';

/**
 * Watches for network (Wi-Fi) connectivity changes and emits `up` / `down`
 * on transitions only.
 *
 * The probe is injectable so the real client repo can plug in platform
 * connectivity detection (Windows Network List Manager, macOS
 * SCNetworkReachability, Android ConnectivityManager, iOS NWPathMonitor)
 * while keeping the same event contract.
 */
export class NetworkMonitor extends EventEmitter {
  /**
   * @param {object} opts
   * @param {() => Promise<boolean>} opts.probe  resolves true when online
   * @param {number} opts.intervalMs             poll interval in ms
   */
  constructor({ probe = defaultProbe, intervalMs = 2000 } = {}) {
    super();
    this.probe = probe;
    this.intervalMs = intervalMs;
    this.online = null; // null = unknown until first probe
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    void this._check();
    this._timer = setInterval(() => {
      void this._check();
    }, this.intervalMs);
    // Do not keep the process alive just for monitoring.
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _check() {
    let online;
    try {
      online = await this.probe();
    } catch {
      // A failing probe (e.g. socket error) means we cannot reach the
      // network — treat it as down.
      online = false;
    }
    if (this.online !== online) {
      this.online = online;
      this.emit(online ? 'up' : 'down', { online });
    }
  }
}

/**
 * Default probe: online when at least one non-internal network interface is
 * up. A Wi-Fi drop removes the interface, so this is a reasonable default.
 * Real clients should swap in a stronger probe (see constructor docs).
 */
export async function defaultProbe() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const iface of list) {
      if (!iface.internal && iface.address) return true;
    }
  }
  return false;
}

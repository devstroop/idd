# idd client — reconnection support

Minimal, dependency-free reference implementation for **resuming connections
after Wi-Fi drops** (issue #2). This repo is the intent-stage pipeline, so
there is no real VPN transport here — this is the reconnection logic, ready
to be wired into the actual client repo.

## Guarantees (from the issue's constraints)

- **Resumes after Wi-Fi drops.** A network monitor detects the drop; the
  connection manager tears down only transport state and re-establishes the
  tunnel once connectivity returns.
- **Within 5 seconds.** The first reconnect attempt fires immediately when
  connectivity returns (no backoff wait). Retries use bounded exponential
  backoff and give up after `reconnectBudgetMs` (default 5000) rather than
  spinning forever.
- **Protocol/auth flow untouched.** Auth runs exactly once, on the very first
  connect. Every reconnect reuses the existing session object — no re-auth,
  no renegotiation (`authCount` is provably 1 in the tests).
- **Existing sessions unaffected.** Sessions are immutable (`session.js`);
  drops never touch them.
- **User-initiated disconnects are respected.** `disconnect()` stops the
  monitor and cancels pending reconnects — auto-reconnect never fights an
  intentional disconnect.

## Layout

```
src/connection-manager.js   state machine: connect → drop → reconnect
src/network-monitor.js      probe-based up/down detection (pluggable probe)
src/session.js              immutable session record (created once by auth)
src/tunnel.js               transport abstraction (replace with the real
                            tunnel implementation in the client repo)
test/                       node:test suite
```

## Run the tests

```bash
npm test
```

## Wiring into a real client

1. Replace `src/tunnel.js` with the real tunnel implementation. It must:
   - `connect(session)` — establish the tunnel from an existing session
     (never authenticate), and
   - emit `drop` when the link is lost unexpectedly.
2. Swap the default probe in `src/network-monitor.js` for platform
   connectivity detection (Windows NLM, macOS SCNetworkReachability, Android
   ConnectivityManager, iOS NWPathMonitor).
3. `start()` the manager with the existing session:
   ```js
   const manager = new ConnectionManager({ tunnel, monitor });
   await manager.start({ session }); // or { authenticate } for the first run
   ```

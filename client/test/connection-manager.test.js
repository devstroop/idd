import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { ConnectionManager, STATES } from '../src/connection-manager.js';
import { Tunnel } from '../src/tunnel.js';
import { createSession } from '../src/session.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function until(cond, { timeoutMs = 2000, stepMs = 5 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('until() timed out'));
      setTimeout(poll, stepMs);
    })();
  });
}

/** Monitor double: an EventEmitter whose online state we flip by hand. */
class FakeMonitor extends EventEmitter {
  constructor() {
    super();
    this.online = true;
  }
  start() {}
  stop() {}
  setOnline(online) {
    if (this.online === online) return;
    this.online = online;
    this.emit(online ? 'up' : 'down', { online });
  }
}

function makeHarness({ delay = sleep, ...rest } = {}) {
  const tunnel = new Tunnel();
  const orig = tunnel.connect.bind(tunnel);
  let connectAttempts = 0;
  let failuresRemaining = 0;
  tunnel.connect = async (session) => {
    connectAttempts += 1;
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      throw new Error('simulated connect failure');
    }
    return orig(session);
  };
  tunnel.failNext = (n) => {
    failuresRemaining = n;
  };
  const monitor = new FakeMonitor();
  const manager = new ConnectionManager({ tunnel, monitor, delay, ...rest });
  return { tunnel, monitor, manager, connectAttempts: () => connectAttempts };
}

const SESSION = createSession({
  sessionId: 's-1',
  authToken: 'tok-1',
  peer: 'gw.example.com',
});

test('reconnects after a Wi-Fi drop, reusing the same session', async () => {
  const { tunnel, monitor, manager } = makeHarness();
  const events = [];
  manager.on('reconnecting', () => events.push('reconnecting'));
  manager.on('reconnected', () => events.push('reconnected'));

  await manager.start({ session: SESSION });
  assert.equal(manager.state, STATES.CONNECTED);
  assert.equal(tunnel.connected, true);

  monitor.setOnline(false); // Wi-Fi drops
  await until(() => manager.state === STATES.RECONNECTING);
  assert.equal(tunnel.connected, false, 'transport torn down, session kept');
  assert.equal(manager.session, SESSION);

  monitor.setOnline(true); // Wi-Fi returns
  await until(() => manager.state === STATES.CONNECTED);
  assert.equal(tunnel.connected, true);
  assert.equal(tunnel.session, SESSION, 'same session object reused');
  assert.deepEqual(events, ['reconnecting', 'reconnected']);
});

test('reconnects within 5 seconds of connectivity returning', async () => {
  const waited = [];
  const { tunnel, monitor, manager } = makeHarness({
    delay: async (ms) => {
      waited.push(ms);
      await sleep(ms);
    },
  });

  await manager.start({ session: SESSION });

  const t0 = Date.now();
  monitor.setOnline(false);
  await until(() => manager.state === STATES.RECONNECTING);
  const downAt = Date.now();

  monitor.setOnline(true);
  await until(() => manager.state === STATES.CONNECTED);
  const upToConnected = Date.now() - downAt;
  const dropToConnected = Date.now() - t0;

  assert.ok(upToConnected < 5000, `connectivity->connected took ${upToConnected}ms, expected < 5000ms`);
  assert.ok(dropToConnected < 5000, `drop->connected took ${dropToConnected}ms, expected < 5000ms`);
  assert.deepEqual(waited, [], 'first attempt after connectivity returns is immediate (no backoff wait)');
});

test('auth runs exactly once, never during reconnects', async () => {
  const { tunnel, monitor, manager } = makeHarness();
  let authCalls = 0;
  const authenticate = async () => {
    authCalls += 1;
    return SESSION;
  };

  await manager.start({ authenticate });
  assert.equal(authCalls, 1);
  assert.equal(manager.authCount, 1);

  for (let i = 0; i < 3; i += 1) {
    monitor.setOnline(false);
    await until(() => manager.state === STATES.RECONNECTING);
    monitor.setOnline(true);
    await until(() => manager.state === STATES.CONNECTED);
  }

  assert.equal(authCalls, 1, 'auth must not re-run during reconnects');
  assert.equal(manager.authCount, 1);
  assert.equal(tunnel.session, SESSION);
});

test('existing sessions remain unaffected across reconnects', async () => {
  const { tunnel, monitor, manager } = makeHarness();
  await manager.start({ session: SESSION });

  monitor.setOnline(false);
  await until(() => manager.state === STATES.RECONNECTING);
  monitor.setOnline(true);
  await until(() => manager.state === STATES.CONNECTED);

  // Same object, still the original session values — untouched by reconnects.
  assert.equal(manager.session, SESSION);
  assert.equal(tunnel.session, SESSION);
  assert.equal(SESSION.sessionId, 's-1');
  assert.equal(SESSION.authToken, 'tok-1');
  assert.equal(SESSION.peer, 'gw.example.com');
});

test('reconnects when the transport drops while the network looks up', async () => {
  const { tunnel, manager } = makeHarness();
  await manager.start({ session: SESSION });

  tunnel._onLinkLost(); // link lost without a network-down event
  assert.equal(manager.state, STATES.RECONNECTING);

  await until(() => manager.state === STATES.CONNECTED);
  assert.equal(tunnel.connected, true);
  assert.equal(tunnel.session, SESSION);
});

test('does not attempt reconnect while the network is down', async () => {
  const { tunnel, monitor, manager, connectAttempts } = makeHarness({ reconnectDelayMs: 10 });
  await manager.start({ session: SESSION });
  const attemptsAfterStart = connectAttempts();

  monitor.setOnline(false);
  await until(() => manager.state === STATES.RECONNECTING);
  await sleep(60); // several backoff periods — nothing should fire while down

  assert.equal(manager.state, STATES.RECONNECTING);
  assert.equal(tunnel.connected, false);
  assert.equal(connectAttempts(), attemptsAfterStart, 'no reconnect attempts while network is down');

  monitor.setOnline(true);
  await until(() => manager.state === STATES.CONNECTED);
});

test('user-initiated disconnect is respected — never auto-reconnects', async () => {
  const { tunnel, monitor, manager, connectAttempts } = makeHarness({ reconnectDelayMs: 10 });
  await manager.start({ session: SESSION });
  const attemptsAfterStart = connectAttempts();

  await manager.disconnect();
  assert.equal(manager.state, STATES.STOPPED);
  assert.equal(tunnel.connected, false);

  monitor.setOnline(false);
  monitor.setOnline(true);
  await sleep(50);

  assert.equal(manager.state, STATES.STOPPED, 'stays stopped after intentional disconnect');
  assert.equal(manager.connected, false);
  assert.equal(connectAttempts(), attemptsAfterStart, 'no reconnect attempts after intentional disconnect');
});

test('gives up after the reconnect budget instead of spinning forever', async () => {
  const { monitor, manager, tunnel } = makeHarness({
    reconnectDelayMs: 10,
    maxReconnectDelayMs: 20,
    reconnectBudgetMs: 100,
  });
  await manager.start({ session: SESSION });
  tunnel.failNext(100); // tunnel keeps failing once reconnecting starts

  monitor.setOnline(false);
  await until(() => manager.state === STATES.RECONNECTING);
  monitor.setOnline(true);

  await until(() => manager._retry >= 1, { timeoutMs: 2000 });
  const exhausted = new Promise((resolve) => manager.once('reconnect-exhausted', resolve));
  const info = await exhausted;

  assert.ok(info.retries >= 1, 'at least one retry happened before giving up');
  await sleep(30);
  assert.equal(manager.state, STATES.RECONNECTING, 'stays in reconnecting, not spinning');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { NetworkMonitor } from '../src/network-monitor.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('emits down then up on probe transitions', async () => {
  let online = true;
  const monitor = new NetworkMonitor({ probe: async () => online, intervalMs: 5 });
  const events = [];
  monitor.on('down', () => events.push('down'));
  monitor.on('up', () => events.push('up'));

  monitor.start();
  await sleep(15);
  online = false; // Wi-Fi drops
  await sleep(15);
  online = true; // Wi-Fi returns
  await sleep(15);
  monitor.stop();

  assert.deepEqual(events.slice(-2), ['down', 'up']);
});

test('treats a throwing probe as down', async () => {
  let shouldThrow = true;
  const monitor = new NetworkMonitor({
    probe: async () => {
      if (shouldThrow) throw new Error('probe failed');
      return true;
    },
    intervalMs: 5,
  });
  const events = [];
  monitor.on('down', () => events.push('down'));
  monitor.on('up', () => events.push('up'));

  monitor.start();
  await sleep(15);
  assert.ok(events.includes('down'), 'a failing probe must be treated as down');

  shouldThrow = false;
  await sleep(15);
  assert.ok(events.includes('up'), 'recovery is reported once the probe works again');
  monitor.stop();
});

test('start/stop: no events after stop', async () => {
  const monitor = new NetworkMonitor({ probe: async () => true, intervalMs: 5 });
  const events = [];
  monitor.on('down', () => events.push('down'));
  monitor.on('up', () => events.push('up'));

  monitor.start();
  await sleep(10);
  monitor.stop();
  const count = events.length;
  await sleep(30);
  assert.equal(events.length, count, 'no events after stop()');
});

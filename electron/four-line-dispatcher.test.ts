import assert from 'node:assert/strict';
import test from 'node:test';
import { FourLineDispatcher } from './four-line-dispatcher.js';
import { FourLineRuntimeManager, createEmptyFourLineConfig } from './line-manager.js';

function readyConfig() {
  const config = createEmptyFourLineConfig();
  for (const line of config.lines) {
    line.enabled = true;
    line.vapiApiKey = `key-${line.id}`;
    line.assistantId = `assistant-${line.id}`;
    line.phoneNumberId = `phone-${line.id}`;
  }
  return config;
}

test('dispatcher starts four calls in parallel and never a fifth', async () => {
  const contacts = Array.from({ length: 5 }, (_, index) => ({ id: `c${index + 1}`, status: 'Waiting' }));
  const manager = new FourLineRuntimeManager(readyConfig());
  const resolvers: Array<() => void> = [];
  const assigned: string[] = [];

  const dispatcher = new FourLineDispatcher({
    lineManager: manager,
    contacts: () => contacts,
    campaignState: () => 'running',
    onAssigned: (contact, line) => {
      contact.status = 'Calling';
      assigned.push(`${contact.id}:${line.id}`);
    },
    dial: async contact => new Promise<void>(resolve => {
      resolvers.push(() => {
        contact.status = 'Completed';
        resolve();
      });
    }),
  });

  await dispatcher.pump();
  assert.equal(dispatcher.activeCount(), 4);
  assert.equal(assigned.length, 4);
  assert.equal(contacts.filter(contact => contact.status === 'Waiting').length, 1);

  resolvers[0]();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(assigned.length, 5);
  assert.equal(dispatcher.activeCount(), 4);

  for (const resolve of resolvers.slice(1)) resolve();
  await dispatcher.waitForIdle(1_000);
  assert.equal(dispatcher.activeCount(), 0);
});

test('disabled/unconfigured lines are never allocated', async () => {
  const config = createEmptyFourLineConfig();
  config.lines[0].enabled = true;
  config.lines[0].vapiApiKey = 'key';
  config.lines[0].assistantId = 'assistant';
  config.lines[0].phoneNumberId = 'phone';
  const manager = new FourLineRuntimeManager(config);
  const contacts = [{ id: 'a', status: 'Waiting' }, { id: 'b', status: 'Waiting' }];
  let started = 0;

  const dispatcher = new FourLineDispatcher({
    lineManager: manager,
    contacts: () => contacts,
    campaignState: () => 'running',
    onAssigned: contact => { contact.status = 'Calling'; },
    dial: async contact => {
      started += 1;
      contact.status = 'Completed';
    },
  });

  await dispatcher.pump();
  await dispatcher.waitForIdle(1_000);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(started, 2);
  assert.equal(manager.configuredLines().length, 1);
});

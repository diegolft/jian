import { describe, expect, it } from 'vitest';
import { quietLibsignal } from '../src/channels/whatsapp/quiet.js';

const session = {
  currentRatchet: { ephemeralKeyPair: { privKey: Buffer.from('7847', 'hex') } },
};

function console_() {
  const printed: unknown[][] = [];
  const write = (...args: unknown[]) => {
    printed.push(args);
  };

  return { printed, target: { info: write, warn: write, log: write } };
}

describe('what libsignal is allowed to print', () => {
  it('drops the lines that carry the ratchet keys', () => {
    const { printed, target } = console_();

    quietLibsignal(target);
    target.info('Closing session:', session);
    target.warn('Session already closed', session);

    expect(printed).toEqual([]);
  });

  it('leaves every other line alone, so a failure still explains itself', () => {
    const { printed, target } = console_();

    quietLibsignal(target);
    target.warn('Decrypted message with closed session.');
    target.log('Anything else');

    expect(printed).toEqual([['Decrypted message with closed session.'], ['Anything else']]);
  });

  it('does not stack a second filter when a device reconnects', () => {
    const { printed, target } = console_();

    quietLibsignal(target);
    const once = target.info;

    quietLibsignal(target);

    expect(target.info).toBe(once);

    target.info('Still here');

    expect(printed).toEqual([['Still here']]);
  });
});

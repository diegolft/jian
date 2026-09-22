import { describe, expect, it } from 'vitest';
import { conversational } from '../src/channels/conversation.js';

describe('an answer as a person would send it', () => {
  it('leaves a short reply as one message', () => {
    expect(conversational('Pode sim.', 4000)).toEqual(['Pode sim.']);
  });

  it('sends one message per paragraph the agent wrote', () => {
    const answer = 'Consegui ver aqui.\n\nO deploy está liberado.\n\nQuer que eu avise o time?';

    expect(conversational(answer, 4000)).toEqual([
      'Consegui ver aqui.',
      'O deploy está liberado.',
      'Quer que eu avise o time?',
    ]);
  });

  it('keeps a list with nothing but the list, and its intro before it', () => {
    expect(conversational('Os planos:\n\n• Básico\n• Pro', 4000)).toEqual([
      'Os planos:',
      '• Básico\n• Pro',
    ]);
  });

  it('divides a paragraph that does not fit at a sentence end', () => {
    const long = `${'a'.repeat(30)}. ${'B'.repeat(30)}. ${'C'.repeat(30)}.`;
    const parts = conversational(long, 40);

    expect(parts.every((part) => part.length <= 40)).toBe(true);
    expect(parts.join(' ')).toBe(long);
  });

  it('cuts by length only when one sentence is longer than a whole message', () => {
    const parts = conversational('x'.repeat(90), 40);

    expect(parts).toEqual(['x'.repeat(40), 'x'.repeat(40), 'x'.repeat(10)]);
  });

  it('never turns an answer into a notification storm', () => {
    const parts = conversational(
      Array.from({ length: 30 }, (_, index) => `Parágrafo ${index}.`).join('\n\n'),
      4000,
    );

    expect(parts).toHaveLength(8);
    expect(parts.at(-1)).toContain('Parágrafo 29.');
  });
});

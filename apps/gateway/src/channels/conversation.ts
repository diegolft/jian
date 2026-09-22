/**
 * An answer as a person would send it: a few complete messages instead of one block, and
 * never a message that rewrites itself while it is read.
 *
 * The split follows what the writer already wrote — a blank line is where they paused — so a
 * short reply stays one message and a structured one arrives as the parts it was built from.
 */

/** Beyond this the reader is looking at a notification stream, not a conversation. */
const MAX_PARTS = 8;

/** A sentence ends at punctuation followed by space and a capital, a digit or a quote. */
const SENTENCE = /(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"'“¿¡•])/u;

export function conversational(text: string, limit: number): string[] {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const parts = blocks.flatMap((block) => (block.length <= limit ? [block] : cut(block, limit)));

  if (parts.length <= MAX_PARTS) {
    return parts.length ? parts : [text.trim()].filter(Boolean);
  }

  // Past the cap the tail is joined back together rather than dropped, then cut to fit.
  const head = parts.slice(0, MAX_PARTS - 1);
  const tail = parts.slice(MAX_PARTS - 1).join('\n\n');

  return [...head, ...(tail.length <= limit ? [tail] : cut(tail, limit))];
}

/** One block that does not fit, divided at sentence ends and only then at raw length. */
function cut(block: string, limit: number): string[] {
  const parts: string[] = [];
  let current = '';

  for (const sentence of block.split(SENTENCE)) {
    if (sentence.length > limit) {
      if (current) {
        parts.push(current);
        current = '';
      }

      for (let offset = 0; offset < sentence.length; offset += limit) {
        parts.push(sentence.slice(offset, offset + limit));
      }

      continue;
    }

    const joined = current ? `${current} ${sentence}` : sentence;

    if (joined.length > limit) {
      parts.push(current);
      current = sentence;
      continue;
    }

    current = joined;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

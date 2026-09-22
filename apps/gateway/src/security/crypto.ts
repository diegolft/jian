import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const MAX_SECRET_BYTES = 1024 * 1024;
const MAX_AAD_BYTES = 1024;
const MAX_KEY_ID_BYTES = 128;

export interface EncryptedSecret {
  version: 1;
  keyId: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

function validBoundText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= maxBytes
  );
}

function decodeBase64(value: unknown, expectedBytes?: number): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_SECRET_BYTES * 4) / 3) + 8 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error('Invalid encrypted secret');
  }

  const bytes = Buffer.from(value, 'base64');

  if (
    bytes.toString('base64') !== value ||
    (expectedBytes !== undefined && bytes.length !== expectedBytes)
  ) {
    throw new Error('Invalid encrypted secret');
  }

  return bytes;
}

export class SecretBox {
  private readonly activeKeyId: string;
  private readonly keys: Map<string, Buffer>;

  constructor(config: { activeKeyId: string; keys: Record<string, Buffer> }) {
    if (!validBoundText(config.activeKeyId, MAX_KEY_ID_BYTES)) {
      throw new Error('Invalid encryption key configuration');
    }

    this.activeKeyId = config.activeKeyId;
    this.keys = new Map();

    for (const [id, key] of Object.entries(config.keys)) {
      if (!validBoundText(id, MAX_KEY_ID_BYTES) || !Buffer.isBuffer(key) || key.length !== 32) {
        throw new Error('Invalid encryption key configuration');
      }

      this.keys.set(id, Buffer.from(key));
    }

    if (!this.keys.has(this.activeKeyId)) {
      throw new Error('Invalid encryption key configuration');
    }
  }

  encrypt(plaintext: string, associatedData: string): EncryptedSecret {
    if (
      !validBoundText(plaintext, MAX_SECRET_BYTES) ||
      !validBoundText(associatedData, MAX_AAD_BYTES)
    ) {
      throw new Error('Invalid encryption input');
    }

    const iv = randomBytes(12);
    const key = this.keys.get(this.activeKeyId);

    if (!key) {
      throw new Error('Invalid encryption key configuration');
    }

    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });

    cipher.setAAD(Buffer.from(associatedData, 'utf8'));

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return {
      version: 1,
      keyId: this.activeKeyId,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(envelope: EncryptedSecret, associatedData: string): string {
    if (
      !validBoundText(associatedData, MAX_AAD_BYTES) ||
      !envelope ||
      envelope.version !== 1 ||
      !validBoundText(envelope.keyId, MAX_KEY_ID_BYTES)
    ) {
      throw new Error('Invalid encrypted secret');
    }

    const key = this.keys.get(envelope.keyId);

    if (!key) {
      throw new Error('Unknown encryption key');
    }

    const iv = decodeBase64(envelope.iv, 12);
    const ciphertext = decodeBase64(envelope.ciphertext);
    const tag = decodeBase64(envelope.tag, 16);

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });

      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(tag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Unable to decrypt secret');
    }
  }

  rotate(envelope: EncryptedSecret, associatedData: string): EncryptedSecret {
    return this.encrypt(this.decrypt(envelope, associatedData), associatedData);
  }
}

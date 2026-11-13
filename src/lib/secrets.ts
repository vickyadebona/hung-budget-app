import crypto from 'node:crypto';

/**
 * Bank access tokens are encrypted (AES-256-GCM) before they touch the database,
 * so a leaked database alone cannot be used to read anyone's bank data.
 */
export function keyFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('TOKEN_KEY must be 64 hex characters (run: openssl rand -hex 32)');
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decrypt(packed: string, key: Buffer): string {
  const [v, iv, tag, body] = packed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Unreadable stored token');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

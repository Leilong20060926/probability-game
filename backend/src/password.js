import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

export function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain, stored) {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(plain, salt, expected.length);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

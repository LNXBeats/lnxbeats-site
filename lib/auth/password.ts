import { hash, verify, type Options } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  // @node-rs/argon2 exposes ambient const enums, which TypeScript cannot read
  // with isolatedModules. These are the library's documented Argon2id/v19 values.
  algorithm: 2,
  version: 1,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

const ARGON2_PREFIX = "$argon2id$v=19$m=65536,t=3,p=1$";

export async function hashPassword(password: string) {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function needsPasswordRehash(passwordHash: string) {
  return !passwordHash.startsWith(ARGON2_PREFIX);
}

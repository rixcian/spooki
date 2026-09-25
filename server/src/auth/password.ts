import { hash, verify } from '@node-rs/argon2';

export type PasswordVerifier = (candidate: string) => Promise<boolean>;

export async function createPasswordVerifier(plain: string): Promise<PasswordVerifier> {
  const hashed = await hash(plain);
  return (candidate) => verify(hashed, candidate).catch(() => false);
}

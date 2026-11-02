import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export type Identity = { operator: string; scope: string; expiresAt: number };
export class Auth {
  private salt = randomBytes(16);
  private passwordHash: Buffer;
  private sessions = new Map<string, Identity>();
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(password: string) {
    if (password.length < 12) throw new Error('AUTH_PASSWORD_TOO_SHORT');
    this.passwordHash = scryptSync(password,this.salt,64);
  }
  login(password: unknown,address = 'loopback'): string {
    const now=Date.now();
    let attempts=this.attempts.get(address);
    if (!attempts || attempts.until<now) {
      attempts={count:0,until:now+900000}; this.attempts.set(address,attempts);
    }
    if (attempts.count>=6) throw new Error('LOGIN_RATE_LIMITED');
    attempts.count++;
    if (typeof password !== 'string' || password.length>200 ||
      !timingSafeEqual(scryptSync(password,this.salt,64),this.passwordHash)) throw new Error('LOGIN_FAILED');
    attempts.count=0;
    const token=randomBytes(32).toString('hex');
    this.sessions.set(this.hash(token),{operator:'cc',scope:'main',expiresAt:now+8*3600000});
    return token;
  }
  identity(req: Pick<IncomingMessage,'headers'>): Identity | undefined {
    const token=req.headers.cookie?.match(/(?:^|;\s*)amazonops_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (!token) return;
    const identity=this.sessions.get(this.hash(token));
    if (identity && identity.expiresAt>Date.now()) return identity;
    this.sessions.delete(this.hash(token));
  }
  logout(req: Pick<IncomingMessage,'headers'>): void {
    const token=req.headers.cookie?.match(/(?:^|;\s*)amazonops_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) this.sessions.delete(this.hash(token));
  }
  private hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
}

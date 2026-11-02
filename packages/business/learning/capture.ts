import { Store, type Base, type Source } from '../core/store.ts';
import { Learning } from './service.ts';

type CaptureJob = Base & { sourceId: string; status: string; attempts: number; type: string };
export class Capture {
  store: Store;
  learning: Learning;
  constructor(store: Store, learning: Learning) {
    this.store = store;
    this.learning = learning;
  }
  enqueue(scope: string, text: string, id: string, sessionId?: string): Source {
    return this.store.once(scope, `source:${id}`, () => {
      const source = this.store.source(scope, text, id, sessionId);
      if (this.learning.enabled(scope))
        this.store.create(scope, 'job', {
          type: 'capture',
          sourceId: source.id,
          status: 'pending',
          attempts: 0,
        });
      return source;
    });
  }
  drain(scope: string): void {
    if (!this.learning.enabled(scope)) return;
    for (const job of this.store
      .list<CaptureJob>(scope, 'job')
      .filter((row) => row.type === 'capture' && row.status === 'pending')) {
      try {
        const source = this.store.get<Source>(scope, job.sourceId);
        if (
          /(?:不好用|算错|太慢|不满意|希望增加|建议|改进|不方便|不能用|界面.*问题)/.test(
            source.text,
          )
        )
          this.learning.feedback(scope, source.id, { text: source.text });
        const memory = source.text.match(
          /^(?:请)?(?:记住|更正)[：:，,\s]+(.{1,80}?)[是为=：:](.{1,300})$/u,
        );
        if (memory)
          this.learning.remember(scope, source.id, memory[1].trim(), memory[2].trim(), true);
        this.learning.compact(scope);
        this.store.update(job, { status: 'completed', attempts: job.attempts + 1 });
      } catch {
        this.store.update(job, {
          status: this.store.isDeleted(scope, job.sourceId) ? 'cancelled' : 'failed',
          attempts: job.attempts + 1,
        });
      }
    }
  }
}

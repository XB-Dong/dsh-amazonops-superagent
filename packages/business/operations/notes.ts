import { Store } from '../core/store.ts';
import { safeText } from '../core/validation.ts';
import type { Note } from './note-types.ts';

export type NoteInput = { title: string; content: string };
function normalize(input: NoteInput): NoteInput {
  return { title: safeText(input?.title, 200), content: safeText(input?.content, 10000) };
}

export class Notes {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  create(scope: string, key: string, input: NoteInput): Note {
    const values = normalize(input);
    return this.store.once(scope, `note:${safeText(key, 100)}`, () =>
      this.store.create(scope, 'note', values),
    );
  }
  update(scope: string, id: string, revision: number, input: NoteInput): Note {
    const values = normalize(input);
    return this.store.transaction(() => {
      const note = this.current(scope, id, revision);
      return this.store.update(note, values, revision);
    });
  }
  remove(scope: string, id: string, revision: number): void {
    this.store.transaction(() => {
      this.current(scope, id, revision);
      // Use the durable privacy intent so older database backups cannot revive the note.
      this.store.remove(scope, id, 'delete-note');
    });
  }
  private current(scope: string, id: string, revision: number): Note {
    const note = this.store.get<Note>(scope, id);
    if (note.kind !== 'note') throw new Error('INVALID_NOTE');
    if (!Number.isSafeInteger(revision) || revision < 1 || note.revision !== revision)
      throw new Error('REVISION_CONFLICT');
    return note;
  }
}

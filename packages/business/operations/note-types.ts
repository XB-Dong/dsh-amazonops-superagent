import type { Base } from '../core/store.ts';

export type Note = Base & {
  title: string;
  content: string;
};

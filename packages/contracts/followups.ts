import type { Base } from './model.ts';

export type WatchCreate = { requestId: string; inventoryId: string; expiresAt: string; title?: string };
export type InventoryWatch = Base & {
  inventoryId: string; store: string; site: string; listing: string; physicalSku: string;
  title: string; expiresAt: string; status: 'active' | 'stopped' | 'expired' | 'completed';
  sourceId: string; sources: string[]; ticketId?: string;
};
export type InventoryRule = Base & {
  mode: 'off' | 'observe' | 'auto'; inventoryIds: string[]; sourceId: string; sources: string[];
};
export type RiskSnapshot = {
  inventoryId: string; forecastId: string; store: string; site: string; listing: string; physicalSku: string;
  stockoutDate: string | null; replenishQuantity: number; sourceIds: string[]; digest: string; summary: string;
};
export type FollowupEvent = Base & {
  eventClass: 'watch_update' | 'risk_candidate'; eventId: string; sequence: number;
  inventoryId: string; watchId?: string; ruleRevision?: number; ruleMode?: 'observe' | 'auto';
  risk: RiskSnapshot; status: 'pending' | 'delivered'; sources: string[];
};
export type FollowupSnapshot = { watches: InventoryWatch[]; rule: InventoryRule | null; events: FollowupEvent[] };

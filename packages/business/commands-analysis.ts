import { Store } from './core/store.ts';
import { safeText } from './core/validation.ts';
import { forecastVersion, type ForecastInput } from './operations/forecast.ts';
import { saveInventory, type ProjectionInput } from './operations/inventory.ts';
import { createPool, allocate, type Pool } from './operations/allocation.ts';
import {
  createShipment,
  updateShipment,
  type Shipment,
} from './operations/shipping.ts';
import { saveAdAnalysis, type AdOptions } from './operations/advertising.ts';

export function operate(
  store: Store,
  scope: string,
  action: string,
  body: Record<string, unknown>,
): unknown {
  if (action === 'advertising')
    return saveAdAnalysis(store, scope, safeText(body.batchId, 100), body.options as AdOptions);
  if (action === 'forecast') {
    safeText(body.requestId, 100);
    return forecastVersion(store, scope, body as ForecastInput);
  }
  if (action === 'inventory')
    return saveInventory(
      store,
      scope,
      body as ProjectionInput & { forecastId: string; physicalSku: string },
    );
  if (action === 'pool') {
    safeText(body.batchReference, 100);
    return createPool(
      store,
      scope,
      safeText(body.requestId, 100),
      body as Pick<Pool, 'physicalSku' | 'quantity' | 'windows' | 'batchReference'>,
    );
  }
  if (action === 'allocate')
    return allocate(
      store,
      scope,
      safeText(body.requestId, 100),
      body as {
        poolId: string;
        inventoryId: string;
        quantity: number;
        shipDate: string;
        revision: number;
      },
    );
  if (action === 'shipment') return createShipment(store, scope, safeText(body.allocationId, 100));
  if (action === 'shipment-update')
    return updateShipment(
      store,
      scope,
      safeText(body.id, 100),
      Number(body.revision),
      safeText(body.requestId, 100),
      body as Partial<Shipment>,
    );
}

import type { CommandMap } from './command-context.ts';
import type { ReportInput } from './operations/reports.ts';
export const analysisCommands: CommandMap = Object.fromEntries(
  ['advertising','forecast','inventory','pool','allocate','shipment','shipment-update'].map(action =>
    [action, (context, scope, body) => operate(context.store, scope, action, body)]),
);
analysisCommands['report-preview'] = (context, scope, body) => context.reports.preview(body as ReportInput);
analysisCommands['report-import'] = (context, scope, body) => context.reports.import(scope, body as ReportInput);

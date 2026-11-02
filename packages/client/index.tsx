import type { Context } from '@deepseek-ai/cordis';
import { useEffect, useRef } from 'react';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { MainPanelId, SidebarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import { App } from './App.tsx';
import './styles.css';

export const inject = ['slots', 'locale', 'uiWorkspace', 'layout'];
// Remember an outstanding collapse across StrictMode effect replays until props catch up.
export function requestSidebarCollapse(collapsed: boolean, requested: boolean, toggle: () => void): boolean {
  if (collapsed) return false;
  if (!requested) toggle();
  return true;
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { amazonops: 'panel' }
}
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('amazonops', { zh: { panel: 'cc 运营工作台' }, en: { panel: 'cc 运营工作台' } }), 'amazonops:locale');
  ctx.slots.inject('main', () => {
    const dispose=ctx.slots.register({ name: 'main', key: 'amazonops' as MainPanelId, locale: 'amazonops', inject: () => ({}) },
      () => <div className="amazonops"><App openSession={(id) => ctx.uiWorkspace.openSession(id as never)} /></div>);
    ctx.layout.selectPanel('amazonops' as MainPanelId);
    return dispose;
  });
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'amazonops', order: 1, label: () => 'cc 运营工作台', locale: 'amazonops' },
    () => <span aria-hidden="true">cc</span>));
  // The layout's public single-slot seam replaces coding navigation, not the native frame.
  ctx.slots.inject('sidebar', () => ctx.slots.register({ name: 'sidebar', priority: -10 },
    function OperationsRail({ collapsed, width }: SidebarOwnerProps) {
      const requested = useRef(false);
      useEffect(() => {
        requested.current = requestSidebarCollapse(collapsed, requested.current, () => ctx.layout.toggleSidebar());
      }, [collapsed]);
      return <nav aria-label="工作台导航" style={{ width, height: '100%', paddingTop: 12, textAlign: 'center' }}>
        <button type="button" aria-label="返回cc运营工作台" title="返回cc运营工作台"
          style={{ font: 'inherit', cursor: 'pointer', padding: 8 }}
          onClick={() => ctx.layout.selectPanel('amazonops' as MainPanelId)}>cc</button>
      </nav>;
    }));
}

import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import { App } from './App.tsx';
import './styles.css';

export const inject = ['slots', 'locale', 'uiWorkspace'];
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { amazonops: 'panel' }
}
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('amazonops', { zh: { panel: 'cc 运营工作台' }, en: { panel: 'cc 运营工作台' } }), 'amazonops:locale');
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'amazonops' as MainPanelId, locale: 'amazonops', inject: () => ({}) },
    () => <div className="amazonops"><App openSession={(id) => ctx.uiWorkspace.openSession(id as never)} /></div>));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'amazonops', order: 1, label: () => 'cc 运营工作台', locale: 'amazonops' },
    () => <span aria-hidden="true">cc</span>));
}

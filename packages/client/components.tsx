import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
      <path d="M9 21v-8h6v8" />
    </>
  ),
  chat: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z" />
    </>
  ),
  tasks: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  feedback: (
    <>
      <path d="M21 12a9 9 0 1 0-9 9h6l3 1v-6a9 9 0 0 0 0-4Z" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  book: (
    <>
      <path d="M12 5c-3-3-8-2-9-1v16c3-2 6-2 9 0 3-2 6-2 9 0V4c-3-2-6-2-9 1v15" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2" />
    </>
  ),
  box: (
    <>
      <path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v10m-5-16 10 5" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18M7 14l4-4 4 3 6-8" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="8" cy="7" r="3" />
      <circle cx="16" cy="17" r="3" />
    </>
  ),
  arrow: (
    <>
      <path d="m5 12 14 0-6-6m6 6-6 6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  spark: (
    <>
      <path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  send: (
    <>
      <path d="m12 19 0-14-6 6m6-6 6 6" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.box}
    </svg>
  );
}
export function Empty({
  title,
  text,
  icon = 'box',
}: {
  title: string;
  text: string;
  icon?: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function SourceList({ sources }: { sources: string[] }) {
  return <span className="metadata">已保留 {sources.length} 条来源记录</span>;
}
export const states: Record<string, string> = {
  draft: '待确认',
  open: '待处理',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
  captured: '已记下',
  accepted: '已采纳',
  deferred: '暂缓',
  rejected: '不采纳',
  withdrawn: '已撤回',
  confirmed: '已确认',
  inferred: '待确认',
  superseded: '已被更正',
  active: '可复用',
  revoked: '已停用',
  candidate: '候选',
  waiting_confirmation: '等待确认',
  pending: '待整理',
  completed: '完成',
  failed: '失败',
};

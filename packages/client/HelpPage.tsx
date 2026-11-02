import guide from './guide.ts';
import { download } from './api.ts';

export function HelpPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">用的时候看一眼就好</span>
          <h1>使用说明</h1>
          <p>先从任务和反馈开始，其他功能按需使用。</p>
        </div>
        <button
          className="secondary"
          onClick={() =>
            download(
              'cc工作台使用说明.txt',
              guide.replace(/^#+ /gm, ''),
              'text/plain;charset=utf-8',
            )
          }
        >
          下载说明书
        </button>
      </div>
      <article className="panel user-guide">
        {guide
          .split('\n')
          .filter(Boolean)
          .map((line, index) =>
            line.startsWith('# ') ? null : line.startsWith('## ') ? (
              <h2 key={index}>{line.slice(3)}</h2>
            ) : (
              <p key={index}>{line}</p>
            ),
          )}
      </article>
    </>
  );
}

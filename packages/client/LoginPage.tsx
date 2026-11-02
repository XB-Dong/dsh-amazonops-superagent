import type { FormEvent } from 'react';
import { Icon } from './components.tsx';

export function LoginPage({
  busy,
  error,
  login,
}: {
  busy: boolean;
  error: string;
  login: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <main className="login-screen">
      <div className="login-decoration" />
      <section className="login-card">
        <div className="brand">
          <div className="brand-mark">
            c<span>c</span>
          </div>
          <div>
            <strong>cc 的工作台</strong>
            <small>你的专属运营助手</small>
          </div>
        </div>
        <span className="eyebrow">让工作轻一点</span>
        <h1>cc，你好！</h1>
        <p>
          整理任务，积累经验。
          <br />
          从这里开始，让每天的运营轻一点。
        </p>
        <form onSubmit={(event) => void login(event)}>
          <label>
            工作台密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="输入你的访问密码"
              required
              autoFocus
            />
          </label>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            进入工作台 <Icon name="arrow" size={17} />
          </button>
        </form>
        <small>登录后，从左侧选择功能。不知道怎么用，可以先看“使用说明”。</small>
      </section>
      <div className="login-caption">少一些重复，多一些从容。</div>
    </main>
  );
}

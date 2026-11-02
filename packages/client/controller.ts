import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { api, empty, type Snapshot, type Status } from './api.ts';
export function useWorkbench() {
  const [page, setPage] = useState('home');
  const [status, setStatus] = useState<Status>();
  const [data, setData] = useState<Snapshot>(empty);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const refresh = useCallback(async () => {
    const [nextStatus, snapshot] = await Promise.all([
      api<Status>('status'),
      api<Snapshot>('snapshot'),
    ]);
    setStatus(nextStatus);
    setData(snapshot);
    setAuthenticated(true);
  }, []);
  useEffect(() => {
    void refresh()
      .catch(() => setAuthenticated(false))
      .finally(() => setReady(true));
  }, [refresh]);
  useEffect(() => {
    if (!authenticated) return;
    const onFocus = () => { void refresh().catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [authenticated, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('login', { password: values.get('password') });
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : '登录未完成');
    } finally {
      setBusy(false);
    }
  }
  async function mutate(action: string, body: object): Promise<unknown> {
    setBusy(true);
    setError('');
    try {
      const result = await api(`actions/${action}`, body);
      await refresh();
      setNotice(
        action === 'export'
          ? '已生成建议清单，可以下载保存'
          : action === 'report-preview'
            ? '检查完成，请核对预览'
            : '已保存',
      );
      return result;
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成');
      throw error;
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: string) {
    setPage(next);
    setMenuOpen(false);
    setError('');
    void refresh().catch(() => {});
  }
  function prompt(text: string) {
    setInitialPrompt(text);
    navigate('assistant');
  }
  return {page,status,data,ready,authenticated,error,notice,busy,initialPrompt,menuOpen,setMenuOpen,setError,setAuthenticated,setData,refresh,login,mutate,navigate,prompt};
}

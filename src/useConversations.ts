import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationSummary } from './types';

function locationId() {
  return window.location.pathname.match(/^\/conversations\/(\d+)\/?$/)?.[1] ?? null;
}

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const requestVersion = useRef(0);
  const select = useCallback((id: string, replace = false) => {
    setSelectedId(id);
    window.history[replace ? 'replaceState' : 'pushState']({}, '', `/conversations/${id}`);
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const response = await fetch('/api/conversations');
    if (!response.ok) throw new Error('无法读取会话列表');
    const items: ConversationSummary[] = await response.json();
    if (version === requestVersion.current) setConversations(items);
    return items;
  }, []);
  useEffect(() => {
    let active = true;
    void refresh().then((items) => {
      if (!active) return;
      const requested = locationId();
      const id = items.find((item) => item.id === requested)?.id ?? items[0]?.id;
      if (id) select(id, true);
    }).catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [refresh, select]);
  useEffect(() => {
    const onPopState = () => {
      const id = locationId();
      if (conversations.some((item) => item.id === id)) setSelectedId(id);
      else if (conversations[0]) select(conversations[0].id, true);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [conversations, select]);
  async function create() {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/conversations', { method: 'POST' });
      if (!response.ok) throw new Error('无法新建会话');
      const item: ConversationSummary = await response.json();
      requestVersion.current++;
      setConversations((items) => [item, ...items.filter((existing) => existing.id !== item.id)]);
      select(item.id);
    } catch (error) { setError((error as Error).message); }
    finally { setCreating(false); }
  }
  return { conversations, selectedId, select, create, creating, refresh, error };
}

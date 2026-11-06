import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationSummary } from './types';

function locationId() {
  return window.location.pathname.match(/^\/conversations\/(\d+)\/?$/)?.[1] ?? null;
}

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const requestVersion = useRef(0);
  const select = useCallback((id: string, replace = false) => {
    selectedRef.current = id;
    setSelectedId(id);
    window.history[replace ? 'replaceState' : 'pushState']({}, '', `/conversations/${id}`);
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const response = await fetch('/api/conversations?includeArchived=true');
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
      const id = items.find((item) => item.id === requested)?.id ?? items.find((item) => !item.archived)?.id;
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
  async function create(input: { workspaceId?: string; path?: string; trusted?: boolean } = {}) {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const response = await fetch(input.path === undefined ? '/api/conversations' : '/api/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (!response.ok) {
        const result = await response.json();
        throw Object.assign(new Error(result.error), { workspaceId: result.workspaceId });
      }
      const data = await response.json();
      const item: ConversationSummary = input.path === undefined ? data : data.conversation;
      requestVersion.current++;
      setConversations((items) => [item, ...items.filter((existing) => existing.id !== item.id)]);
      select(item.id);
      return item;
    } catch (error) { if (!(error as { workspaceId?: string }).workspaceId) setError((error as Error).message); throw error; }
    finally { setCreating(false); }
  }
  async function rename(id: string, title: string) {
    const response = await fetch(`/api/conversations/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
    if (!response.ok) throw new Error((await response.json()).error);
    await refresh();
  }
  async function archive(id: string) {
    const response = await fetch(`/api/conversations/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) });
    if (!response.ok) throw new Error((await response.json()).error);
    const items = await refresh();
    if (selectedRef.current === id) {
      const next = items.find((item) => !item.archived);
      if (next) select(next.id, true);
      else await create();
    }
  }
  return { conversations, selectedId, select, create, creating, refresh, rename, archive, error };
}

import { useCallback, useEffect, useState } from 'react';
import type { ConversationState } from './types';

type Connection = 'connecting' | 'connected' | 'reconnecting';

export function useConversation(conversationId: string | null) {
  const [snapshot, setSnapshot] = useState<ConversationState | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((revision) => revision + 1), []);

  useEffect(() => {
    setSnapshot((previous) => previous?.id === conversationId ? previous : null);
    setConnection('connecting');
    if (!conversationId) return;
    let active = true;
    const stream = new EventSource(`/api/conversations/${conversationId}/events`);
    stream.addEventListener('state', (event) => {
      if (!active) return;
      const next = JSON.parse(event.data) as ConversationState;
      if (next.id !== conversationId) return;
      setSnapshot(next);
      setConnection('connected');
    });
    stream.onerror = () => { if (active) setConnection('reconnecting'); };
    return () => { active = false; stream.close(); };
  }, [conversationId, revision]);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return { state: snapshot?.id === conversationId ? snapshot : null, connection, refresh };
}

import { useEffect, useState } from 'react';
import type { ConversationState } from './types';

type Connection = 'connecting' | 'connected' | 'reconnecting';

export function useConversation(conversationId: string | null) {
  const [snapshot, setSnapshot] = useState<ConversationState | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');

  useEffect(() => {
    setSnapshot(null);
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
  }, [conversationId]);

  return { state: snapshot?.id === conversationId ? snapshot : null, connection };
}

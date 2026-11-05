import { useLayoutEffect, useRef, type UIEvent } from 'react';

export function useFollowingScroll(conversationId: string | undefined, content: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => { following.current = true; }, [conversationId]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [content]);
  function onScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }
  return { scrollRef, onScroll };
}

import { useId } from 'react';
import type { ContextUsage } from './types';
import styles from './ContextUsageIndicator.module.css';

function formatTokens(tokens: number) {
  if (tokens < 1000) return String(tokens);
  return `${Number((tokens / 1000).toFixed(1))}k`;
}

export function ContextUsageIndicator({ usage, contextWindow, provider, modelId }: { usage: ContextUsage | null; contextWindow: number; provider: string; modelId: string }) {
  const tooltipId = useId();
  const percent = usage ? usage.tokens / contextWindow * 100 : 0;
  const estimated = usage && (usage.estimated || Boolean(usage.model && (usage.model.provider !== provider || usage.model.modelId !== modelId)));
  const description = usage ? `已使用${estimated ? '约 ' : ' '}${formatTokens(usage.tokens)} / ${formatTokens(contextWindow)} tokens（${Math.round(percent)}%）` : '上下文用量加载中';
  return <span className={styles.indicator} role="progressbar" tabIndex={0} aria-label="上下文占用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage ? Math.min(100, Math.round(percent)) : undefined} aria-valuetext={description} aria-describedby={tooltipId}>
    <svg className={percent >= 100 ? styles.full : percent >= 80 ? styles.nearFull : undefined} width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle className={styles.track} cx="10" cy="10" r="7" strokeWidth="2" />
      <circle className={styles.progress} cx="10" cy="10" r="7" strokeWidth="2" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - Math.min(100, percent)} />
    </svg>
    <span id={tooltipId} className={styles.tooltip} role="tooltip">{description}</span>
  </span>;
}

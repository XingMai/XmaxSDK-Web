interface StatisticsRow {
  label: string;
  value: string;
  title?: string;
  className?: string;
}

interface StatisticsPanelProps {
  label: string;
  rows: readonly StatisticsRow[];
  className?: string;
}

/**
 * 仅渲染已格式化的统计值，不参与采集、日志或显示开关。
 */
export function StatisticsPanel({ label, rows, className = "videoStatistics" }: StatisticsPanelProps) {
  return (
    <dl className={className} aria-label={label}>
      {rows.map((row) => (
        <div key={row.label} title={row.title} className={row.className}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

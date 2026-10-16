interface StatisticsToggleProps {
  visible: boolean;
  onChange: (visible: boolean) => void;
}

/** 只切换统计面板的可见性，不控制采集或日志。 */
export function StatisticsToggle({ visible, onChange }: StatisticsToggleProps) {
  return (
    <button
      type="button"
      className={`statisticsToggle${visible ? " active" : ""}`}
      aria-label="显示统计信息"
      aria-pressed={visible}
      aria-controls="local-statistics remote-statistics"
      title={visible ? "隐藏统计信息（采集和日志继续）" : "显示统计信息"}
      onClick={() => onChange(!visible)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4v16h16M8 15v-4m5 4V7m5 8V9" />
      </svg>
    </button>
  );
}

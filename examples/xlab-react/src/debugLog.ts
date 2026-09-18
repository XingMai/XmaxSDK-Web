import { useSyncExternalStore } from "react";

/** 单条调试日志。 */
export interface DebugLogEntry {
  level: string;
  text: string;
  time: string;
}

const MAX_ENTRIES = 300;
const MAX_LINE_LENGTH = 600;

const entries: DebugLogEntry[] = [];
let snapshot: DebugLogEntry[] = [];
const listeners = new Set<() => void>();
let installed = false;

/** 序列化单个日志参数，对象截断到有限长度。 */
function formatArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** 追加一条日志并通知订阅者。 */
function append(level: string, args: unknown[]): void {
  const text = args
    .map(formatArg)
    .join(" ")
    .slice(0, MAX_LINE_LENGTH);
  entries.push({
    level,
    text,
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  // useSyncExternalStore 依赖引用变化触发渲染，每次追加生成新快照。
  snapshot = [...entries];
  for (const listener of listeners) {
    listener();
  }
}

/**
 * 劫持 console 输出并镜像到面板日志（原始控制台输出保持不变）。
 * 重复调用不产生效果。
 */
export function installConsoleMirror(): void {
  if (installed) {
    return;
  }
  installed = true;
  for (const level of ["debug", "info", "log", "warn", "error"] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      append(level === "log" ? "info" : level, args);
      original.apply(console, args);
    };
  }
  window.addEventListener("error", (event) => {
    append("error", [`${event.message} @ ${event.filename}:${event.lineno}`]);
  });
  window.addEventListener("unhandledrejection", (event) => {
    append("error", [`unhandled rejection: ${formatArg(event.reason)}`]);
  });
}

/** 订阅面板日志变化（React useSyncExternalStore 用）。 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 读取当前面板日志快照。 */
function getSnapshot(): DebugLogEntry[] {
  return snapshot;
}

/** React Hook：实时读取面板日志。 */
export function useDebugLogs(): DebugLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 清空面板日志。 */
export function clearDebugLogs(): void {
  entries.length = 0;
  snapshot = [];
  for (const listener of listeners) {
    listener();
  }
}

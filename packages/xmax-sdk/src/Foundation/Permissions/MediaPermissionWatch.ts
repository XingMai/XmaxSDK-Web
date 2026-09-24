/**
 * 媒体权限弹窗观察器。
 */
export interface MediaPermissionWatch {
  /**
   * 用户完成授权决定（所有观察的权限离开 prompt 状态）时兑现。
   */
  readonly decided: Promise<void>;

  /**
   * 移除授权变化监听；调用后 decided 不再兑现。
   */
  dispose(): void;
}

/**
 * 授权状态轮询间隔（毫秒）。
 *
 * Safari 的 PermissionStatus.onchange 不会触发（状态变化只能重新查询
 * 发现），在 onchange 之外用轮询兜底；间隔决定授权耗时的最大误差。
 */
const PERMISSION_POLL_INTERVAL_MS = 100;

/**
 * 观察相机（可选麦克风）的系统授权状态。
 *
 * 权限均已授权时返回立即兑现的观察器（授权耗时接近 0）；任一权限处于
 * prompt 状态时返回观察器，在用户完成授权决定时兑现；存在已拒绝权限或
 * 浏览器不支持该查询（如部分 Safari 版本）时返回 undefined，不记录耗时。
 */
export async function watchMediaPermissionPrompt(
  includeMicrophone: boolean,
): Promise<MediaPermissionWatch | undefined> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return undefined;
  }

  // TS 标准库未包含 camera/microphone 描述名，按运行时能力调用。
  const names = ["camera", ...(includeMicrophone ? ["microphone"] : [])];
  const queryOnce = (): Promise<PermissionState[]> =>
    Promise.all(
      names.map(async (name) => {
        const status = await navigator.permissions.query({
          name: name as PermissionName,
        });
        return status.state;
      }),
    );
  const queryStates = (): Promise<PermissionState[]> =>
    Promise.all(
      names.map(async (name) => {
        try {
          const status = await navigator.permissions.query({
            name: name as PermissionName,
          });
          return status.state;
        } catch {
          // 轮询期间的查询失败按未决定处理，等待下次轮询。
          return "prompt" as PermissionState;
        }
      }),
    );

  let states: PermissionState[];
  try {
    states = await queryOnce();
  } catch {
    // 浏览器不支持该查询（如部分 Safari 版本），无法观察授权耗时。
    return undefined;
  }

  // 已全部授权时立即兑现（授权耗时接近 0）；存在 denied 时无法观察，不记录。
  if (states.every((state) => state === "granted")) {
    return { decided: Promise.resolve(), dispose() {} };
  }
  if (!states.includes("prompt")) {
    return undefined;
  }

  let disposed = false;
  let resolveDecided!: () => void;
  const decided = new Promise<void>((resolve) => {
    resolveDecided = resolve;
  });

  const finishIfDecided = (current: PermissionState[]): void => {
    if (disposed || current.includes("prompt")) {
      return;
    }
    dispose();
    resolveDecided();
  };

  const poll = setInterval(() => {
    void queryStates().then(finishIfDecided);
  }, PERMISSION_POLL_INTERVAL_MS);

  function dispose(): void {
    disposed = true;
    clearInterval(poll);
  }

  return { decided, dispose };
}

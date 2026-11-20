import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, UpdateState } from "../types";

const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const INITIAL_STATE: UpdateState = {
  phase: "idle",
  currentVersion: "",
  info: null,
  progress: 0,
  error: "",
  lastCheckedAt: 0,
  canInstallInApp: false,
};

export interface Updater {
  state: UpdateState;
  /** 启动时的静默提示是否已关闭（不改设置）。 */
  toastDismissed: boolean;
  /** 更新细节弹窗是否打开（用户主动点开或手动检查后发现更新）。 */
  dialogOpen: boolean;
  /** 当前版本被用户跳过时，不再主动提示。 */
  skipped: boolean;
  busy: boolean;
  check(force?: boolean): Promise<void>;
  download(): Promise<void>;
  cancel(): Promise<void>;
  install(): Promise<void>;
  openReleasePage(): Promise<void>;
  dismissToast(): void;
  openDialog(): void;
  closeDialog(): void;
  skipVersion(): Promise<void>;
  unskipVersion(): Promise<void>;
}

interface UseUpdaterOptions {
  settings: AppSettings;
  onSettingsChange(updates: Partial<AppSettings>): void;
  /** 只有主界面就绪后才自动检查，避免抢启动时的文件扫描。 */
  enabled: boolean;
}

const API_UNAVAILABLE =
  "当前环境不支持更新检查。";

function api() {
  return typeof window !== "undefined" ? window.levilNotes : undefined;
}

export function useUpdater({
  settings,
  onSettingsChange,
  enabled,
}: UseUpdaterOptions): Updater {
  const [state, setState] = useState<UpdateState>(INITIAL_STATE);
  const [toastDismissed, setToastDismissed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const autoCheckStarted = useRef(false);

  useEffect(() => {
    const host = api();
    if (!host) {
      return;
    }
    let active = true;
    host
      .getUpdateState()
      .then((next) => {
        if (active) {
          setState(next);
        }
      })
      .catch(() => {});
    const unsubscribe = host.onUpdateChanged((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const runCheck = useCallback(
    async (force: boolean) => {
      const host = api();
      if (!host) {
        setState((current) => ({
          ...current,
          phase: "error",
          error: API_UNAVAILABLE,
        }));
        return;
      }
      setBusy(true);
      try {
        const next = await host.checkForUpdate({ force });
        setState(next);
        setToastDismissed(false);
        if (next.phase === "available") {
          setDialogOpen(true);
        }
        if (next.lastCheckedAt) {
          onSettingsChange({ lastUpdateCheckAt: next.lastCheckedAt });
        }
      } catch (error) {
        setState((current) => ({
          ...current,
          phase: "error",
          error: error instanceof Error ? error.message : API_UNAVAILABLE,
        }));
      } finally {
        setBusy(false);
      }
    },
    [onSettingsChange],
  );

  // 启动时最多每 24 小时自动检查一次；失败静默。
  useEffect(() => {
    if (!enabled || autoCheckStarted.current) {
      return;
    }
    autoCheckStarted.current = true;
    const host = api();
    if (!host) {
      return;
    }
    if (!settingsRef.current.autoCheckUpdates) {
      return;
    }
    const last = Number(settingsRef.current.lastUpdateCheckAt || 0);
    if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) {
      return;
    }
    void (async () => {
      try {
        const next = await host.checkForUpdate({ silent: true });
        setState(next);
        if (next.lastCheckedAt) {
          onSettingsChange({ lastUpdateCheckAt: next.lastCheckedAt });
        }
      } catch {
        // 静默失败：不打扰用户。
      }
    })();
  }, [enabled, onSettingsChange]);

  const download = useCallback(async () => {
    const host = api();
    if (!host) {
      return;
    }
    setBusy(true);
    try {
      const next = await host.downloadUpdate();
      setState(next);
    } catch (error) {
      setState((current) => ({
        ...current,
        phase: "error",
        error: error instanceof Error ? error.message : "下载失败。",
      }));
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    const host = api();
    if (!host) {
      return;
    }
    const next = await host.cancelUpdate();
    setState(next);
  }, []);

  const install = useCallback(async () => {
    const host = api();
    if (!host) {
      return;
    }
    const result = await host.installUpdate();
    setState(result);
    setDialogOpen(false);
    // macOS 的 sidecar 没有打开能力，由宿主桥打开下载好的 DMG。
    if (!result.opened && result.target) {
      await host.openPath(result.target);
    }
  }, []);

  const openReleasePage = useCallback(async () => {
    const host = api();
    if (!host) {
      return;
    }
    const result = await host.openUpdateReleasePage();
    if (!result.opened && result.url) {
      await host.openPath(result.url);
    }
  }, []);

  const skipVersion = useCallback(async () => {
    const version = state.info?.version || "";
    setToastDismissed(true);
    if (version) {
      onSettingsChange({ skippedUpdateVersion: version });
    }
  }, [onSettingsChange, state.info?.version]);

  const unskipVersion = useCallback(async () => {
    onSettingsChange({ skippedUpdateVersion: "" });
    setToastDismissed(false);
  }, [onSettingsChange]);

  const skipped = Boolean(
    state.info && state.info.version === settings.skippedUpdateVersion,
  );

  return {
    state,
    toastDismissed,
    dialogOpen,
    skipped,
    busy,
    check: (force = true) => runCheck(force),
    download,
    cancel,
    install,
    openReleasePage,
    dismissToast: () => setToastDismissed(true),
    openDialog: () => setDialogOpen(true),
    closeDialog: () => setDialogOpen(false),
    skipVersion,
    unskipVersion,
  };
}

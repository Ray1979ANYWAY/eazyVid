import { useEffect, useState } from "react";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { useI18n } from "../i18n";

/* 非 Tauri 环境（如纯浏览器预览）时 win 为 null，按钮仅展示不可点 */
const win: Window | null = (() => {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
})();

/* 无边框窗口的右上角控制组：最小化 / 最大化(还原) / 关闭 */
export function WindowControls({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!win) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        if (!cancelled) setMaximized(await win.isMaximized());
        unlisten = await win.onResized(() => {
          void win.isMaximized().then(setMaximized);
        });
      } catch {
        /* dev 环境或无窗口时静默 */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const btnCls =
    "group inline-flex items-center justify-center w-[46px] h-full transition-colors cursor-pointer " +
    "text-white/75 hover:text-white hover:bg-white/10 active:bg-white/15";

  return (
    <div className="fixed top-0 right-0 z-50 flex h-12 select-none">
      <button className={btnCls} aria-label={t("win.minimize")} title={t("win.minimize")} onClick={() => win?.minimize()}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        className={btnCls}
        aria-label={maximized ? t("win.restore") : t("win.maximize")}
        title={maximized ? t("win.restore") : t("win.maximize")}
        onClick={() => void win?.toggleMaximize()}
      >
        {maximized ? (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
            <rect x="1" y="3.5" width="7.5" height="7.5" />
            <path d="M3.5 3.5v-2h7.5v7.5h-2" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
            <rect x="1.2" y="1.2" width="9.6" height="9.6" />
          </svg>
        )}
      </button>
      <button
        className="group inline-flex items-center justify-center w-[46px] h-full transition-colors cursor-pointer text-white/75 hover:bg-[#e81123] hover:text-white active:bg-[#c50f1f]"
        aria-label={t("win.close")}
        title={t("win.close")}
        onClick={() => {
          if (onClose) onClose();
          else void win?.close();
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M1.5 1.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

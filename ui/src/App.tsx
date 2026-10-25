import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { DownloadPanel } from "./components/DownloadPanel";
import { CompressPanel, type CompressPanelHandle } from "./components/CompressPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { WindowControls } from "./components/WindowControls";
import { TipProvider, Dialog, Button, Toggle, IconBtn, Icon, StatusDot, useTip } from "./components/ui";
import { Logo } from "./components/Logo";
import { useEngine } from "./hooks/useEngine";
import { diag } from "./diag";
import {
  type LangSetting,
  resolveLang,
  translate,
  I18nProvider,
  useI18n,
  type TranslationKey,
} from "./i18n";

export type Panel = "download" | "compress";

/* 底部持久栏（无论切换到哪个面板，右下角永远固定存在）：左侧根据当前面板展示状态/收益，右侧固定为关机开关 */
function GlobalFooter({
  panel,
  cmpGain,
  dlDoneCount,
  shutdown,
  onShutdownChange,
  theme,
  onToggleTheme,
}: {
  panel: Panel;
  cmpGain: number;
  dlDoneCount: number;
  shutdown: boolean;
  onShutdownChange: (v: boolean) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const show = useTip();
  const { t } = useI18n();
  return (
    <footer className="shrink-0 h-12 px-4 border-t border-border-soft bg-card/85 backdrop-blur-sm flex items-center gap-3">
      {/* 左下角恒定放版本号与深浅主题切换 */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-[11.5px] font-mono font-semibold text-text-sub select-none">
          v0.1.0
        </span>
        {/* 小太阳与小月亮切换按钮 */}
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === "dark" ? t("theme.light") : t("theme.dark")}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-sub hover:text-text-main hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label={t("theme.toggle")}
        >
          {theme === "dark" ? (
            /* 小太阳 (Sun Icon) */
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
            </svg>
          ) : (
            /* 小月亮 (Moon Icon) */
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>
            </svg>
          )}
        </button>
      </div>

      {/* 收益或统计提示：放在版本号与主题按钮的右边 */}
      {panel === "compress" ? (
        <div className="text-[13.5px] text-text-main tabular-nums flex items-center gap-1.5 min-w-0">
          <span className="text-border-soft">|</span>
          <span className="truncate">{t("footer.gain", { gain: (cmpGain / 1024 ** 3).toFixed(2) })}</span>
        </div>
      ) : dlDoneCount > 0 ? (
        <div className="text-[13.5px] text-text-main tabular-nums flex items-center gap-1.5 min-w-0">
          <span className="text-border-soft">|</span>
          <span className="truncate">{t("footer.dlCount", { count: dlDoneCount })}</span>
        </div>
      ) : (
        <div className="text-[13.5px] text-text-sub tabular-nums" />
      )}
      <div className="flex-1" />
      <div
        className="flex items-center gap-2 select-none"
        onMouseEnter={(e) => show(e.currentTarget, t("footer.shutdownTip"))}
      >
        <Toggle checked={shutdown} onChange={onShutdownChange} />
        <span
          className="text-[14px] text-text-main cursor-pointer"
          onClick={() => onShutdownChange(!shutdown)}
        >
          {t("footer.shutdown")}
        </span>
      </div>
    </footer>
  );
}

export type Settings = {
  theme?: "light" | "dark";
  lang: LangSetting; // 界面语言：system 跟随系统 | zh-CN 简体中文 | en 英文
  dlWorkers: number;
  compressWorkers: number;
  dlDir: string; // 下载目录；空 = 引擎默认（安装目录\downloaded）
  outSame: boolean; // 压缩输出与原文件同目录
  outDir: string; // 指定输出目录（outSame=false 时生效）
  overwrite: boolean; // 压缩后覆盖原文件（仅 outSame 可开）
  cover: boolean; // 封面开关
  coverSec: number; // 封面第 N 秒末帧（0 = 首帧）
  closeToTray: boolean; // 关闭窗口时最小化到系统托盘（默认 true）
};

const DEFAULTS: Settings = {
  theme: "light",
  lang: "system",
  dlWorkers: 3,
  compressWorkers: 3,
  dlDir: "",
  outSame: true,
  outDir: "",
  overwrite: false,
  cover: false,
  coverSec: 5,
  closeToTray: true,
};

const LS_KEY = "eazyvid.settings.v1";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* 损坏/无权限时用默认 */
  }
  return DEFAULTS;
}

function App() {
  const [panel, setPanel] = useState<Panel>("download");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);

  /* 设置持久化：任何变更写 localStorage */
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(settings));
    } catch {
      /* 无权限时忽略（运行期仍生效） */
    }
  }, [settings]);

  /* 暗色主题同步到 <html> 根节点 */
  useEffect(() => {
    if (settings.theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [settings.theme]);

  // 面板活动状态（面板组件上报）：有运行任务=绿闪、有失败=黄，与选中状态无关
  const [dlAct, setDlAct] = useState({ busy: false, fail: false, running: 0, queued: 0 });
  const [cmpAct, setCmpAct] = useState({ busy: false, fail: false, running: 0, queued: 0 });
  const [cmpGain, setCmpGain] = useState(0);
  const [dlDoneCount, setDlDoneCount] = useState(0);
  const [quitWarn, setQuitWarn] = useState(false);
  const dotOf = (act: { busy: boolean; fail: boolean }, selected: boolean) =>
    act.fail ? "fail" : act.busy ? "busy" : selected ? "active" : "idle";
  const dlDot = dotOf(dlAct, panel === "download");
  const cmpDot = dotOf(cmpAct, panel === "compress");

  /* 进行中任务总数：用 ref 让 quit-request 回调始终读最新值（避免因 effect 重跑残留旧监听） */
  const runningRef = useRef(0);
  runningRef.current = dlAct.running + cmpAct.running;

  /* 压缩面板句柄：下载完成（选了压缩模式）→ 自动加入压缩队列队尾；
     若压缩面板已点过"开始压缩"且有空闲线程 → 立即自动开始压缩 */
  const cmpRef = useRef<CompressPanelHandle>(null);

  /* 托盘"退出"：先检查进行中任务 → 有则弹确认（未完成任务文件将被删除），无则直接退出。
     监听只注册一次（空依赖），回调读 runningRef 最新值——防止旧闭包误判为 0 直接退出。 */
  useEffect(() => {
    let un: (() => void) | undefined;
    let cancelled = false;
    listen<null>("app:quit-request", () => {
      if (runningRef.current > 0) setQuitWarn(true);
      else void invoke("quit_confirmed");
    }).then((f) => {
      if (cancelled) f();
      else un = f;
    });
    return () => {
      cancelled = true;
      un?.();
    };
  }, []);

  const confirmQuit = () => {
    setQuitWarn(false);
    void invoke("quit_confirmed");
  };

  /* 同步“关闭时最小化到托盘”给 Rust 后端 */
  useEffect(() => {
    void invoke("set_close_to_tray", { closeToTray: settings.closeToTray ?? true }).catch(() => {});
  }, [settings.closeToTray]);

  /* 窗口右上角关闭按钮 */
  const handleClose = () => {
    if (settings.closeToTray ?? true) {
      void invoke("hide_window").catch(() => {});
    } else {
      if (runningRef.current > 0) {
        setQuitWarn(true);
      } else {
        void invoke("quit_confirmed");
      }
    }
  };

  /* 全局事件捕获探针：定位任何点击被谁拦截、命中什么元素 */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest("button");
      const tag = target?.tagName || "";
      const cls = (target?.className || "").toString().slice(0, 35);
      diag(`CAPTURE_POINTERDOWN tag=${tag} cls=${cls} btn=${Boolean(btn)} x=${Math.round(e.clientX)} y=${Math.round(e.clientY)}`);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest("button");
      const tag = target?.tagName || "";
      diag(`CAPTURE_CLICK tag=${tag} btn=${Boolean(btn)} x=${Math.round(e.clientX)} y=${Math.round(e.clientY)}`);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  /* 全局右键限制：在非文本框和非任务行的地方禁用鼠标右键（屏蔽 WebView2 默认右键菜单） */
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // 允许输入框/文本域：input, textarea, 可编辑内容
      if (target.closest("input, textarea, [contenteditable='true']")) return;
      // 允许任务行：带 data-task-row 属性的下载与压缩行（触发组件自带的自定义 ContextMenu）
      if (target.closest("[data-task-row]")) return;
      // 允许已弹出的右键菜单容器自身
      if (target.closest("[data-ctx-menu]")) return;
      // 其余所有区域一律阻止浏览器原生右键菜单
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  /* 系统与组件更新检查状态 */
  const { ready: engReady, call: engCall, on: engOn } = useEngine();
  type UpdateItem = {
    id: string;
    name: string;
    role: string;
    current: string;
    latest: string;
    newer: boolean;
    nightly?: boolean;
    url?: string;
    is_app?: boolean;
  };
  const [updateItems, setUpdateItems] = useState<UpdateItem[]>([]);
  const [hasAnyUpdate, setHasAnyUpdate] = useState(false);
  const [updaterOpen, setUpdaterOpen] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingComp, setUpdatingComp] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const autoCheckedRef = useRef(false);

  /* 执行更新检查（可在启动时静默跑，也可在设置中点击手动跑） */
  const doCheckUpdates = useCallback(
    async (manual = false) => {
      if (!engReady) return;
      if (manual) setCheckingUpdates(true);
      try {
        const res = (await engCall("check_updates", { app_version: "0.1.0" })) as {
          ok?: boolean;
          has_update?: boolean;
          items?: UpdateItem[];
        };
        if (res?.ok && Array.isArray(res.items)) {
          setUpdateItems(res.items);
          setHasAnyUpdate(Boolean(res.has_update));
          if (manual || res.has_update) {
            setAboutOpen(false);
            setUpdaterOpen(true);
          }
        }
      } catch {
        /* 静默处理 */
      } finally {
        if (manual) setCheckingUpdates(false);
      }
    },
    [engReady, engCall],
  );

  /* 每次打开程序：就先做检查更新（静默发起一次） */
  useEffect(() => {
    if (!engReady || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void doCheckUpdates(false);
  }, [engReady, doCheckUpdates]);

  /* 真实任务完成跟踪：分别跟踪下载与压缩队列是否有真实任务自然完成（done）。
     用户手动清空/删除未完成任务不视为"任务完成" */
  const hasCompletedDlRef = useRef(false);
  const hasCompletedCmpRef = useRef(false);

  /* 监听核心引擎事件 */
  useEffect(() => {
    return engOn((ev) => {
      if ((ev as { state?: string }).state === "done") {
        if (ev.ev === "dl") hasCompletedDlRef.current = true;
        if (ev.ev === "cmp") hasCompletedCmpRef.current = true;
      }
    });
  }, [engOn]);

  const currLang = resolveLang(settings.lang);
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(currLang, key, params);

  /* 系统托盘菜单文字跟随界面语言动态更新 */
  useEffect(() => {
    void invoke("update_tray_lang", {
      showText: translate(currLang, "tray.show"),
      quitText: translate(currLang, "tray.quit"),
    });
  }, [currLang]);

  /* 一键更新组件（支持更新 yt-dlp 和 ffmpeg/ffprobe） */
  const doUpdateComponent = async (comp: "ytdlp" | "ffmpeg") => {
    setUpdatingComp(comp);
    try {
      const res = (await engCall("update_component", { component: comp })) as { ok?: boolean; error?: string };
      if (res?.ok) {
        // 更新完成后重新拉取一次版本状态
        await doCheckUpdates(false);
      } else {
        alert(t("updater.fail", { err: res?.error || "未知错误" }));
      }
    } catch (e) {
      alert(t("updater.fail", { err: String(e instanceof Error ? e.message : e) }));
    } finally {
      setUpdatingComp(null);
    }
  };

  /* 全局自动关机：下载与压缩所有任务全部结束后自动关机（倒计时 60 秒可取消） */
  const [shutdown, setShutdown] = useState(false);
  const [shutdownPending, setShutdownPending] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(60);
  const hadTasksRef = useRef(false);

  const totalActive = dlAct.running + dlAct.queued + cmpAct.running + cmpAct.queued;

  useEffect(() => {
    if (totalActive > 0) {
      hadTasksRef.current = true;
    }
  }, [totalActive]);

  const cancelShutdown = useCallback(() => {
    setShutdownPending(false);
    setShutdown(false);
    setShutdownCountdown(60);
    void engCall("cancel_shutdown");
  }, [engCall]);

  useEffect(() => {
    if (!shutdown || !hadTasksRef.current || totalActive > 0 || shutdownPending) {
      return;
    }
    // 只有在队列中确实有任务真实完成（而非用户手动清除/删除任务）时才触发关机
    if (!hasCompletedDlRef.current && !hasCompletedCmpRef.current) {
      hadTasksRef.current = false;
      return;
    }
    // 防抖 1.5 秒：给任务转换/完成事件留足缓冲，确认确实无任何进行中或排队任务
    const timer = setTimeout(() => {
      const hasAnyDone = hasCompletedDlRef.current || hasCompletedCmpRef.current;
      if (hadTasksRef.current && totalActive === 0 && hasAnyDone && !shutdownPending) {
        hadTasksRef.current = false;
        hasCompletedDlRef.current = false;
        hasCompletedCmpRef.current = false;
        setShutdownCountdown(60);
        setShutdownPending(true);
        void engCall("system_shutdown", { delay: 60 });
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [shutdown, totalActive, shutdownPending, engCall]);

  useEffect(() => {
    if (!shutdownPending) return;
    const timer = setInterval(() => {
      setShutdownCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [shutdownPending]);

  /* 任务完成提示（未开启自动关机时，在应用右下角浮动 Toast + 触发系统通知） */
  const [completeToast, setCompleteToast] = useState<{
    open: boolean;
    type: "dl" | "cmp";
    title: string;
    body: string;
  } | null>(null);

  const dlActive = dlAct.running + dlAct.queued;
  const cmpActive = cmpAct.running + cmpAct.queued;
  const hadDlRef = useRef(false);
  const hadCmpRef = useRef(false);

  useEffect(() => {
    if (dlActive > 0) hadDlRef.current = true;
  }, [dlActive]);

  useEffect(() => {
    if (cmpActive > 0) hadCmpRef.current = true;
  }, [cmpActive]);

  // 下载队列独立完成检测
  useEffect(() => {
    if (shutdown || !hadDlRef.current || dlActive > 0) return;
    if (!hasCompletedDlRef.current) {
      hadDlRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (hadDlRef.current && dlActive === 0 && hasCompletedDlRef.current && !shutdown) {
        hadDlRef.current = false;
        hasCompletedDlRef.current = false;
        const title = t("toast.dlTitle");
        const body = t("toast.dlBody");
        setCompleteToast({ open: true, type: "dl", title, body });
        try {
          if (typeof window !== "undefined" && "Notification" in window) {
            if (Notification.permission === "granted") {
              new Notification(title, { body });
            } else if (Notification.permission !== "denied") {
              void Notification.requestPermission().then((p) => {
                if (p === "granted") new Notification(title, { body });
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [shutdown, dlActive, t]);

  // 压缩队列独立完成检测
  useEffect(() => {
    if (shutdown || !hadCmpRef.current || cmpActive > 0) return;
    if (!hasCompletedCmpRef.current) {
      hadCmpRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (hadCmpRef.current && cmpActive === 0 && hasCompletedCmpRef.current && !shutdown) {
        hadCmpRef.current = false;
        hasCompletedCmpRef.current = false;
        const gainStr = (cmpGain / 1024 ** 3).toFixed(2);
        const title = t("toast.cmpTitle");
        const body = t("toast.cmpBody", { gain: gainStr });
        setCompleteToast({ open: true, type: "cmp", title, body });
        try {
          if (typeof window !== "undefined" && "Notification" in window) {
            if (Notification.permission === "granted") {
              new Notification(title, { body });
            } else if (Notification.permission !== "denied") {
              void Notification.requestPermission().then((p) => {
                if (p === "granted") new Notification(title, { body });
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [shutdown, cmpActive, cmpGain, t]);

  return (
    <I18nProvider setting={settings.lang}>
      <TipProvider>
      {/* 外层：内容区不参与窗口拖拽（data-tauri-drag-region 会拦截图标按钮点击）；
          拖拽仅限顶部自绘标题栏区与侧栏空白 */}
      <div className="flex flex-col h-full w-full bg-surface">
        {/* 自绘顶部无边框深色标题栏（48px）：
            - 保持 decorations: false 无原生标题栏无边框设计；
            - 背景采用品牌深藏青蓝（#14185e），完美衬托白色底盘的 Logo；
            - 左侧：Logo + eazyVid 纯白品牌标；
            - 中间：深色胶囊分段导航（Segmented Control）切换下载与压缩面板，带运行状态圆点与任务数徽标；
            - 空白区域带 data-tauri-drag-region 允许抓取拖拽窗口与双击最大化；
            - 右侧：设置按钮，预留 138px 给右上角固定的 WindowControls。 */}
        <header className="h-12 shrink-0 border-b border-black/30 bg-[#14185e] flex items-center px-4 select-none relative z-40">
          {/* 左侧：Logo 与标题（深色背景下白底 Logo 清晰凸显） */}
          <div className="flex items-center gap-2.5 shrink-0" data-tauri-drag-region>
            <div className="pointer-events-none flex items-center gap-2.5">
              <Logo size={26} />
              <div className="font-brand font-bold text-[15px] tracking-wider leading-none select-none flex items-baseline">
                <span className="text-[#F1F5F9] font-extrabold">eazy</span>
                <span className="text-blue-400 font-extrabold ml-0.5">VID</span>
              </div>
            </div>
          </div>

          {/* 左侧可拖拽留白区 */}
          <div className="flex-1 h-full min-w-4" data-tauri-drag-region />

          {/* 中间：胶囊分段导航 (Segmented Control) */}
          <div className="shrink-0 flex items-center bg-black/25 p-0.5 rounded-xl border border-white/10 shadow-inner">
            <button
              type="button"
              onClick={() => setPanel("download")}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[15px] font-medium transition-all duration-150 cursor-pointer ${
                panel === "download"
                  ? "bg-white text-slate-900 shadow-md font-semibold"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              <StatusDot mode={dlDot} />
              <span>{t("nav.download")}</span>
              {dlAct.running + dlAct.queued > 0 && (
                <span
                  className={`text-[12px] px-2 py-0.5 rounded-full font-semibold tabular-nums ${
                    panel === "download" ? "bg-slate-100 text-slate-700" : "bg-white/15 text-white/90"
                  }`}
                >
                  {dlAct.running + dlAct.queued}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setPanel("compress")}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[15px] font-medium transition-all duration-150 cursor-pointer ${
                panel === "compress"
                  ? "bg-white text-slate-900 shadow-md font-semibold"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              <StatusDot mode={cmpDot} />
              <span>{t("nav.compress")}</span>
              {cmpAct.running + cmpAct.queued > 0 && (
                <span
                  className={`text-[12px] px-2 py-0.5 rounded-full font-semibold tabular-nums ${
                    panel === "compress" ? "bg-slate-100 text-slate-700" : "bg-white/15 text-white/90"
                  }`}
                >
                  {cmpAct.running + cmpAct.queued}
                </span>
              )}
            </button>
          </div>

          {/* 右侧可拖拽留白区 */}
          <div className="flex-1 h-full min-w-4" data-tauri-drag-region />

          {/* 右侧操作区：设置按钮 + 为右上角固定 WindowControls 预留 138px */}
          <div className="shrink-0 flex items-center gap-1 mr-[138px]">
            <IconBtn
              tip={t("nav.settings")}
              onClick={() => setSettingsOpen(true)}
              className="w-8.5 h-8.5 rounded-lg text-white/75 hover:text-white hover:bg-white/10"
            >
              <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z" size={16} />
            </IconBtn>
          </div>
        </header>
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* 两面板常驻挂载，display 切换——任务列表 state 不因切换面板丢失 */}
          <div className="flex-1 min-h-0 relative flex flex-col">
            <div className={panel === "download" ? "h-full w-full flex flex-col" : "hidden"}>
              <DownloadPanel
                dlWorkers={settings.dlWorkers}
                dlDir={settings.dlDir}
                onActivityChange={(b, f, running, queued) => setDlAct({ busy: b, fail: f, running, queued })}
                onDoneCountChange={setDlDoneCount}
                onCompress={(path, name, mode) => cmpRef.current?.addDownloadedTask(path, name, mode)}
                active={panel === "download"}
              />
            </div>
            <div className={panel === "compress" ? "h-full w-full flex flex-col" : "hidden"}>
              <CompressPanel
                ref={cmpRef}
                compressWorkers={settings.compressWorkers}
                outSame={settings.outSame}
                outDir={settings.outDir}
                overwrite={settings.overwrite}
                cover={settings.cover}
                coverSec={settings.coverSec}
                onActivityChange={(b, f, running, queued) => setCmpAct({ busy: b, fail: f, running, queued })}
                onGainChange={setCmpGain}
                active={panel === "compress"}
              />
            </div>
          </div>
          {/* 底部持久栏（无论切换到哪个面板，右下角永远固定存在）：左侧根据当前面板展示状态/收益，右侧固定为关机开关 */}
          <GlobalFooter
            panel={panel}
            cmpGain={cmpGain}
            dlDoneCount={dlDoneCount}
            shutdown={shutdown}
            onShutdownChange={(v) => {
              setShutdown(v);
              if (!v && shutdownPending) cancelShutdown();
            }}
            theme={settings.theme || "light"}
            onToggleTheme={() =>
              setSettings((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" }))
            }
          />
        </main>
      </div>
      <WindowControls onClose={handleClose} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
        onOpenAbout={() => setAboutOpen(true)}
      />

      {/* 软件与组件更新弹窗 */}
      <Dialog
        open={updaterOpen}
        onClose={() => !updatingComp && setUpdaterOpen(false)}
        title={t("updater.title")}
        width={560}
      >
        <div className="flex flex-col gap-4 text-text-main">
          {/* 状态总览提示 */}
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60">
            {hasAnyUpdate ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-amber-500">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-emerald-500">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            <span className="text-[13.5px] font-medium leading-relaxed">
              {hasAnyUpdate ? t("updater.hasUpdate") : t("updater.upToDate")}
            </span>
          </div>

          {/* 各组件列表卡片 */}
          <div className="space-y-2.5">
            {updateItems.map((item) => (
              <div
                key={item.id}
                className="p-3.5 rounded-xl border border-border-soft bg-card hover:border-slate-300 dark:hover:border-slate-600 transition-colors flex items-center justify-between gap-3 shadow-2xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[14px] text-text-main">{item.name}</span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${
                        item.newer
                          ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {item.newer ? t("updater.updateAvailable") : t("updater.stableTag")}
                    </span>
                  </div>
                  <p className="text-[12px] text-text-sub mt-0.5">{item.role}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[12px] tabular-nums">
                    <span className="text-slate-500 dark:text-slate-400">
                      {t("updater.current", { ver: item.current || "未知" })}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span className={item.newer ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-slate-600 dark:text-slate-300"}>
                      {t("updater.latest", { ver: item.latest || "未知" })}
                    </span>
                  </div>
                </div>

                <div className="shrink-0">
                  {item.is_app ? (
                    item.newer && item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[12.5px] font-medium transition-colors shadow-2xs cursor-pointer"
                      >
                        <span>{t("updater.viewRelease")}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    ) : null
                  ) : item.newer ? (
                    <Button
                      size="sm"
                      disabled={updatingComp !== null}
                      onClick={() => void doUpdateComponent(item.id as "ytdlp" | "ffmpeg")}
                    >
                      {updatingComp === item.id ? t("updater.updating") : t("updater.updateNow")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              disabled={updatingComp !== null}
              onClick={() => setUpdaterOpen(false)}
            >
              {t("updater.close")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* 关于 eazyVid 弹窗 */}
      <Dialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        title={t("about.title")}
        width={460}
      >
        <div className="flex flex-col items-center text-center py-2 text-text-main">
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 shadow-xs mb-3">
            <Logo size={56} />
          </div>
          <h3 className="text-[17px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>eazyVid</span>
            <span className="text-[12px] font-mono font-semibold px-2 py-0.5 rounded-md bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-300 border border-brand-200 dark:border-brand-800/60">
              v0.1.0
            </span>
            <a
              href="https://github.com/Ray1979ANYWAY/eazyVid/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
              title="Apache License 2.0"
              className="text-[11.5px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            >
              Apache-2.0
            </a>
          </h3>
          <p className="mt-2 text-[13.5px] text-text-sub max-w-[340px] leading-relaxed">
            {t("about.desc")}
          </p>

          {/* 软件与组件更新 */}
          <div className="w-full mt-5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between gap-3 text-left">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-text-main flex items-center gap-1.5">
                <span>{t("settings.updateCheck")}</span>
                {hasAnyUpdate && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60">
                    {t("updater.updateAvailable")}
                  </span>
                )}
              </div>
              <div className="text-[11.5px] text-text-sub mt-0.5 leading-snug break-words">
                {t("settings.updateCheckHint")}
              </div>
            </div>
            <Button
              size="sm"
              variant={hasAnyUpdate ? "primary" : "outline"}
              disabled={checkingUpdates}
              onClick={() => void doCheckUpdates(true)}
              className="shrink-0"
            >
              {checkingUpdates ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg className="animate-spin h-3.5 w-3.5 text-current" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span>{t("settings.checking")}</span>
                </span>
              ) : (
                t("settings.updateCheckBtn")
              )}
            </Button>
          </div>

          <div className="w-full mt-5 pt-4 border-t border-border-soft flex items-center justify-between">
            <a
              href="https://ko-fi.com/rayhu"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#13C3FF]/10 hover:bg-[#13C3FF]/18 text-[#0092CA] hover:text-[#007EA7] border border-[#13C3FF]/30 text-[12.5px] font-semibold transition-all cursor-pointer group"
            >
              <svg width="18" height="15" viewBox="0 0 241 194" fill="none" className="shrink-0 transition-transform group-hover:scale-110">
                <path d="M15.1975 67.7674C15.1975 37.5285 33.3866 21.164 54.7559 18.4334C70.8987 16.387 90.906 16.1589 114.544 16.1589C151.372 16.1589 160.919 16.6151 174.559 17.9772C206.617 21.1576 225.255 40.937 225.255 69.3577V72.9941C225.255 99.3687 205.932 120.966 179.786 123.234C177.74 130.058 174.559 136.874 170.238 143.698C160.235 159.156 140.228 178.707 103.4 178.707H96.1264C66.1155 178.707 42.9277 165.751 29.0595 142.107C16.7814 121.422 15.1912 98.4563 15.1912 67.7674" fill="#202020"/>
                <path d="M32.2469 67.9899C32.2469 97.3168 34.0654 116.184 43.6127 133.689C54.5225 153.924 74.3018 161.653 96.8117 161.653H103.857C133.411 161.653 147.736 147.329 155.693 134.829C159.558 128.462 162.966 121.417 164.784 112.547L166.147 106.864H174.332C192.521 106.864 208.208 92.09 208.208 73.2166V69.8082C208.208 48.6669 195.024 37.5228 172.058 34.7987C159.102 33.6646 151.372 33.2084 114.538 33.2084C89.7602 33.2084 72.0272 33.4364 58.6152 35.4828C39.7483 38.2134 32.2407 48.8951 32.2407 67.9899" fill="#FFFFFF"/>
                <path d="M166.158 83.6801C166.158 86.4107 168.204 88.4572 171.841 88.4572C183.435 88.4572 189.802 81.8619 189.802 70.9523C189.802 60.0427 183.435 53.2195 171.841 53.2195C168.204 53.2195 166.158 55.2657 166.158 57.9963V83.6866V83.6801Z" fill="#202020"/>
                <path d="M54.5321 82.3198C54.5321 95.732 62.0332 107.326 71.5807 116.424C77.9478 122.562 87.9515 128.93 94.7685 133.022C96.8147 134.157 98.8611 134.841 101.136 134.841C103.866 134.841 106.134 134.157 107.959 133.022C114.782 128.93 124.779 122.562 130.919 116.424C140.694 107.332 148.195 95.7383 148.195 82.3198C148.195 67.7673 137.286 54.8115 121.599 54.8115C112.28 54.8115 105.912 59.5882 101.136 66.1772C96.8147 59.582 90.2259 54.8115 80.9001 54.8115C64.9855 54.8115 54.5256 67.7673 54.5256 82.3198" fill="#FF5E5B"/>
              </svg>
              <span>{t("about.sponsor")}</span>
            </a>

            <a
              href="https://github.com/Ray1979ANYWAY/eazyVid"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-black dark:hover:bg-slate-700 text-white text-[12.5px] font-medium transition-all shadow-2xs cursor-pointer"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              <span>GitHub</span>
            </a>
          </div>
        </div>
      </Dialog>

      {/* 托盘"退出"且任务进行中：警告弹窗（未完成任务的文件将被删除，源文件保留） */}
      <Dialog open={quitWarn} onClose={() => setQuitWarn(false)} title={t("quit.title")} width={500}>
        <div className="text-[15px] leading-relaxed text-text-main">
          <p>
            {t("quit.desc", {
              total: dlAct.running + cmpAct.running,
              dl: dlAct.running,
              cmp: cmpAct.running,
            })}
          </p>
          <p className="mt-2 text-text-sub text-[13px]">{t("quit.hint")}</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setQuitWarn(false)}>
            {t("quit.cancel")}
          </Button>
          <Button variant="danger" onClick={confirmQuit}>
            {t("quit.confirm")}
          </Button>
        </div>
      </Dialog>

      {/* 所有任务完成自动关机倒计时弹窗（60秒内可取消） */}
      <Dialog open={shutdownPending} onClose={cancelShutdown} title={t("shutdown.title")} width={460}>
        <div className="text-[15px] leading-relaxed text-text-main">
          <p>
            {t("shutdown.desc", { sec: shutdownCountdown })}
          </p>
          <p className="mt-2 text-text-sub text-[13px]">{t("shutdown.hint")}</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="danger" onClick={cancelShutdown}>
            {t("shutdown.cancel")}
          </Button>
        </div>
      </Dialog>
      {/* 队列任务完成应用内浮动 Toast（未开自动关机时优雅呈现） */}
      {completeToast?.open && (
        <div className="fixed bottom-16 right-5 z-50 w-80 bg-card/95 backdrop-blur-md border border-border-soft dark:border-slate-700/80 rounded-2xl shadow-xl p-3.5 flex items-start gap-3 transition-all animate-in fade-in slide-in-from-bottom-2">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
            completeToast.type === "cmp" ? "bg-amber-500/15 text-amber-600" : "bg-[#14185e] text-blue-400"
          }`}>
            {completeToast.type === "cmp" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
                <path d="M12 9 L24 20 L12 31 Z" fill="#60A5FA" />
                <path d="M22 14 L28 20 L22 26" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-text-main">
              {completeToast.title}
            </div>
            <p className="mt-1 text-[12px] text-text-sub leading-snug">
              {completeToast.body}
            </p>
            <div className="mt-2.5 flex justify-end">
              <Button size="sm" onClick={() => setCompleteToast(null)}>
                {t("toast.dismiss")}
              </Button>
            </div>
          </div>
          <button
            onClick={() => setCompleteToast(null)}
            className="text-text-sub hover:text-text-main text-[13px] p-0.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
      </TipProvider>
    </I18nProvider>
  );
}

export default App;

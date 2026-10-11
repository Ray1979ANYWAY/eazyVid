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
}: {
  panel: Panel;
  cmpGain: number;
  dlDoneCount: number;
  shutdown: boolean;
  onShutdownChange: (v: boolean) => void;
}) {
  const show = useTip();
  const { t } = useI18n();
  return (
    <footer className="shrink-0 h-12 px-4 border-t border-border-soft bg-white/70 flex items-center gap-4">
      {panel === "compress" ? (
        <div className="text-[14px] text-text-main tabular-nums">
          {t("footer.gain", { gain: (cmpGain / 1024 ** 3).toFixed(2) })}
        </div>
      ) : dlDoneCount > 0 ? (
        <div className="text-[14px] text-text-main tabular-nums">
          {t("footer.dlCount", { count: dlDoneCount })}
        </div>
      ) : (
        <div className="text-[14px] text-text-sub tabular-nums" />
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
  lang: LangSetting; // 界面语言：system 跟随系统 | zh-CN 简体中文 | en 英文
  dlWorkers: number;
  compressWorkers: number;
  dlDir: string; // 下载目录；空 = 引擎默认（安装目录\downloaded）
  outSame: boolean; // 压缩输出与原文件同目录
  outDir: string; // 指定输出目录（outSame=false 时生效）
  overwrite: boolean; // 压缩后覆盖原文件（仅 outSame 可开）
  cover: boolean; // 封面开关
  coverSec: number; // 封面第 N 秒末帧（0 = 首帧）
};

const DEFAULTS: Settings = {
  lang: "system",
  dlWorkers: 3,
  compressWorkers: 3,
  dlDir: "",
  outSame: true,
  outDir: "",
  overwrite: false,
  cover: false,
  coverSec: 5,
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

  /* 每次启动检查 ffmpeg 是否有新的稳定版（引擎就绪后仅检查一次，防高频重跑堵塞 RPC） */
  const { ready: engReady, call: engCall, on: engOn } = useEngine();
  const [ffmpegUpd, setFfmpegUpd] = useState<{ current: string; latest: string; nightly: boolean } | null>(null);
  const [ffmpegBusy, setFfmpegBusy] = useState(false);      // 更新中
  const [ffmpegPct, setFfmpegPct] = useState(0);            // 下载进度
  const [ffmpegConfirm, setFfmpegConfirm] = useState(false); // 确认弹窗
  const [ffmpegMsg, setFfmpegMsg] = useState<string | null>(null); // 完成/失败提示
  const ffmpegCheckedRef = useRef(false);
  useEffect(() => {
    if (!engReady || ffmpegCheckedRef.current) return;
    ffmpegCheckedRef.current = true;
    let cancelled = false;
    engCall("ffmpeg_check")
      .then((r) => {
        const rr = r as { ok?: boolean; current?: string; latest?: string; newer?: boolean; nightly?: boolean };
        if (!cancelled && rr?.newer && rr.current && rr.latest) {
          setFfmpegUpd({ current: rr.current, latest: rr.latest, nightly: !!rr.nightly });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [engReady, engCall]);

  /* 真实任务完成跟踪：分别跟踪下载与压缩队列是否有真实任务自然完成（done）。
     用户手动清空/删除未完成任务不视为"任务完成" */
  const hasCompletedDlRef = useRef(false);
  const hasCompletedCmpRef = useRef(false);

  /* 更新进度与任务完成事件（只注册一次） */
  useEffect(() => {
    return engOn((ev) => {
      if (ev.ev === "ffmpeg_progress") {
        const p = (ev as { percent?: number }).percent;
        if (typeof p === "number") setFfmpegPct(p);
      }
      if ((ev as { state?: string }).state === "done") {
        if (ev.ev === "dl") hasCompletedDlRef.current = true;
        if (ev.ev === "cmp") hasCompletedCmpRef.current = true;
      }
    });
  }, [engOn]);

  const currLang = resolveLang(settings.lang);
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(currLang, key, params);

  /* 一键更新：下载稳定版 → 自动替换（引擎内备份旧版，失败回滚） */
  const doUpdate = async () => {
    setFfmpegConfirm(false);
    setFfmpegBusy(true);
    setFfmpegPct(0);
    try {
      const r = (await engCall("ffmpeg_update")) as { ok?: boolean; version?: string; error?: string };
      if (r?.ok) {
        setFfmpegMsg(r.version ? t("ffmpeg.success", { version: r.version }) : t("ffmpeg.successDefault"));
        setFfmpegUpd(null);
      } else {
        setFfmpegMsg(r?.error || t("ffmpeg.fail"));
      }
    } catch (e) {
      setFfmpegMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setFfmpegBusy(false);
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
          {/* ffmpeg 新版提示（启动检查一次；可关闭） */}
          {ffmpegUpd && (
            <div className="shrink-0 mx-4 mt-3 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[13.5px] text-amber-900">
              <svg width="15" height="15" viewBox="0 0 24 24" className="shrink-0" style={{ color: "#B45309" }}>
                <path d="M12 9v5m0 3.5v.5M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="flex-1 min-w-0">
                {ffmpegUpd.nightly
                  ? t("ffmpeg.nightlyTip", { current: ffmpegUpd.current, latest: ffmpegUpd.latest })
                  : t("ffmpeg.newerTip", { current: ffmpegUpd.current, latest: ffmpegUpd.latest })}
              </span>
              <div className="shrink-0 flex items-center gap-2">
                {ffmpegBusy ? (
                  <span className="text-amber-800 text-[13px] tabular-nums">
                    {ffmpegPct < 100 ? t("ffmpeg.downloading", { pct: ffmpegPct }) : t("ffmpeg.extracting")}
                  </span>
                ) : (
                  <button
                    onClick={() => setFfmpegConfirm(true)}
                    className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-white text-[13px] hover:bg-amber-700 cursor-pointer"
                  >
                    {t("ffmpeg.updateBtn")}
                  </button>
                )}
                <button
                  onClick={() => setFfmpegUpd(null)}
                  disabled={ffmpegBusy}
                  className="shrink-0 text-amber-700 hover:text-amber-900 cursor-pointer text-[13px] disabled:opacity-50"
                >
                  {t("ffmpeg.dismiss")}
                </button>
              </div>
            </div>
          )}
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
          />
        </main>
      </div>
      <WindowControls />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
      />
      {/* ffmpeg 一键更新确认 */}
      <Dialog open={ffmpegConfirm} onClose={() => setFfmpegConfirm(false)} title={t("ffmpeg.dlgTitle")} width={480}>
        <div className="text-[15px] leading-relaxed text-text-main">
          <p>{t("ffmpeg.dlgDesc")}</p>
          <p className="mt-2 text-text-sub text-[13px]">{t("ffmpeg.dlgHint")}</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setFfmpegConfirm(false)}>
            {t("ffmpeg.cancel")}
          </Button>
          <Button onClick={() => void doUpdate()}>{t("ffmpeg.startUpdate")}</Button>
        </div>
      </Dialog>

      {/* ffmpeg 更新完成/失败提示 */}
      <Dialog open={!!ffmpegMsg} onClose={() => setFfmpegMsg(null)} title={t("ffmpeg.resultTitle")} width={440}>
        <div className="text-[15px] text-text-main">{ffmpegMsg}</div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => setFfmpegMsg(null)}>{t("ffmpeg.ok")}</Button>
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
        <div className="fixed bottom-16 right-5 z-50 w-80 bg-white/95 backdrop-blur-md border border-border-soft rounded-2xl shadow-xl p-3.5 flex items-start gap-3 transition-all animate-in fade-in slide-in-from-bottom-2">
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

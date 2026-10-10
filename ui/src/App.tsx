import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar, type Panel } from "./components/Sidebar";
import { DownloadPanel } from "./components/DownloadPanel";
import { CompressPanel } from "./components/CompressPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { WindowControls } from "./components/WindowControls";
import { TipProvider, Dialog, Button } from "./components/ui";
import { useEngine } from "./hooks/useEngine";

export type Settings = {
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
  const [dlAct, setDlAct] = useState({ busy: false, fail: false, running: 0 });
  const [cmpAct, setCmpAct] = useState({ busy: false, fail: false, running: 0 });
  const [quitWarn, setQuitWarn] = useState(false);
  const dotOf = (act: { busy: boolean; fail: boolean }, selected: boolean) =>
    act.fail ? "fail" : act.busy ? "busy" : selected ? "active" : "idle";
  const dlDot = dotOf(dlAct, panel === "download");
  const cmpDot = dotOf(cmpAct, panel === "compress");

  /* 进行中任务总数：用 ref 让 quit-request 回调始终读最新值（避免因 effect 重跑残留旧监听） */
  const runningRef = useRef(0);
  runningRef.current = dlAct.running + cmpAct.running;

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

  /* 每次启动检查 ffmpeg 是否有新的稳定版（引擎就绪后一次） */
  const { ready: engReady, call: engCall, on: engOn } = useEngine();
  const [ffmpegUpd, setFfmpegUpd] = useState<{ current: string; latest: string; nightly: boolean } | null>(null);
  const [ffmpegBusy, setFfmpegBusy] = useState(false);      // 更新中
  const [ffmpegPct, setFfmpegPct] = useState(0);            // 下载进度
  const [ffmpegConfirm, setFfmpegConfirm] = useState(false); // 确认弹窗
  const [ffmpegMsg, setFfmpegMsg] = useState<string | null>(null); // 完成/失败提示
  useEffect(() => {
    if (!engReady) return;
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

  /* 更新进度事件（只注册一次） */
  useEffect(() => {
    return engOn((ev) => {
      if (ev.ev === "ffmpeg_progress") {
        const p = (ev as { percent?: number }).percent;
        if (typeof p === "number") setFfmpegPct(p);
      }
    });
  }, [engOn]);

  /* 一键更新：下载稳定版 → 自动替换（引擎内备份旧版，失败回滚） */
  const doUpdate = async () => {
    setFfmpegConfirm(false);
    setFfmpegBusy(true);
    setFfmpegPct(0);
    try {
      const r = (await engCall("ffmpeg_update")) as { ok?: boolean; version?: string; error?: string };
      if (r?.ok) {
        setFfmpegMsg(r.version ? `已自动更新到 ffmpeg ${r.version}` : "已自动更新到最新稳定版");
        setFfmpegUpd(null);
      } else {
        setFfmpegMsg(r?.error || "更新失败，请重试");
      }
    } catch (e) {
      setFfmpegMsg(String(e instanceof Error ? e.message : e));
    } finally {
      setFfmpegBusy(false);
    }
  };

  return (
    <TipProvider>
      {/* 外层：全窗口可拖拽；顶部 44px 为自绘标题栏区（右上角为窗口控制按钮） */}
      <div className="flex h-full w-full" data-tauri-drag-region>
        <Sidebar
          panel={panel}
          onPanel={setPanel}
          dlDot={dlDot}
          cmpDot={cmpDot}
          onSettings={() => setSettingsOpen(true)}
        />
        <main className="flex-1 min-w-0 min-h-0 pt-11 flex flex-col" data-tauri-drag-region>
          {/* ffmpeg 新版提示（启动检查一次；可关闭） */}
          {ffmpegUpd && (
            <div className="shrink-0 mx-4 mt-3 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <svg width="14" height="14" viewBox="0 0 24 24" className="shrink-0" style={{ color: "#B45309" }}>
                <path d="M12 9v5m0 3.5v.5M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="flex-1 min-w-0">
                {ffmpegUpd.nightly ? (
                  <>
                    当前 ffmpeg 是非稳定版（<b>{ffmpegUpd.current}</b>），最新稳定版为 <b>{ffmpegUpd.latest}</b>
                    ，建议更换以获得更好的稳定性与压缩性能
                  </>
                ) : (
                  <>
                    发现 ffmpeg 新版本 <b>{ffmpegUpd.latest}</b>（当前 {ffmpegUpd.current}），更新可提升压缩性能与格式兼容性
                  </>
                )}
              </span>
              <div className="shrink-0 flex items-center gap-2">
                {ffmpegBusy ? (
                  <span className="text-amber-800 text-[12px] tabular-nums">
                    {ffmpegPct < 100 ? `下载中 ${ffmpegPct}%` : "解压替换中…"}
                  </span>
                ) : (
                  <button
                    onClick={() => setFfmpegConfirm(true)}
                    className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-white text-[12px] hover:bg-amber-700 cursor-pointer"
                  >
                    一键更新
                  </button>
                )}
                <button
                  onClick={() => setFfmpegUpd(null)}
                  disabled={ffmpegBusy}
                  className="shrink-0 text-amber-700 hover:text-amber-900 cursor-pointer disabled:opacity-50"
                >
                  知道了
                </button>
              </div>
            </div>
          )}
          {/* 两面板常驻挂载，display 切换——任务列表 state 不因切换面板丢失 */}
          <div className={panel === "download" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
            <DownloadPanel
              dlWorkers={settings.dlWorkers}
              dlDir={settings.dlDir}
              onActivityChange={(b, f, running) => setDlAct({ busy: b, fail: f, running })}
            />
          </div>
          <div className={panel === "compress" ? "flex-1 min-h-0 flex flex-col" : "hidden"}>
            <CompressPanel
              compressWorkers={settings.compressWorkers}
              outSame={settings.outSame}
              outDir={settings.outDir}
              overwrite={settings.overwrite}
              cover={settings.cover}
              coverSec={settings.coverSec}
              onActivityChange={(b, f, running) => setCmpAct({ busy: b, fail: f, running })}
            />
          </div>
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
      <Dialog open={ffmpegConfirm} onClose={() => setFfmpegConfirm(false)} title="更新 ffmpeg" width={460}>
        <div className="text-[13px] leading-relaxed text-text-main">
          <p>
            将下载 ffmpeg 最新稳定版（约 160MB）并<b className="text-brand-700">自动替换</b>当前版本，无需手动覆盖。
          </p>
          <p className="mt-2 text-text-sub">
            建议在无压缩任务进行时更新；若替换时文件被占用会提示失败，旧版本自动保留。
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setFfmpegConfirm(false)}>
            取消
          </Button>
          <Button onClick={() => void doUpdate()}>开始更新</Button>
        </div>
      </Dialog>

      {/* ffmpeg 更新完成/失败提示 */}
      <Dialog open={!!ffmpegMsg} onClose={() => setFfmpegMsg(null)} title="ffmpeg 更新" width={420}>
        <div className="text-[13px] text-text-main">{ffmpegMsg}</div>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => setFfmpegMsg(null)}>好</Button>
        </div>
      </Dialog>

      {/* 托盘"退出"且任务进行中：警告弹窗（未完成任务的文件将被删除，源文件保留） */}
      <Dialog open={quitWarn} onClose={() => setQuitWarn(false)} title="任务进行中" width={480}>
        <div className="text-[13px] leading-relaxed text-text-main">
          <p>
            当前有 <span className="font-semibold text-brand-700">{dlAct.running + cmpAct.running}</span>{" "}
            个任务正在进行或暂停（下载 {dlAct.running} 个、压缩 {cmpAct.running} 个）。
          </p>
          <p className="mt-2">
            退出会中断这些任务，未完成任务的文件将被删除：压缩的中间输出、下载的临时缓存都会被清除（源文件保留）。
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setQuitWarn(false)}>
            取消
          </Button>
          <Button variant="danger" onClick={confirmQuit}>
            确定退出
          </Button>
        </div>
      </Dialog>
    </TipProvider>
  );
}

export default App;

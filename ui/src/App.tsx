import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar, type Panel } from "./components/Sidebar";
import { DownloadPanel } from "./components/DownloadPanel";
import { CompressPanel } from "./components/CompressPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { WindowControls } from "./components/WindowControls";
import { TipProvider, Dialog, Button } from "./components/ui";

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
        <main className="flex-1 min-w-0 min-h-0 pt-11" data-tauri-drag-region>
          {/* 两面板常驻挂载，display 切换——任务列表 state 不因切换面板丢失 */}
          <div className={panel === "download" ? "h-full" : "hidden"}>
            <DownloadPanel
              dlWorkers={settings.dlWorkers}
              dlDir={settings.dlDir}
              onActivityChange={(b, f, running) => setDlAct({ busy: b, fail: f, running })}
            />
          </div>
          <div className={panel === "compress" ? "h-full" : "hidden"}>
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

import { useEffect, useState } from "react";
import { Sidebar, type Panel } from "./components/Sidebar";
import { DownloadPanel } from "./components/DownloadPanel";
import { CompressPanel } from "./components/CompressPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { WindowControls } from "./components/WindowControls";
import { TipProvider } from "./components/ui";

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
  const [dlAct, setDlAct] = useState({ busy: false, fail: false });
  const [cmpAct, setCmpAct] = useState({ busy: false, fail: false });
  const dotOf = (act: { busy: boolean; fail: boolean }, selected: boolean) =>
    act.fail ? "fail" : act.busy ? "busy" : selected ? "active" : "idle";
  const dlDot = dotOf(dlAct, panel === "download");
  const cmpDot = dotOf(cmpAct, panel === "compress");

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
        <main className="flex-1 min-w-0 min-h-0 pt-11">
          {/* 两面板常驻挂载，display 切换——任务列表 state 不因切换面板丢失 */}
          <div className={panel === "download" ? "h-full" : "hidden"}>
            <DownloadPanel
              dlWorkers={settings.dlWorkers}
              dlDir={settings.dlDir}
              onActivityChange={(b, f) => setDlAct({ busy: b, fail: f })}
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
              onActivityChange={(b, f) => setCmpAct({ busy: b, fail: f })}
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
    </TipProvider>
  );
}

export default App;

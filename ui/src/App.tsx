import { useState } from "react";
import { Sidebar, type Panel } from "./components/Sidebar";
import { DownloadPanel } from "./components/DownloadPanel";
import { CompressPanel } from "./components/CompressPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { WindowControls } from "./components/WindowControls";
import { TipProvider } from "./components/ui";

export type Settings = {
  dlWorkers: number;
  compressWorkers: number;
};

function App() {
  const [panel, setPanel] = useState<Panel>("download");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({ dlWorkers: 3, compressWorkers: 3 });

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
          {panel === "download" ? (
            <DownloadPanel dlWorkers={settings.dlWorkers} onActivityChange={(b, f) => setDlAct({ busy: b, fail: f })} />
          ) : (
            <CompressPanel compressWorkers={settings.compressWorkers} onActivityChange={(b, f) => setCmpAct({ busy: b, fail: f })} />
          )}
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

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

  // mock 状态灯：当前面板黑色；隐藏面板有任务运行=绿闪，有失败=黄
  const dlDot = panel === "download" ? "active" : "busy";
  const cmpDot = panel === "compress" ? "active" : "busy";

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
            <DownloadPanel dlWorkers={settings.dlWorkers} />
          ) : (
            <CompressPanel compressWorkers={settings.compressWorkers} />
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

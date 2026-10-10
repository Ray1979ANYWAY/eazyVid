import { Logo } from "./Logo";
import { Icon, StatusDot } from "./ui";

export type Panel = "download" | "compress";

export function Sidebar({
  panel,
  onPanel,
  dlDot,
  cmpDot,
  onSettings,
}: {
  panel: Panel;
  onPanel: (p: Panel) => void;
  dlDot: "active" | "busy" | "fail" | "idle";
  cmpDot: "active" | "busy" | "fail" | "idle";
  onSettings: () => void;
}) {
  const navBtn = (active: boolean) =>
    `w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] font-medium transition-colors cursor-pointer
    ${active ? "bg-white/15 text-white" : "text-white/65 hover:text-white hover:bg-white/10"}`;

  return (
    <aside className="w-[196px] shrink-0 flex flex-col bg-[linear-gradient(180deg,#14185E_0%,#0C34B8_55%,#501A94_100%)]">
      {/* 品牌区 */}
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-white/10">
        <Logo size={36} />
        <div className="text-[19px] font-bold text-white font-display tracking-wide leading-none">eazyVid</div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 px-2.5 py-3 space-y-1">
        <button className={navBtn(panel === "download")} onClick={() => onPanel("download")}>
          <StatusDot mode={dlDot} />
          <span>视频下载</span>
        </button>
        <button className={navBtn(panel === "compress")} onClick={() => onPanel("compress")}>
          <StatusDot mode={cmpDot} />
          <span>视频压缩</span>
        </button>
      </nav>

      {/* 底部 */}
      <div className="px-2.5 py-3 border-t border-white/10">
        <button
          onClick={onSettings}
          className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] font-medium text-white/65 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <span className="inline-flex w-2.5 h-2.5" />
          <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z" size={15} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}

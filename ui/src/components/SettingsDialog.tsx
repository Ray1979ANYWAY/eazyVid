import { Dialog, FieldRow, Toggle, Icon, IconBtn } from "./ui";
import type { Settings } from "../App";

/* 数字微调器（上下箭头，仅接受阿拉伯数字） */
function NumberField({
  value,
  onChange,
  min = 1,
  max = 16,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled}
        className="w-6 h-6 rounded border border-border-soft text-text-sub hover:bg-slate-100 cursor-pointer text-[12px] leading-none disabled:opacity-35"
      >
        −
      </button>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d]/g, "");
          onChange(v === "" ? 0 : clamp(parseInt(v, 10)));
        }}
        onBlur={() => onChange(clamp(value))}
        className="w-11 h-6 text-center rounded border border-border-soft text-[12px] text-text-main focus:outline-2 focus:outline-brand-500 disabled:opacity-40"
      />
      <button
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled}
        className="w-6 h-6 rounded border border-border-soft text-text-sub hover:bg-slate-100 cursor-pointer text-[12px] leading-none disabled:opacity-35"
      >
        +
      </button>
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
  settings,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const dlDir = "D:\\Documents\\eazyVid\\downloaded";

  const outSame = true; // 当前版本固定"与原文件同目录"（覆盖功能依赖它）
  const overwrite = true;
  const cover = true;
  const coverSec = 5;

  const browse = (kind: "dl" | "out") => {
    // 引擎接入后调用 tauri dialog 打开文件夹选择器
    void kind;
  };

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <Dialog open={open} onClose={onClose} title="设置" width={560}>
      <div className="space-y-4">
        {/* 下载目录 */}
        <FieldRow label="视频下载目录">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className="flex-1 h-7 px-2.5 rounded-md border border-border-soft bg-surface text-[12px] text-text-main flex items-center truncate">
              {dlDir}
            </div>
            <IconBtn tip="浏览" onClick={() => browse("dl")} className="w-7 h-7 border border-border-soft bg-white">
              <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={14} />
            </IconBtn>
          </div>
        </FieldRow>

        <div className="h-px bg-border-soft" />

        {/* 压缩输出目录（当前固定"与原文件同目录"） */}
        <FieldRow label="压缩输出目录">
          <Toggle checked={outSame} onChange={() => {}} />
          <span className="text-[12px] text-text-main">与原文件同目录</span>
        </FieldRow>

        <div className="h-px bg-border-soft" />

        {/* 并发数：同时下载数 + 同时压缩数 放一起 */}
        <FieldRow label="同时下载数">
          <NumberField value={settings.dlWorkers} onChange={(v) => set({ dlWorkers: v })} />
          <div className="text-[11px] text-text-sub leading-4 w-[220px]">
            并行下载路数，超出部分自动进入等待队列
          </div>
        </FieldRow>
        <FieldRow label="同时压缩数">
          <NumberField value={settings.compressWorkers} onChange={(v) => set({ compressWorkers: v })} />
          <div className="text-[11px] text-text-sub leading-4 w-[220px]">
            建议不超过 3，并行进程过多可能会造成压缩比与画面质量波动
          </div>
        </FieldRow>

        <div className="h-px bg-border-soft" />

        {/* 覆盖 + 封面（与"与原文件同目录"联动，当前版本固定开启） */}
        <FieldRow label="压缩后覆盖原文件" disabled={!outSame}>
          <Toggle checked={overwrite} onChange={() => {}} disabled={!outSame} />
        </FieldRow>
        <FieldRow label="" disabled={!overwrite || !outSame}>
          <Toggle checked={cover} onChange={() => {}} disabled={!overwrite || !outSame} />
          <span className="text-[12px] text-text-main whitespace-nowrap">以第</span>
          <input
            value={coverSec}
            onChange={() => {}}
            className="w-12 h-6 text-center rounded border border-border-soft text-[12px] text-text-main focus:outline-2 focus:outline-brand-500 disabled:opacity-40"
            disabled={!overwrite || !outSame}
          />
          <span className="text-[12px] text-text-main whitespace-nowrap">秒末帧为封面</span>
        </FieldRow>
      </div>
    </Dialog>
  );
}

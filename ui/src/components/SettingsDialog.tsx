import { Dialog, FieldRow, Toggle, Icon, IconBtn, Select } from "./ui";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings } from "../App";
import { useI18n, type LangSetting } from "../i18n";

/* 数字微调器（上下箭头，仅接受阿拉伯数字；支持 0） */
function NumberField({
  value,
  onChange,
  min = 0,
  max = 999,
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
        className="w-7 h-7 rounded border border-border-soft text-text-sub hover:bg-slate-100 cursor-pointer text-[14px] leading-none disabled:opacity-35"
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
        className="w-12 h-7 text-center rounded border border-border-soft text-[14px] text-text-main focus:outline-2 focus:outline-brand-500 disabled:opacity-40"
      />
      <button
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled}
        className="w-7 h-7 rounded border border-border-soft text-text-sub hover:bg-slate-100 cursor-pointer text-[14px] leading-none disabled:opacity-35"
      >
        +
      </button>
    </div>
  );
}

export function SettingsDialog({
  open: openFlag,
  onClose,
  settings,
  onChange,
  onCheckUpdates,
  checkingUpdates = false,
  onOpenAbout,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (s: Settings) => void;
  onCheckUpdates?: () => void;
  checkingUpdates?: boolean;
  onOpenAbout?: () => void;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  /* 浏览目录（tauri 原生文件夹选择器） */
  const browse = async (kind: "dl" | "out") => {
    try {
      const sel = await open({
        directory: true,
        title: kind === "dl" ? t("settings.browseDlTitle") : t("settings.browseOutTitle"),
      });
      if (typeof sel === "string" && sel) {
        if (kind === "dl") set({ dlDir: sel });
        else set({ outDir: sel });
      }
    } catch {
      /* 取消或不可用 */
    }
  };

  const outSame = settings.outSame;
  const overwrite = settings.overwrite && outSame;
  const cover = settings.cover && overwrite;

  return (
    <Dialog
      open={openFlag}
      onClose={onClose}
      title={t("settings.title")}
      width={600}
      footer={
        <div className="px-5 py-3 border-t border-border-soft bg-slate-50/60 rounded-b-xl flex items-center justify-end">
          <button
            type="button"
            onClick={onOpenAbout}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-border-soft bg-white text-text-sub hover:text-text-main hover:bg-slate-100 hover:border-slate-300 text-[13px] font-medium transition-all shadow-2xs cursor-pointer"
          >
            <span>{t("about.btn")}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 界面语言（跟随系统 / 简体中文 / 英文，默认跟随系统，未命中英文兜底） */}
        <FieldRow label={t("settings.lang")}>
          <div className="w-[200px]">
            <Select
              value={settings.lang || "system"}
              onChange={(v) => set({ lang: v as LangSetting })}
              options={[
                { value: "system", label: t("settings.langSystem") },
                { value: "zh-CN", label: t("settings.langZh") },
                { value: "en", label: t("settings.langEn") },
              ]}
              className="w-full"
            />
          </div>
        </FieldRow>

        {/* 检查更新入口：放在界面语言正下方 */}
        <FieldRow label={t("settings.updateCheck")}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              type="button"
              onClick={onCheckUpdates}
              disabled={checkingUpdates}
              className="px-3.5 py-1.5 rounded-lg border border-border-soft bg-white text-text-main text-[13.5px] font-medium hover:border-brand-400 hover:text-brand-600 shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={checkingUpdates ? "animate-spin text-brand-600" : ""}>
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
              <span>{checkingUpdates ? t("settings.checking") : t("settings.updateCheckBtn")}</span>
            </button>
            <span className="text-[12px] text-text-sub truncate">
              {t("settings.updateCheckHint")}
            </span>
          </div>
        </FieldRow>

        <div className="h-px bg-border-soft" />

        {/* 下载目录 */}
        <FieldRow label={t("settings.dlDir")}>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className="flex-1 h-8 px-3 rounded-md border border-border-soft bg-surface text-[14px] text-text-main flex items-center truncate">
              {settings.dlDir || t("settings.dlDirDefault")}
            </div>
            <IconBtn tip={t("settings.browse")} onClick={() => browse("dl")} className="w-8 h-8 border border-border-soft bg-white">
              <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={15} />
            </IconBtn>
          </div>
        </FieldRow>

        <div className="h-px bg-border-soft" />

        {/* 压缩输出目录：同目录 / 指定目录 互斥 toggle */}
        <FieldRow label={t("settings.outDir")}>
          <Toggle checked={outSame} onChange={(v) => set({ outSame: v })} />
          <span className="text-[14px] text-text-main">{t("settings.outSame")}</span>
        </FieldRow>
        {!outSame && (
          <FieldRow label={t("settings.outCustom")}>
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="flex-1 h-8 px-3 rounded-md border border-border-soft bg-surface text-[14px] text-text-main flex items-center truncate">
                {settings.outDir || t("settings.outUnspecified")}
              </div>
              <IconBtn tip={t("settings.browse")} onClick={() => browse("out")} className="w-8 h-8 border border-border-soft bg-white">
                <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={15} />
              </IconBtn>
            </div>
          </FieldRow>
        )}

        <div className="h-px bg-border-soft" />

        {/* 并发数：同时下载数 + 同时压缩数 放一起 */}
        <FieldRow label={t("settings.dlWorkers")}>
          <NumberField value={settings.dlWorkers} onChange={(v) => set({ dlWorkers: v })} min={1} max={16} />
          <div className="text-[12px] text-text-sub leading-snug flex-1 min-w-0 ml-2">
            {t("settings.dlWorkersHint")}
          </div>
        </FieldRow>
        <FieldRow label={t("settings.cmpWorkers")}>
          <NumberField value={settings.compressWorkers} onChange={(v) => set({ compressWorkers: v })} min={1} max={16} />
          <div className="text-[12px] text-text-sub leading-snug flex-1 min-w-0 ml-2">
            {t("settings.cmpWorkersHint")}
          </div>
        </FieldRow>

        <div className="h-px bg-border-soft" />

        {/* 覆盖 + 封面（仅"与原文件同目录"时可开覆盖；覆盖开时封面才可选） */}
        <FieldRow label={t("settings.overwrite")} disabled={!outSame}>
          <Toggle checked={overwrite} onChange={(v) => set({ overwrite: v })} disabled={!outSame} />
        </FieldRow>
        <FieldRow label="" disabled={!overwrite}>
          <Toggle checked={cover} onChange={(v) => set({ cover: v })} disabled={!overwrite} />
          <span className="text-[14px] text-text-main whitespace-nowrap">{t("settings.coverPrefix")}</span>
          <NumberField value={settings.coverSec} onChange={(v) => set({ coverSec: v })} min={0} max={9999} disabled={!overwrite} />
          <span className="text-[14px] text-text-main whitespace-nowrap">{t("settings.coverSuffix")}</span>
        </FieldRow>
      </div>
    </Dialog>
  );
}

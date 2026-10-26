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
        className="w-7 h-7 rounded border border-border-soft bg-card text-text-sub hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-[14px] leading-none disabled:opacity-35"
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
        className="w-12 h-7 text-center rounded border border-border-soft bg-card text-[14px] text-text-main focus:outline-2 focus:outline-brand-500 disabled:opacity-40"
      />
      <button
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled}
        className="w-7 h-7 rounded border border-border-soft bg-card text-text-sub hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-[14px] leading-none disabled:opacity-35"
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
  onOpenAbout,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (s: Settings) => void;
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

  return (
    <Dialog
      open={openFlag}
      onClose={onClose}
      title={t("settings.title")}
      width={600}
      height={590}
      footer={
        <div className="px-5 py-3 border-t border-border-soft bg-slate-50/60 dark:bg-slate-900/60 rounded-b-xl flex items-center justify-end">
          <button
            type="button"
            onClick={onOpenAbout}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-border-soft bg-card text-text-sub hover:text-text-main hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 text-[13px] font-medium transition-all shadow-2xs cursor-pointer"
          >
            <span>{t("about.btn")}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-3 overflow-x-hidden">
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

        <div className="h-px bg-border-soft" />

        {/* 任务运行时阻止主机休眠 */}
        <FieldRow label={t("settings.preventSleep")}>
          <Toggle checked={settings.preventSleep ?? true} onChange={(v) => set({ preventSleep: v })} />
        </FieldRow>

        <div className="h-px bg-border-soft" />

        {/* 下载目录 */}
        <FieldRow label={t("settings.dlDir")}>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className="flex-1 h-8 px-3 rounded-md border border-border-soft bg-surface text-[14px] text-text-main flex items-center min-w-0">
              <span className="truncate">{settings.dlDir || t("settings.dlDirDefault")}</span>
            </div>
            <IconBtn tip={t("settings.browse")} onClick={() => browse("dl")} className="w-8 h-8 border border-border-soft bg-card shrink-0">
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
              <div className="flex-1 h-8 px-3 rounded-md border border-border-soft bg-surface text-[14px] text-text-main flex items-center min-w-0">
                <span className="truncate">{settings.outDir || t("settings.outUnspecified")}</span>
              </div>
              <IconBtn tip={t("settings.browse")} onClick={() => browse("out")} className="w-8 h-8 border border-border-soft bg-card shrink-0">
                <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={15} />
              </IconBtn>
            </div>
          </FieldRow>
        )}
        {/* 覆盖原文件：仅当“与原文件同目录”时存在并显示；关闭“与原文件同目录”后整行消失 */}
        {outSame && (
          <FieldRow label={t("settings.overwrite")}>
            <Toggle checked={settings.overwrite} onChange={(v) => set({ overwrite: v })} />
          </FieldRow>
        )}

        {/* 压缩后抽帧生成封面：与上面的压缩设置归为一组（去掉了中间的分割线） */}
        <FieldRow label={t("settings.cover")}>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <Toggle checked={settings.cover} onChange={(v) => set({ cover: v })} />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <span className={`text-[14px] transition-colors ${settings.cover ? "text-text-main" : "text-text-sub/50"}`}>
                {t("settings.coverPrefix")}
              </span>
              <NumberField
                value={settings.coverSec}
                onChange={(v) => set({ coverSec: v })}
                min={0}
                max={9999}
                disabled={!settings.cover}
              />
              <span className={`text-[14px] transition-colors ${settings.cover ? "text-text-main" : "text-text-sub/50"}`}>
                {t("settings.coverSuffix")}
              </span>
            </div>
          </div>
        </FieldRow>

        <div className="h-px bg-border-soft" />

        {/* 并发数：同时下载数 + 同时压缩数 放一起 */}
        <FieldRow label={t("settings.dlWorkers")}>
          <NumberField value={settings.dlWorkers} onChange={(v) => set({ dlWorkers: v })} min={1} max={16} />
          <div className="text-[12px] text-text-sub leading-snug flex-1 min-w-0 ml-2 break-words">
            {t("settings.dlWorkersHint")}
          </div>
        </FieldRow>
        <FieldRow label={t("settings.cmpWorkers")}>
          <NumberField value={settings.compressWorkers} onChange={(v) => set({ compressWorkers: v })} min={1} max={16} />
          <div className="text-[12px] text-text-sub leading-snug flex-1 min-w-0 ml-2 break-words">
            {t("settings.cmpWorkersHint")}
          </div>
        </FieldRow>
      </div>
    </Dialog>
  );
}

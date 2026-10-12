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
    <Dialog open={openFlag} onClose={onClose} title={t("settings.title")} width={600}>
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

        {/* 设置面板底部：关于与赞助链接（左边 Sponsor，右边 About） */}
        <div className="pt-4 mt-2 border-t border-border-soft flex items-center justify-between">
          {/* 左侧：Sponsor (Ko-fi 官方配色与图标) */}
          <a
            href="https://ko-fi.com/rayhu"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FF5E5B]/10 hover:bg-[#FF5E5B]/15 text-[#FF5E5B] border border-[#FF5E5B]/25 text-[13px] font-semibold transition-all shadow-2xs hover:shadow-xs group cursor-pointer"
          >
            {/* Ko-fi Official Cup SVG */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="transition-transform group-hover:scale-110">
              <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.683-2.566.012-.046 1.488-8.238 1.488-8.238s3.473-.393 4.316 2.274c.731 2.316-.762 3.842-1.996 4.343-.377.153-.393.582-.045.748 1.341.644 3.491-.659 3.864-2.428.455-2.155-.002-3.782-1.021-4.782zm-6.271 8.85c-.328.748-1.503 1.09-2.548 1.09H3.72c-.896 0-1.62-.724-1.62-1.62V6.355h14.717l-.807 8.443z"/>
              <path d="M12.723 9.421c-.815-.992-2.145-1.129-3.033-.314-.888.815-.992 2.145-.314 3.033 1.037 1.353 3.347 3.398 3.347 3.398s2.31-2.045 3.347-3.398c.678-.888.574-2.218-.314-3.033-.888-.815-2.218-.678-3.033.314z"/>
            </svg>
            <span>{t("about.sponsor")} (Ko-fi)</span>
          </a>

          {/* 右侧：About（包含 GitHub 链接与说明入口） */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenAbout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-soft bg-white text-text-sub hover:text-text-main hover:bg-slate-50 text-[13px] font-medium transition-colors cursor-pointer"
            >
              <span>{t("about.btn")}</span>
            </button>
            <a
              href="https://github.com/Ray1979ANYWAY/eazyVid"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-[13px] font-medium transition-all shadow-xs cursor-pointer"
            >
              {/* GitHub Official Invertocat SVG */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
              </svg>
              <span>GitHub</span>
            </a>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

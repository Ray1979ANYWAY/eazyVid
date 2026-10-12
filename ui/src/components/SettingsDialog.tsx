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
          {/* 左侧：Sponsor (Ko-fi 经典蓝底/白杯红心官方标志) */}
          <a
            href="https://ko-fi.com/rayhu"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#13C3FF]/10 hover:bg-[#13C3FF]/18 text-[#0092CA] hover:text-[#007EA7] border border-[#13C3FF]/30 text-[13px] font-semibold transition-all shadow-2xs hover:shadow-xs group cursor-pointer"
          >
            {/* Ko-fi Official Cup + Red Heart Vector */}
            <svg width="20" height="16" viewBox="0 0 241 194" fill="none" className="shrink-0 transition-transform group-hover:scale-110">
              {/* 白杯杯身与外轮廓 */}
              <path d="M15.1975 67.7674C15.1975 37.5285 33.3866 21.164 54.7559 18.4334C70.8987 16.387 90.906 16.1589 114.544 16.1589C151.372 16.1589 160.919 16.6151 174.559 17.9772C206.617 21.1576 225.255 40.937 225.255 69.3577V72.9941C225.255 99.3687 205.932 120.966 179.786 123.234C177.74 130.058 174.559 136.874 170.238 143.698C160.235 159.156 140.228 178.707 103.4 178.707H96.1264C66.1155 178.707 42.9277 165.751 29.0595 142.107C16.7814 121.422 15.1912 98.4563 15.1912 67.7674" fill="#202020"/>
              <path d="M32.2469 67.9899C32.2469 97.3168 34.0654 116.184 43.6127 133.689C54.5225 153.924 74.3018 161.653 96.8117 161.653H103.857C133.411 161.653 147.736 147.329 155.693 134.829C159.558 128.462 162.966 121.417 164.784 112.547L166.147 106.864H174.332C192.521 106.864 208.208 92.09 208.208 73.2166V69.8082C208.208 48.6669 195.024 37.5228 172.058 34.7987C159.102 33.6646 151.372 33.2084 114.538 33.2084C89.7602 33.2084 72.0272 33.4364 58.6152 35.4828C39.7483 38.2134 32.2407 48.8951 32.2407 67.9899" fill="#FFFFFF"/>
              {/* 杯把内部镂空 */}
              <path d="M166.158 83.6801C166.158 86.4107 168.204 88.4572 171.841 88.4572C183.435 88.4572 189.802 81.8619 189.802 70.9523C189.802 60.0427 183.435 53.2195 171.841 53.2195C168.204 53.2195 166.158 55.2657 166.158 57.9963V83.6866V83.6801Z" fill="#202020"/>
              {/* 经典红心 */}
              <path d="M54.5321 82.3198C54.5321 95.732 62.0332 107.326 71.5807 116.424C77.9478 122.562 87.9515 128.93 94.7685 133.022C96.8147 134.157 98.8611 134.841 101.136 134.841C103.866 134.841 106.134 134.157 107.959 133.022C114.782 128.93 124.779 122.562 130.919 116.424C140.694 107.332 148.195 95.7383 148.195 82.3198C148.195 67.7673 137.286 54.8115 121.599 54.8115C112.28 54.8115 105.912 59.5882 101.136 66.1772C96.8147 59.582 90.2259 54.8115 80.9001 54.8115C64.9855 54.8115 54.5256 67.7673 54.5256 82.3198" fill="#FF5E5B"/>
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

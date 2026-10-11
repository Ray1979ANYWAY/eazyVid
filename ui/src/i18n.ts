import React, { createContext, useContext, useMemo, type ReactNode } from "react";

export type LangSetting = "system" | "zh-CN" | "en";
export type ResolvedLang = "zh-CN" | "en";

export function resolveLang(setting: LangSetting): ResolvedLang {
  if (setting === "zh-CN") return "zh-CN";
  if (setting === "en") return "en";
  // Follow system language
  if (typeof navigator !== "undefined") {
    const sys = navigator.language || (navigator as { userLanguage?: string }).userLanguage || "";
    // If system language matches Chinese (zh, zh-CN, zh-HK, zh-TW, zh-SG, etc.), use zh-CN
    if (/^zh\b/i.test(sys)) {
      return "zh-CN";
    }
  }
  // No match -> English fallback as requested
  return "en";
}

const DICT = {
  // Navigation & Window
  "nav.download": { "zh-CN": "视频下载", en: "Downloader" },
  "nav.compress": { "zh-CN": "视频压缩", en: "Compressor" },
  "nav.settings": { "zh-CN": "设置", en: "Settings" },
  "win.minimize": { "zh-CN": "最小化", en: "Minimize" },
  "win.maximize": { "zh-CN": "最大化", en: "Maximize" },
  "win.restore": { "zh-CN": "还原", en: "Restore" },
  "win.close": { "zh-CN": "关闭", en: "Close" },

  // Global Footer
  "footer.gain": {
    "zh-CN": "当前任务列表已完成压缩收益 {gain} GB",
    en: "Current queue: {gain} GB saved via compression",
  },
  "footer.dlCount": {
    "zh-CN": "当前任务列表已完成下载 {count} 项",
    en: "Current queue: {count} downloads finished",
  },
  "footer.shutdown": {
    "zh-CN": "所有任务结束后关机",
    en: "Shut down when all tasks complete",
  },
  "footer.shutdownTip": {
    "zh-CN": "所有任务（下载与压缩）结束后自动关机",
    en: "Automatically shut down computer after all downloads and compressions finish",
  },
  "shutdown.title": { "zh-CN": "所有任务已完成", en: "All Tasks Completed" },
  "shutdown.desc": {
    "zh-CN": "下载与压缩任务已全部处理完毕。电脑将在 {sec} 秒后自动关机。",
    en: "All downloads and compressions are complete. Your computer will shut down in {sec} seconds.",
  },
  "shutdown.hint": {
    "zh-CN": "如需继续使用电脑，请点击“取消关机”。",
    en: "If you want to keep using your computer, click \"Cancel Shutdown\".",
  },
  "shutdown.cancel": { "zh-CN": "取消关机", en: "Cancel Shutdown" },

  // ffmpeg notices
  "ffmpeg.nightlyTip": {
    "zh-CN": "当前 ffmpeg 是非稳定版（{current}），最新稳定版为 {latest}，建议更换以获得更好的稳定性与压缩性能",
    en: "You are running a pre-release ffmpeg build ({current}). The latest stable release is {latest}. Updating is recommended for better stability and performance.",
  },
  "ffmpeg.newerTip": {
    "zh-CN": "发现 ffmpeg 新版本 {latest}（当前 {current}），更新可提升压缩性能与格式兼容性",
    en: "A newer stable ffmpeg release ({latest}) is available (current: {current}). Updating improves compression speed and compatibility.",
  },
  "ffmpeg.downloading": { "zh-CN": "下载中 {pct}%", en: "Downloading {pct}%" },
  "ffmpeg.extracting": { "zh-CN": "解压替换中…", en: "Extracting & installing..." },
  "ffmpeg.updateBtn": { "zh-CN": "一键更新", en: "Update Now" },
  "ffmpeg.dismiss": { "zh-CN": "知道了", en: "Dismiss" },
  "ffmpeg.dlgTitle": { "zh-CN": "更新 ffmpeg", en: "Update ffmpeg" },
  "ffmpeg.dlgDesc": {
    "zh-CN": "将下载 ffmpeg 最新稳定版（约 160MB）并自动替换当前版本，无需手动覆盖。",
    en: "Downloads the latest stable ffmpeg release (~160 MB) and automatically upgrades your local binary without manual file replacement.",
  },
  "ffmpeg.dlgHint": {
    "zh-CN": "建议在无压缩任务进行时更新；若替换时文件被占用会提示失败，旧版本自动保留。",
    en: "Recommended when no compression jobs are active. If files are locked, the update safely aborts and preserves your current version.",
  },
  "ffmpeg.cancel": { "zh-CN": "取消", en: "Cancel" },
  "ffmpeg.startUpdate": { "zh-CN": "开始更新", en: "Start Update" },
  "ffmpeg.resultTitle": { "zh-CN": "ffmpeg 更新", en: "ffmpeg Update" },
  "ffmpeg.ok": { "zh-CN": "好", en: "OK" },
  "ffmpeg.success": { "zh-CN": "已自动更新到 ffmpeg {version}", en: "Successfully updated to ffmpeg {version}" },
  "ffmpeg.successDefault": { "zh-CN": "已自动更新到最新稳定版", en: "Successfully updated to the latest stable release" },
  "ffmpeg.fail": { "zh-CN": "更新失败，请重试", en: "Update failed. Please try again." },

  // Quit Dialog
  "quit.title": { "zh-CN": "任务进行中", en: "Tasks in Progress" },
  "quit.desc": {
    "zh-CN": "当前有 {total} 个任务正在进行或暂停（下载 {dl} 个、压缩 {cmp} 个）。",
    en: "There are {total} active or paused tasks ({dl} downloads, {cmp} compressions).",
  },
  "quit.hint": {
    "zh-CN": "退出会中断这些任务，未完成任务的文件将被删除：压缩的中间输出、下载的临时缓存都会被清除（源文件保留）。",
    en: "Exiting will interrupt these tasks. Temporary download caches and incomplete compression output will be cleaned up (source files remain intact).",
  },
  "quit.cancel": { "zh-CN": "取消", en: "Cancel" },
  "quit.confirm": { "zh-CN": "确定退出", en: "Exit Anyway" },

  // Settings Dialog
  "settings.title": { "zh-CN": "设置", en: "Settings" },
  "settings.lang": { "zh-CN": "界面语言", en: "Display Language" },
  "settings.langSystem": { "zh-CN": "跟随系统", en: "System Default" },
  "settings.langZh": { "zh-CN": "简体中文", en: "简体中文" },
  "settings.langEn": { "zh-CN": "English", en: "English" },
  "settings.dlDir": { "zh-CN": "视频下载目录", en: "Download Directory" },
  "settings.dlDirDefault": { "zh-CN": "默认（安装目录\\downloaded）", en: "Default (App Directory\\downloaded)" },
  "settings.browse": { "zh-CN": "浏览", en: "Browse" },
  "settings.browseDlTitle": { "zh-CN": "选择视频下载目录", en: "Select Download Directory" },
  "settings.browseOutTitle": { "zh-CN": "选择压缩输出目录", en: "Select Compression Output Directory" },
  "settings.outDir": { "zh-CN": "压缩输出目录", en: "Compression Output" },
  "settings.outSame": { "zh-CN": "与原文件同目录", en: "Save to source file directory" },
  "settings.outCustom": { "zh-CN": "指定输出目录", en: "Custom output directory" },
  "settings.outUnspecified": { "zh-CN": "未指定（将用默认输出目录）", en: "Unspecified (uses default output directory)" },
  "settings.dlWorkers": { "zh-CN": "同时下载数", en: "Concurrent Downloads" },
  "settings.dlWorkersHint": { "zh-CN": "并行下载路数，超出部分自动进入等待队列", en: "Maximum parallel download workers; additional tasks are queued automatically" },
  "settings.cmpWorkers": { "zh-CN": "同时压缩数", en: "Concurrent Compressions" },
  "settings.cmpWorkersHint": { "zh-CN": "建议不超过 3，并行进程过多可能会造成压缩比与画面质量波动", en: "Recommended ≤ 3. Too many parallel encoding threads may degrade throughput and system responsiveness." },
  "settings.overwrite": { "zh-CN": "压缩后覆盖原文件", en: "Overwrite original file after compression" },
  "settings.coverPrefix": { "zh-CN": "以第", en: "Extract frame at" },
  "settings.coverSuffix": { "zh-CN": "秒末帧为封面", en: "seconds as cover thumbnail" },

  // Compress Panel
  "cmp.addVideos": { "zh-CN": "添加视频", en: "Add Videos" },
  "cmp.addFolder": { "zh-CN": "添加文件夹", en: "Add Folder" },
  "cmp.addFolderTip": { "zh-CN": "递归添加文件夹内全部视频", en: "Recursively import all videos inside folder" },
  "cmp.scanning": { "zh-CN": "扫描中…", en: "Scanning..." },
  "cmp.modeLabel": { "zh-CN": "压缩模式", en: "Preset" },
  "cmp.modeTip": { "zh-CN": "所有预设均 1:1 保持原始分辨率与源帧率，仅消除多余冗余码率", en: "All presets preserve original resolution & framerate (1:1), optimizing bitrate only." },
  "cmp.start": { "zh-CN": "开始压缩", en: "Start Compression" },
  "cmp.clearDone": { "zh-CN": "清空已完成", en: "Clear Completed" },
  "cmp.workersActive": { "zh-CN": "已开硬解并发 ({workers} 线程)", en: "{workers} concurrent encoding workers" },
  "cmp.title": { "zh-CN": "压缩任务", en: "Compression Tasks" },
  "cmp.items": { "zh-CN": "（{count} 项）", en: "({count} items)" },
  "cmp.selectTip": { "zh-CN": "可使用 Ctrl 或 Shift 多选移除队列", en: "Use Ctrl or Shift to select multiple tasks" },
  "cmp.removeSelected": { "zh-CN": "移出选中（{count}）", en: "Remove Selected ({count})" },
  "cmp.dragTip": { "zh-CN": "排队中可拖动调整优先级", en: "Drag queued tasks to reorder priority" },
  "cmp.dragPrompt": { "zh-CN": "1:1保持源分辨率与帧率 · 拖入文件或拖动调优", en: "Keeps original resolution & framerate · Drag & drop files or reorder" },
  "cmp.emptyTip": { "zh-CN": "添加视频文件后开始压缩", en: "Add video files to start compression" },
  "cmp.emptyTitle": { "zh-CN": "拖拽视频或文件夹到此处，开启批量瘦身", en: "Drag & drop videos or folders here to start compression" },
  "cmp.emptyDesc": { "zh-CN": "不降分辨率 · 不降帧率 · 智能消除冗余码率 · 视觉无损大瘦身", en: "No resolution downscaling · No framerate drops · Visual lossless smart compression" },
  "cmp.btnBrowseFiles": { "zh-CN": "浏览视频文件", en: "Browse Video Files" },
  "cmp.btnBrowseFolder": { "zh-CN": "导入整个文件夹", en: "Import Folder" },
  "cmp.presetQuickSelect": { "zh-CN": "常用压缩模式速选（点击可直接切换顶部预设）：", en: "Presets Quick Glance (click to switch):" },
  "cmp.presetDescDefault": { "zh-CN": "兼顾体积与速度", en: "Balanced size & speed" },
  "cmp.presetDescHq": { "zh-CN": "高保真细节保留", en: "High-fidelity detail" },
  "cmp.presetDescFast": { "zh-CN": "快速完成急件", en: "Ultra-fast encoding" },
  "cmp.presetDescAv1": { "zh-CN": "极致空间瘦身", en: "Maximum compression" },
  "cmp.slimmingBadge": { "zh-CN": "-75% 极速瘦身", en: "-75% Compression" },
  "cmp.origSizeLabel": { "zh-CN": "原文件大小", en: "Original Size" },
  "cmp.optSizeLabel": { "zh-CN": "同分辨率/原帧率 · 几无肉眼差", en: "Same res/fps · Visually lossless" },
  "cmp.status.running": { "zh-CN": "压缩中", en: "Compressing" },
  "cmp.status.queued": { "zh-CN": "排队中", en: "Queued" },
  "cmp.status.done": { "zh-CN": "已完成", en: "Completed" },
  "cmp.status.stopped": { "zh-CN": "已终止", en: "Terminated" },
  "cmp.status.skipped": { "zh-CN": "收益小，已跳过", en: "Skipped (Minimal Gain)" },
  "cmp.status.failed": { "zh-CN": "压缩失败", en: "Failed" },
  "cmp.statusFailed": { "zh-CN": "压缩失败，请查看日志", en: "Compression failed. Check logs." },
  "cmp.waitingWorker": { "zh-CN": "等待空闲线程…", en: "Waiting for available worker..." },
  "cmp.elapsed": { "zh-CN": "用时 {time}", en: "Elapsed {time}" },
  "cmp.eta": { "zh-CN": "预计剩余 {eta}", en: "ETA {eta}" },
  "cmp.skippedMsg": { "zh-CN": "预估压缩收益不足，已终止", en: "Estimated compression savings are negligible; skipped" },
  "cmp.stoppedMsg": { "zh-CN": "已手动终止", en: "Terminated by user" },
  "cmp.stopTip": { "zh-CN": "终止", en: "Stop" },
  "cmp.restartTip": { "zh-CN": "重新压缩（排入等待队列）", en: "Retry (re-queue)" },
  "cmp.topTip": { "zh-CN": "置顶", en: "Move to Top" },
  "cmp.deleteTip": { "zh-CN": "删除（仅移出列表）", en: "Remove from list" },
  "cmp.tip.stop": { "zh-CN": "终止压缩（无法从断点继续）", en: "Stop compression (cannot resume)" },
  "cmp.tip.restart": { "zh-CN": "重新压缩（排到队尾）", en: "Retry (re-queue)" },
  "cmp.tip.top": { "zh-CN": "置顶", en: "Move to Top" },
  "cmp.tip.delete": { "zh-CN": "删除（仅移出列表）", en: "Remove from list" },
  "cmp.openFile": { "zh-CN": "打开文件", en: "Open File" },
  "cmp.openDir": { "zh-CN": "打开输出目录", en: "Show in Folder" },
  "cmp.removeFromList": { "zh-CN": "移出队列", en: "Remove from Queue" },
  "cmp.removeMulti": { "zh-CN": "移出队列（{count} 项）", en: "Remove from Queue ({count} items)" },
  "cmp.stopDlgTitle": { "zh-CN": "终止压缩", en: "Stop Compression" },
  "cmp.removeDlgTitle": { "zh-CN": "移出运行中任务", en: "Stop & Remove Task" },
  "cmp.confirmStopDesc": { "zh-CN": "确定终止压缩 {name}？", en: "Are you sure you want to stop compressing {name}?" },
  "cmp.confirmRemoveDesc": { "zh-CN": "确定终止并移出 {name}？", en: "Are you sure you want to stop and remove {name}?" },
  "cmp.stopDlgWarn": {
    "zh-CN": "未压缩完的临时输出将被删除，源文件保留；无法从断点继续，下次需重新压缩。",
    en: "Partial output files will be discarded (original file is untouched). This task cannot resume from checkpoint and will restart from the beginning.",
  },
  "cmp.stopDlgText": {
    "zh-CN": "终止压缩将删除该任务未完成的中间输出（无法从断点继续），源文件保留。是否继续？",
    en: "Stopping compression will discard the unfinished output (cannot resume). Source files are preserved. Continue?",
  },
  "cmp.keepRunning": { "zh-CN": "继续压缩", en: "Keep Running" },
  "cmp.confirmStop": { "zh-CN": "确定终止", en: "Stop Compression" },
  "cmp.confirmStopAndRemove": { "zh-CN": "终止并移出", en: "Stop and Remove" },
  "cmp.stopDlgStop": { "zh-CN": "终止", en: "Stop" },
  "cmp.stopDlgStopAndRemove": { "zh-CN": "终止并移出", en: "Stop & Remove" },
  "cmp.multiStopTitle": { "zh-CN": "移出选中任务", en: "Remove Selected Tasks" },
  "cmp.multiStopDesc": {
    "zh-CN": "选中的 {n} 项中包含正在压缩的任务——将终止压缩并删除其未完成的中间输出（无法从断点继续），源文件保留。确认移出全部选中任务？",
    en: "The {n} selected tasks include ongoing compressions. Stopping them will discard partial output files (cannot resume). Source files are preserved. Remove all selected tasks?",
  },
  "cmp.multiStopConfirm": { "zh-CN": "终止并移出全部", en: "Stop & Remove All" },

  // Presets
  "mode.default": { "zh-CN": "默认（均衡）", en: "Balanced (Default)" },
  "mode.hq": { "zh-CN": "画质优先", en: "Quality Priority" },
  "mode.fast": { "zh-CN": "速度优先", en: "Fast (Speed)" },
  "mode.av1": { "zh-CN": "AV1 极限压缩", en: "AV1 Extreme" },

  // Download Panel
  "dl.placeholder": { "zh-CN": "粘贴视频页面地址，回车探测", en: "Paste video URL and press Enter to analyze..." },
  "dl.pasteTip": { "zh-CN": "粘贴（自动提取 URL）", en: "Paste (auto-extract URL)" },
  "dl.probing": { "zh-CN": "探测中…", en: "Analyzing..." },
  "dl.probingTip": { "zh-CN": "正在探测，点击取消", en: "Analyzing... Click to cancel" },
  "dl.probeBtn": { "zh-CN": "探测格式", en: "Analyze URL" },
  "dl.probeSuccess": { "zh-CN": "解析出 {count} 种可用视频格式", en: "{count} playable video formats detected" },
  "dl.hint": { "zh-CN": "直连探测优先；藏得太深的视频会自动引导进入嗅探", en: "Direct stream detection first; deep embedded videos will switch to sniffer automatically." },
  "dl.col.res": { "zh-CN": "分辨率", en: "Resolution" },
  "dl.col.ext": { "zh-CN": "格式", en: "Format" },
  "dl.col.codec": { "zh-CN": "编码", en: "Codec" },
  "dl.col.size": { "zh-CN": "预估大小", en: "Estimated Size" },
  "dl.col.tip": { "zh-CN": "提示", en: "Notes" },
  "dl.col.action": { "zh-CN": "操作", en: "Action" },
  "dl.downloadBtn": { "zh-CN": "下载", en: "Download" },
  "dl.formatDownloadTip": { "zh-CN": "下载此格式（双击行也可）", en: "Download this format (or double-click row)" },
  "dl.parsingFormats": { "zh-CN": "正在解析可用格式…", en: "Analyzing available formats..." },
  "dl.formatsPlaceholder": { "zh-CN": "可用格式将显示在这里", en: "Available formats will appear here" },
  "dl.probeFailed": { "zh-CN": "探测失败：{err}", en: "Detection failed: {err}" },
  "dl.audioOnly": { "zh-CN": "仅音频", en: "Audio Only" },
  "dl.unknown": { "zh-CN": "未知", en: "Unknown" },
  "dl.av1Warn": { "zh-CN": "AV1 兼容性差，多数播放器无法硬解", en: "AV1 has limited player compatibility; hardware decoding may be unsupported." },
  "dl.errAudioOnly": { "zh-CN": "仅解析到音频流，无视频格式", en: "Only audio streams detected; no playable video streams found." },
  "dl.errNone": { "zh-CN": "未解析到可用格式", en: "No playable video formats found." },
  "dl.poolTitle": { "zh-CN": "下载池", en: "Download Queue" },
  "dl.poolSummary": { "zh-CN": "（{count} 项 · 完成 {done}）", en: "({count} items · {done} finished)" },
  "dl.poolSelectTip": { "zh-CN": "可使用 Ctrl 或 Shift 多选移除队列", en: "Use Ctrl or Shift to select multiple tasks" },
  "dl.poolRemoveSelected": { "zh-CN": "移出选中（{count}）", en: "Remove Selected ({count})" },
  "dl.poolDragTip": { "zh-CN": "排队中可拖动调整优先级", en: "Drag queued tasks to reorder priority" },
  "dl.emptyState": { "zh-CN": "暂无下载任务", en: "No active download tasks" },
  "dl.emptyTitle": { "zh-CN": "输入或粘贴视频链接，开启极速下载", en: "Paste video link to start downloading" },
  "dl.emptyDesc": { "zh-CN": "支持 Ctrl + V 快捷嗅探 · 自动识别剪贴板内容", en: "Supports Ctrl + V instant sniffing · Smart clipboard detection" },
  "dl.emptyTagSupport": { "zh-CN": "广泛支持：", en: "Supported:" },
  "dl.emptyTagMore": { "zh-CN": "+ 更多流媒体", en: "+ More Streams" },
  "dl.clipDetected": { "zh-CN": "已自动感知剪贴板链接", en: "Video link detected in clipboard" },
  "dl.clipApply": { "zh-CN": "一键填入", en: "Apply" },
  "toast.title": { "zh-CN": "全部任务已完成", en: "All Tasks Completed" },
  "toast.body": { "zh-CN": "队列任务已全部处理完毕，共节省 {gain} GB 存储空间。", en: "All tasks completed. {gain} GB saved via compression." },
  "toast.cmpTitle": { "zh-CN": "视频压缩已完成", en: "Compression Completed" },
  "toast.cmpBody": { "zh-CN": "队列视频已全部压缩完成，共节省 {gain} GB 存储空间。", en: "All video compressions finished. {gain} GB saved via compression." },
  "toast.dlTitle": { "zh-CN": "视频下载已完成", en: "Downloads Completed" },
  "toast.dlBody": { "zh-CN": "队列中视频已全部下载完成。", en: "All video downloads in queue completed." },
  "toast.dismiss": { "zh-CN": "知道了", en: "Dismiss" },
  "dl.status.downloading": { "zh-CN": "下载中", en: "Downloading" },
  "dl.status.parsing": { "zh-CN": "解析中…", en: "Parsing..." },
  "dl.status.waiting": { "zh-CN": "等待下载", en: "Waiting to download" },
  "dl.status.merging": { "zh-CN": "正在合并音轨，请稍候", en: "Merging audio tracks, please wait..." },
  "dl.status.paused": { "zh-CN": "已暂停", en: "Paused" },
  "dl.status.done": { "zh-CN": "已完成", en: "Completed" },
  "dl.status.failed": { "zh-CN": "下载失败", en: "Download Failed" },
  "dl.mode.none": { "zh-CN": "不压缩", en: "No Compression" },
  "dl.modeTipAuto": { "zh-CN": "下载完成后自动压缩", en: "Automatically compress upon download completion" },
  "dl.modeTipManual": { "zh-CN": "下载完成后不压缩，可后续手动添加压缩", en: "Keep original; no automatic compression after download" },
  "dl.pause": { "zh-CN": "暂停", en: "Pause" },
  "dl.resume": { "zh-CN": "恢复（排入等待队列）", en: "Resume (queue)" },
  "dl.retry": { "zh-CN": "重新下载（排入等待队列）", en: "Retry Download" },
  "dl.openFile": { "zh-CN": "打开文件", en: "Open File" },
  "dl.openDir": { "zh-CN": "打开所在文件夹", en: "Show in Folder" },
  "dl.remove": { "zh-CN": "删除", en: "Remove" },
  "dl.removeListOnly": { "zh-CN": "仅移出列表", en: "Remove from list only" },
  "dl.removeAndDelete": { "zh-CN": "移出列表并删除文件", en: "Remove from list and delete file" },
  "dl.removeCacheOnly": { "zh-CN": "移出列表并删除缓存", en: "Remove from list and delete cache" },
  "dl.removeMulti": { "zh-CN": "移出队列（{count} 项）", en: "Remove from Queue ({count} items)" },
  "dl.batchRemoveTitle": { "zh-CN": "批量移出队列", en: "Batch Remove from Queue" },
  "dl.batchRemoveDesc": { "zh-CN": "选中的 {count} 个任务中包含未完成的任务。", en: "{count} selected tasks include ongoing or queued downloads." },
  "dl.batchRemoveWarn": {
    "zh-CN": "移出会删除未完成任务的临时下载缓存，已完成的文件将保留。确定移出？",
    en: "Removing will delete temporary download caches for incomplete tasks (finished files will be preserved). Proceed?",
  },
  "dl.dlgRemoveTitle": { "zh-CN": "移出队列", en: "Remove from Queue" },
  "dl.dlgRemoveDesc": {
    "zh-CN": "将删除 {n} 个有下载缓存的任务（下载中/暂停/失败等）的临时下载缓存；已完成与等待下载的任务不产生缓存，文件保留。是否继续？",
    en: "Deleting {n} tasks with partial downloads will clean up their temporary caches. Completed and queued tasks have no cache to clear. Continue?",
  },
  "dl.dlgRemoveConfirm": { "zh-CN": "移出并清理", en: "Remove & Clean Up" },
  "dl.confirmRemove": { "zh-CN": "确定移出", en: "Confirm Remove" },
  "dl.cancel": { "zh-CN": "取消", en: "Cancel" },
} as const;

export type TranslationKey = keyof typeof DICT;

export function translate(
  lang: ResolvedLang,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const item = DICT[key];
  if (!item) return key;
  let text: string = item[lang] || item["en"] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

interface I18nContextValue {
  lang: ResolvedLang;
  setting: LangSetting;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "zh-CN",
  setting: "system",
  t: (k) => k,
});

export function I18nProvider({
  setting,
  children,
}: {
  setting: LangSetting;
  children: ReactNode;
}) {
  const lang = useMemo(() => resolveLang(setting), [setting]);
  const value = useMemo(
    () => ({
      lang,
      setting,
      t: (key: TranslationKey, params?: Record<string, string | number>) => translate(lang, key, params),
    }),
    [lang, setting],
  );
  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}

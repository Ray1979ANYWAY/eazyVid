import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconBtn, Icon, Select, Dialog, fmtSize, fmtSpeed, useTip, ContextMenu, type CtxItem } from "./ui";
import { type DlFormat, type DlTask, MODE_TINTS, getCompressModes } from "../mock";
import { useDragSort } from "../hooks/useDragSort";
import { useEngine } from "../hooks/useEngine";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { diag } from "../diag";
import { useI18n, type TranslationKey } from "../i18n";

/* 下载行压缩模式选项：默认"不压缩"，选了模式则下载完成自动入压缩队列 */
function getDlModes(t: (k: TranslationKey, p?: any) => string) {
  return [{ value: "none", label: t("dl.mode.none") }, ...getCompressModes(t)];
}

/** 打开文件/目录：调用前后 + 错误全部落盘探针（定位"点了没动作"） */
const tryOpen = (p: string, kind: string) => {
  diag(`OPEN ${kind} path=${p}`);
  openPath(p)
    .then(() => diag(`OPEN ${kind} ok`))
    .catch((e) => diag(`OPEN ${kind} FAIL ${String(e)}`));
};
const tryReveal = (p: string, kind: string) => {
  diag(`REVEAL ${kind} path=${p}`);
  revealItemInDir(p)
    .then(() => diag(`REVEAL ${kind} ok`))
    .catch((e) => diag(`REVEAL ${kind} FAIL ${String(e)}`));
};

const DL_ROW_H = 68; // 62px 行高 + 6px 间距

/* ============ 格式列表行 ============ */
/* 从混杂文本（分享文案+表情+链接）提取 URL：优先 Markdown [标题](url)，否则第一个 http(s) 链接 */
function extractUrl(text: string): string {
  if (!text) return "";
  const md = text.match(/\]\((https?:\/\/[^\s）)\]]+)/);
  if (md) return md[1].replace(/[)\]]+$/, "");
  const m = text.match(/https?:\/\/[^\s）)\]]+/);
  return m ? m[0].replace(/[)\]]+$/, "") : "";
}

function FormatRow({ f, onDownload }: { f: DlFormat; onDownload: (f: DlFormat) => void }) {
  const [hover, setHover] = useState(false);
  const show = useTip();
  const { t } = useI18n();

  return (
    <div
      className="grid grid-cols-[100px_75px_85px_105px_1fr_80px] items-center h-12 px-3 rounded-lg border border-transparent
        hover:border-border-brand hover:bg-brand-50/50 transition-colors cursor-default"
      style={{ background: hover ? undefined : undefined }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={() => onDownload(f)}
    >
      <div className="text-[15px] font-semibold text-brand-700 dark:text-brand-300">{f.res}</div>
      <div className="text-[14px] text-text-sub">{f.ext.toUpperCase()}</div>
      <div className="text-[14px] text-text-sub">{f.codec}</div>
      <div className="text-[14px] text-text-main">{f.size}</div>
      <div className="flex items-center gap-1.5 min-w-0">
        {f.warn && (
          <span
            title={f.warnText}
            className="shrink-0 inline-flex items-center gap-1 text-[12px] text-warn cursor-help"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 8v5m0 4v.5M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <span className="truncate max-w-[180px]">{f.warnText}</span>
          </span>
        )}
      </div>
      <div className="flex justify-end pr-1">
        {hover && (
          <Button
            size="sm"
            onClick={() => onDownload(f)}
            onMouseEnter={(e) => show(e.currentTarget, t("dl.formatDownloadTip"))}
          >
            <Icon d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" size={13} />
            {t("dl.downloadBtn")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ============ 下载池任务行 ============ */
function DlRow({
  t,
  drag,
  onPause,
  onResume,
  onRestart,
  onDelete,
  onCtx,
  onRowClick,
  onMode,
  selected,
}: {
  t: DlTask;
  onCtx: (e: React.MouseEvent, t: DlTask) => void;
  drag?: {
    isDragging: boolean;
    draggingTop: number;
    draggingLeft: number;
    draggingWidth: number;
    deltaY: number;
    isInsertBefore: boolean;
    isInsertAfter: boolean;
    onMouseDown?: (e: React.MouseEvent) => void;
  };
  onRowClick?: (t: DlTask, e: React.MouseEvent) => void;
  onMode?: (t: DlTask, m: string) => void;
  selected?: boolean;
  onPause?: (t: DlTask) => void;
  onResume?: (t: DlTask) => void;
  onRestart?: (t: DlTask) => void;
  onDelete?: (e: React.MouseEvent, t: DlTask) => void;
}) {
  const pct = t.total > 0 ? Math.min(100, (t.got / t.total) * 100) : 0;
  const show = useTip();
  const { t: translate } = useI18n();
  const dlModes = useMemo(() => getDlModes(translate), [translate]);
  const isDownloading = t.status === "downloading" || t.status === "parsing";

  const statusText: Record<string, string> = {
    downloading: translate("dl.status.downloading"),
    parsing: translate("dl.status.parsing"),
    merging: translate("dl.status.merging"),
    waiting: translate("dl.status.waiting"),
    paused: translate("dl.status.paused"),
    done: translate("dl.status.done"),
    failed: translate("dl.status.failed"),
  };

  const baseBg =
    t.status === "done"
      ? "bg-lavender-row"
      : t.status === "failed"
        ? "bg-amber-row"
        : "bg-card";
  const bg = selected ? "bg-selected-row" : baseBg;

  /* 行内容（进度条层 + 信息 grid），浮行与占位共用 */
  const inner = (
    <>
      {/* 下载中：行底色进度（淡蓝，与压缩行一致） */}
      {isDownloading && (
        <div
          className="absolute inset-y-0 left-0 bg-brand-500/25 transition-[width] duration-500 pointer-events-none"
          style={{ width: `${pct}%` }}
        />
      )}

      <div
        className="relative grid grid-cols-[1fr_125px_75px_90px_130px_120px] items-center h-[62px] px-3 gap-2"
        onContextMenu={(e) => onCtx(e, t)}
      >
        {/* 文件名（溢出隐藏，tooltip 完整名） */}
        <div className="min-w-0" onMouseEnter={(e) => show(e.currentTarget, t.name)}>
          <div className="text-[15px] text-text-main truncate">{t.name}</div>
          <div className="text-[12px] text-text-sub mt-0.5">{statusText[t.status]}</div>
        </div>

        {/* 大小 */}
        <div className="text-[14px] text-text-sub tabular-nums">
          {fmtSize(t.got)} / {fmtSize(t.total)}
        </div>

        {/* 进度百分比 */}
        <div className="text-[14px] font-semibold text-brand-700 dark:text-brand-300 tabular-nums">
          {t.status === "downloading"
            ? `${Math.round(pct)}%`
            : t.status === "done" || t.status === "merging"
              ? "100%"
              : "—"}
        </div>

        {/* 速度 */}
        <div className="text-[14px] text-text-sub tabular-nums">
          {t.status === "downloading" || t.status === "merging"
            ? typeof t.speed === "string"
              ? t.speed
              : fmtSpeed(t.speed)
            : "—"}
        </div>

        {/* 压缩模式：默认不压缩；选了模式则下载完成后自动入压缩队列（任何状态都可改）
            底色紫色色阶：压缩程度越深色越深（画质优先最浅 → AV1 最深，30% 透明度品牌紫） */}
        <div
          className="min-w-0"
          onMouseEnter={(e) => show(e.currentTarget, t.compressMode && t.compressMode !== "none" ? translate("dl.modeTipAuto") : translate("dl.modeTipManual"))}
        >
          <Select
            value={t.compressMode ?? "none"}
            onChange={(m) => onMode?.(t, m)}
            options={dlModes}
            disabled={t.status === "done" && Boolean(t.compressMode && t.compressMode !== "none")}
            tint={MODE_TINTS[t.compressMode ?? ""] ?? ""}
            className="w-full"
          />
        </div>

        {/* 操作（内容层在进度条之上，不被遮挡） */}
        <div className="flex items-center justify-end gap-1">
          {(t.status === "downloading" || t.status === "parsing") && (
            <IconBtn tip={translate("dl.pause")} onClick={() => onPause?.(t)}>
              <Icon d="M10 4v16M14 4v16" size={18} />
            </IconBtn>
          )}
          {t.status === "paused" && (
            <IconBtn tip={translate("dl.resume")} onClick={() => onResume?.(t)}>
              <Icon d="M8 5v14l11-7z" size={18} />
            </IconBtn>
          )}
          {t.status === "failed" && (
            <IconBtn tip={translate("dl.retry")} onClick={() => onRestart?.(t)}>
              <Icon d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14.9-2M4 15a8 8 0 0 0 14.9 2" size={18} />
            </IconBtn>
          )}
          {t.status === "done" && (
            <>
              <IconBtn tip={translate("dl.openFile")} onClick={() => t.path && tryOpen(t.path, "dl-row-open")}>
                <Icon d="M14 4h6v6m0-6L9 15m11-11v6" size={18} />
              </IconBtn>
              <IconBtn tip={translate("dl.openDir")} onClick={() => t.path && tryReveal(t.path, "dl-row-reveal")}>
                <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={18} />
              </IconBtn>
            </>
          )}
          <IconBtn
            tip={translate("dl.remove")}
            onClick={(e) => onDelete?.(e, t)}
            className="hover:text-danger hover:bg-danger/10"
          >
            <Icon d="M3 6h18M8 6V4h8v2m1 0 1 14H6L5 6m5 5v6m4-6v6" size={18} />
          </IconBtn>
        </div>
      </div>
    </>
  );

  /* 拖起时：原位置留虚线占位（列表高度恒定，底部完成行不跳动）+ fixed 浮行跟手 */
  if (drag?.isDragging) {
    return (
      <>
        <div
          className="relative mb-1.5 rounded-lg border-2 border-dashed border-brand-300/60 bg-brand-50/40"
          style={{ height: 62 }}
        />
        <div
          className="fixed z-50 rounded-lg overflow-hidden shadow-xl ring-2 ring-brand-400/70 opacity-95 scale-[1.02] bg-card pointer-events-none"
          style={{ top: drag.draggingTop, left: drag.draggingLeft, width: drag.draggingWidth }}
        >
          {inner}
        </div>
      </>
    );
  }

  return (
    <div
      data-task-row="true"
      onMouseDown={drag?.onMouseDown}
      onClick={
        onRowClick
          ? (e) => {
              if ((e.target as HTMLElement).closest("button, select, input, a")) return;
              onRowClick(t, e);
            }
          : undefined
      }
      className={`relative rounded-lg border border-border-soft mb-1.5 overflow-hidden ${bg}
        ${drag?.onMouseDown ? "cursor-grab active:cursor-grabbing select-none" : ""}
        ${selected ? "ring-1 ring-brand-400/60" : ""}
        transition-transform duration-150 ease-out
        ${drag?.isInsertBefore ? "shadow-[0_-3px_0_0_#005CE6]" : ""}
        ${drag?.isInsertAfter ? "shadow-[0_3px_0_0_#005CE6]" : ""}
        transition-shadow`}
      style={{ transform: `translateY(${drag?.deltaY ?? 0}px)` }}
    >
      {inner}
    </div>
  );
}

/* ============ 下载面板 ============ */
export function DownloadPanel({
  dlWorkers = 3,
  dlDir = "",
  onActivityChange,
  onDoneCountChange,
  onCompress,
  active = true,
}: {
  dlWorkers?: number;
  dlDir?: string;
  onActivityChange?: (busy: boolean, fail: boolean, running: number, queued: number) => void;
  onDoneCountChange?: (count: number) => void;
  /* 下载完成且选了压缩模式 → 自动加入压缩队列队尾（App 接线到 CompressPanel.addDownloadedTask） */
  onCompress?: (path: string, name: string, mode: string) => void;
  /* 当前是否为可见面板：隐藏面板不响应 Delete/Backspace（多选删除只作用于当前面板） */
  active?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [probeState, setProbeState] = useState<"idle" | "probing" | "done">("idle");
  const [formats, setFormats] = useState<DlFormat[]>([]);
  const [tasks, setTasks] = useState<DlTask[]>([]);
  const [fileOver, setFileOver] = useState(false);
  const [probeErr, setProbeErr] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; t: DlTask } | null>(null);
  /* 垃圾桶删除菜单（光标旁两行：仅移出列表 / 移出列表并删除文件） */
  const [delMenu, setDelMenu] = useState<{ x: number; y: number; t: DlTask } | null>(null);
  /* 批量移出确认：选中含未完成任务时弹提示（将删临时下载缓存，已完成保留） */
  const [confirmRemove, setConfirmRemove] = useState<{ ids: string[]; n: number } | null>(null);
  /* 多选（Ctrl/Shift；运行中不可选；Delete 或右键批量移出） */
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  /* 格式列表表头排序：分辨率/格式/编码/大小 可点击，同列点击翻转方向 */
  const [sortKey, setSortKey] = useState<{ key: "res" | "ext" | "codec" | "size"; dir: 1 | -1 }>({ key: "res", dir: 1 });
  const show = useTip();
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const engine = useEngine();
  /* tasks 镜像：引擎事件回调里读最新任务（判断 done 任务的压缩模式） */
  const tasksRef = useRef<DlTask[]>([]);
  tasksRef.current = tasks;

  /* 智能剪贴板感知：自动识别复制的视频 URL 并提示一键填入 */
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const clipDismissedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const checkClipboard = async () => {
      try {
        if (!navigator.clipboard?.readText) return;
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) return;
        const extracted = extractUrl(text);
        if (extracted && extracted !== url && extracted !== clipDismissedRef.current) {
          setClipUrl(extracted);
        }
      } catch {
        /* clipboard 权限受限时忽略 */
      }
    };
    window.addEventListener("focus", checkClipboard);
    void checkClipboard();
    return () => window.removeEventListener("focus", checkClipboard);
  }, [active, url]);

  /* 全局 Ctrl+V 快捷嗅探：焦点不在输入框时按下 Ctrl+V 自动填入并聚焦 */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
          return;
        }
        void (async () => {
          try {
            const text = await navigator.clipboard.readText();
            const extracted = extractUrl(text) || text.trim();
            if (extracted) {
              setUrl(extracted);
              inputRef.current?.focus();
            }
          } catch {
            /* ignore */
          }
        })();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  /* 排序辅助：分辨率数字 / 大小字节数 */
  const resNum = (s: string) => {
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  };
  const sizeBytes = (s: string) => {
    const m = s.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
    if (!m) return -1;
    const n = parseFloat(m[1]);
    const u = (m[2] || "B").toUpperCase();
    const mult: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
    return Math.round(n * (mult[u] || 1));
  };
  const sortedFormats = useMemo(() => {
    const arr = [...formats];
    const { key, dir } = sortKey;
    arr.sort((a, b) => {
      if (key === "res") return (resNum(a.res) - resNum(b.res)) * dir;
      if (key === "size") return (sizeBytes(a.size) - sizeBytes(b.size)) * dir;
      return a[key].localeCompare(b[key]) * dir;
    });
    return arr;
  }, [formats, sortKey]);
  const toggleSort = (key: "res" | "ext" | "codec" | "size") =>
    setSortKey((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  /* 行右键：右键行不在选中集合内 → 重置选中为该行（菜单按右键行提供单选选择）；
     右键行在选中集合内 → 保持多选，提供批量移出 */
  const openCtx = (e: React.MouseEvent, t: DlTask) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到 window（否则同一次右键会把刚渲染的菜单秒关）
    if (!sel.has(t.id)) {
      setSel(new Set([t.id]));
      setAnchor(t.id);
    }
    setCtx({ x: e.clientX, y: e.clientY, t });
  };
  const ctxItems = (): CtxItem[] => {
    if (!ctx) return [];
    const { t: task } = ctx;
    /* 多选（右键行在选中集合内）：只提供批量移出——不提供打开文件/目录，
       不同文件所属目录不同，多选打开会弹出一堆资源管理器 */
    if (sel.size > 1 && sel.has(task.id)) {
      return [{ label: t("dl.removeMulti", { count: sel.size }), onClick: removeSelected }];
    }
    const p = task.path || "";
    const items: CtxItem[] = [];
    /* 单选：已完成 = 打开文件 + 打开目录 + 移出队列；非完成（含进行中）= 打开目录 + 移出队列
       （进行中移出走 removeOne 的警告：未完成将删临时缓存） */
    if (task.status === "done" && p) {
      items.push({ label: t("dl.openFile"), onClick: () => tryOpen(p, "dl-open") });
    }
    items.push({
      label: t("dl.openDir"),
      onClick: () => {
        const dir = p ? p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"))) : dlDir;
        // 完成态：定位到文件；非完成态（部分/临时文件可能不存在）：打开目录本身
        if (task.status === "done" && p) tryReveal(p, "dl-reveal");
        else if (dir) tryOpen(dir, "dl-open-dir");
      },
    });
    items.push({ label: t("cmp.removeFromList"), onClick: () => removeOne(task) });
    return items;
  };

  /* 单选/多选（对齐压缩面板）：运行中不可选；Ctrl 切换、Shift 范围、普通点击 toggle */
  const handleRowClick = (t: DlTask, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (t.status === "downloading" || t.status === "parsing" || t.status === "merging") return; // 运行中不可选
    if (e.ctrlKey || e.metaKey) {
      setSel((prev) => {
        const next = new Set(prev);
        if (next.has(t.id)) next.delete(t.id);
        else next.add(t.id);
        return next;
      });
      setAnchor(t.id);
    } else if (e.shiftKey) {
      // 范围选择：按展示顺序（下载中/合并 → 等待/暂停/失败 → 完成）从锚点跨到当前行
      const order = [...activeTasks, ...sortableTasks, ...doneTasks].map((x) => x.id);
      const ai = anchor ? order.indexOf(anchor) : -1;
      const ti = order.indexOf(t.id);
      if (ai >= 0 && ti >= 0) {
        const [lo, hi] = ai < ti ? [ai, ti] : [ti, ai];
        setSel(new Set(order.slice(lo, hi + 1).filter((id) => id !== undefined)));
      } else {
        setSel(new Set([t.id]));
        setAnchor(t.id);
      }
    } else {
      // 普通点击：已选中该行 → 取消选中（再点一下取消）；未选中 → 单选
      setSel((prev) => {
        if (prev.size === 1 && prev.has(t.id)) {
          setAnchor(null);
          return new Set();
        }
        return new Set([t.id]);
      });
      setAnchor(t.id);
    }
  };

  /* 移出执行（ids 可为多选集合或单选）：完成态保留文件（仅移出列表）；非完成态引擎清理临时缓存/进程（dl_remove）。
     注：进行中（下载中/解析中/合并中）也允许移出——用户确认过"可以移出，只要挂警告"；此前过滤进行中状态导致确认后空转 */
  const doRemoveIds = (ids: string[]) => {
    ids.forEach((id) => {
      const x = tasks.find((t) => t.id === id);
      if (x && x.status !== "done" && x.taskId != null) {
        void engine.call("dl_remove", { task_id: x.taskId });
      }
    });
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
    setSel(new Set());
    setConfirmRemove(null);
  };
  /* 批量移出入口：选中含"有下载产物"的任务（下载中/解析中/合并/暂停/失败）→ 弹提示确认（将删临时缓存，已完成保留）；
     等待下载（无产物）与已完成 → 直接移出 */
  const removeSelected = () => {
    const ids = [...sel];
    if (ids.length === 0) return;
    const hasArtifact = ids.filter((id) => {
      const x = tasks.find((t) => t.id === id);
      return x && x.status !== "done" && x.status !== "waiting";
    }).length;
    if (hasArtifact > 0) setConfirmRemove({ ids, n: hasArtifact });
    else doRemoveIds(ids);
  };
  /* 单选移出（右键"移出队列"）：有下载产物的状态 → 弹警告（将删临时缓存）；等待下载/已完成 → 直接移出 */
  const removeOne = (t: DlTask) => {
    if (t.status !== "done" && t.status !== "waiting") setConfirmRemove({ ids: [t.id], n: 1 });
    else doRemoveIds([t.id]);
  };

  /* Delete / Backspace 键删除选中（仅当前可见面板；焦点不在输入框时） */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return;
      if (sel.size === 0) return;
      e.preventDefault();
      removeSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sel, tasks]);

  /* 引擎格式 → UI 格式行 */
  const toDlFormat = (f: Record<string, unknown>): DlFormat => {
    const vc = String(f.vcodec ?? "");
    const ac = String(f.acodec ?? "");
    let codec = t("dl.unknown");
    if (vc.includes("av1")) codec = "AV1";
    else if (vc.includes("vp")) codec = "VP9";
    else if (vc.includes("avc") || vc.includes("h264")) codec = "H.264";
    else if (vc === "none") codec = t("dl.audioOnly");
    const size = (f.size as number) ?? 0;
    const note = String(f.note ?? "");
    // 优先显示 "1080p" 式分辨率，其次 "1920x1080"
    const res = /^\d+[pk]$/i.test(note) ? note : String(f.res ?? f.note ?? "");
    return {
      id: String(f.id ?? ""),
      res,
      codec,
      size: size ? fmtSize(size) : t("dl.unknown"),
      ext: String(f.ext ?? "mp4"),
      // YouTube 等 DASH 站点：视频流与音频流分离，videoOnly 格式下载时必须拼 +bestaudio 才有声音
      ...(vc !== "none" && ac === "none" ? { videoOnly: true } : {}),
      ...(vc.includes("av1") ? { warn: true, warnText: t("dl.av1Warn") } : {}),
    };
  };

  /* 排序分区（固定顺序，完成态恒沉底）：
     ① 下载中/合并音轨 固定顶部，不可拖
     ② 等待/暂停/失败 可拖拽排序（有并行数，优先级有意义）
     ③ 完成 固定底部，不可拖 */
  const activeTasks = tasks.filter(
    (t) => t.status === "downloading" || t.status === "merging" || t.status === "parsing",
  );
  const sortableTasks = tasks.filter(
    (t) => t.status === "waiting" || t.status === "paused" || t.status === "failed",
  );
  const doneTasks = tasks.filter((t) => t.status === "done");

  /* 下载池拖拽排序（自定义指针实现：拎起浮行 + 其他行平滑挤开）
     仅等待/暂停可拖；下载失败的行不可拖（重新下载进入等待队列后才能拖）；
     可拖行按下未拖拽（<5px）视为点击 → 走多选逻辑 */
  const dragSort = useDragSort<DlTask>(
    sortableTasks,
    DL_ROW_H,
    (t) => t.status !== "failed",
    (next) => {
      setTasks([...activeTasks, ...next, ...doneTasks]);
    },
    (id, e) => {
      const t = sortableTasks.find((x) => x.id === id);
      if (t) handleRowClick(t, e);
    },
  );



  /* 探测：引擎直探优先（-J → -F 兜底） */
  const probe = async () => {
    const u = url.trim();
    if (!u) return;
    setProbeState("probing");
    setFormats([]);
    setProbeErr("");
    try {
      const r = (await engine.call("probe", { url: u, timeout: 90 })) as {
        ok: boolean;
        formats?: Record<string, unknown>[];
        title?: string;
        error?: string;
      };
      if (!r.ok || !r.formats?.length) {
        setProbeState("idle");
        setProbeErr(String(r.error || t("dl.errNone")));
        return;
      }
      // 过滤纯音频流（vcodec=none 且无有效分辨率），保留所有视频流（包含 vcodec 为 unknown 的通用媒体流）
      const fmts = r.formats.filter((f) => String(f.vcodec) !== "none" || Boolean(f.res && f.res !== "none"));
      if (!fmts.length) {
        setProbeState("idle");
        setProbeErr(t("dl.errAudioOnly"));
        return;
      }
      setFormats(fmts.map(toDlFormat));
      setProbeState("done");
    } catch (e) {
      setProbeState("idle");
      setProbeErr(String(e instanceof Error ? e.message : e));
    }
  };

  /* 打开极简登录/嗅探窗口（Chrome/Edge --app 模式，无任何导航栏干扰，极度简约） */
  const openLoginWindow = async () => {
    const u = url.trim();
    try {
      await engine.call("open_login", { url: u });
    } catch (e) {
      console.error("Failed to open login window", e);
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(extractUrl(text) || text.trim());
    } catch {
      /* clipboard 权限失败时用户手动粘贴 */
    }
  };

  const cancelProbe = () => {
    setProbeState("idle");
    setFormats([]);
  };

  /* 点格式 → 引擎创建下载任务（事件流驱动进度） */
  const addTask = (f: DlFormat) => {
    void engine.call("dl_add", {
      url: url.trim(),
      // video-only 流（YouTube DASH）自动合并最佳音频，否则下载出来没声音
      fmt_id: f.videoOnly ? `${f.id}+bestaudio/best` : f.id,
      out_dir: dlDir,
      title: "",
      size: 0,
      workers: dlWorkers,
    });
  };

  /* 引擎 dl 事件 → 任务列表（进度/状态/完成） */
  useEffect(() => {
    return engine.on((ev) => {
      if (ev.ev !== "dl") return;
      const e = ev as Record<string, unknown>;
      const tid = Number(e.task_id);
      if (!Number.isFinite(tid)) return;
      const state = String(e.state) as DlTask["status"];
      const name = String(e.title ?? "");
      const path = String(e.out ?? "");
      const got = Number(e.got ?? 0);
      const total = Number(e.total ?? 0);
      const speed = String(e.speed ?? "");
      if (String(e.state) === "removed") {
        setTasks((prev) => prev.filter((t) => t.taskId !== tid));
        return;
      }
      /* 下载完成：若该任务选了压缩模式且有输出路径 → 自动加入压缩队列队尾
         （读 tasksRef 最新镜像；onCompress 由 App 接线到 CompressPanel） */
      if (state === "done") {
        const cur = tasksRef.current.find((t) => t.taskId === tid);
        if (cur && cur.compressMode && cur.compressMode !== "none" && path) {
          onCompress?.(path, name || cur.name, cur.compressMode);
        }
      }
      setTasks((prev) => {
        const existing = prev.find((t) => t.taskId === tid);
        if (!existing) {
          if (state === "failed" || state === "done" || (state as string) === "removed") return prev;
          return [...prev, { id: `dl${tid}`, taskId: tid, name: name || `任务 #${tid}`, path, status: state, got, total, speed, compressMode: "none" }];
        }
        return prev.map((t) => (t.taskId === tid ? { ...t, name: name || t.name, path: path || t.path, status: state, got, total, speed } : t));
      });
    });
  }, [engine, onCompress]);

  /* 暂停：引擎杀进程保留断点，本地乐观更新 */
  const pause = (t: DlTask) => {
    if (t.taskId != null) void engine.call("dl_pause", { task_id: t.taskId });
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: "paused" as const, speed: "" } : x)));
  };

  /* 恢复：排入等待队列尾（断点续传） */
  const resume = (t: DlTask) => {
    if (t.taskId != null) void engine.call("dl_resume", { task_id: t.taskId });
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: "waiting" as const, speed: "" } : x)));
  };

  /* 失败重新下载：重置进度排入等待队列尾 */
  const restart = (t: DlTask) => {
    if (t.taskId != null) void engine.call("dl_retry", { task_id: t.taskId });
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: "waiting" as const, got: 0, speed: "" } : x)));
  };

  /* 删除：引擎清理临时缓存/进程；已完成的保留输出文件 */
  const removeKeep = (t: DlTask) => {
    if (t.taskId != null) void engine.call("dl_remove", { task_id: t.taskId });
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
  };
  /* 移出并删除文件：完成态连同已下载文件一起删除（引擎 delete_file=true） */
  const removeDelete = (t: DlTask) => {
    if (t.taskId != null) void engine.call("dl_remove", { task_id: t.taskId, delete_file: true });
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
  };
  /* 垃圾桶删除：完成态 = 弹两行菜单（仅移出列表 / 移出列表并删除文件）；
     未完成态 = 直接移出并删产物（有临时缓存的状态挂警告确认，等待下载无产物直接移出） */
  const openDelMenu = (e: React.MouseEvent, t: DlTask) => {
    e.stopPropagation();
    setDelMenu({ x: e.clientX, y: e.clientY, t });
  };
  const onDeleteClick = (e: React.MouseEvent, t: DlTask) => {
    if (t.status === "done") openDelMenu(e, t);
    else removeOne(t);
  };
  const delItems = (): CtxItem[] => {
    const tItem = delMenu?.t;
    if (!tItem) return [];
    const done = tItem.status === "done";
    return [
      { label: t("dl.removeListOnly"), onClick: () => removeKeep(tItem) },
      {
        label: done ? t("dl.removeAndDelete") : t("dl.removeCacheOnly"),
        onClick: () => removeDelete(tItem),
        danger: true,
      },
    ];
  };

  /* 行压缩模式：默认"不压缩"，选了模式则下载完成后自动入压缩队列 */
  const setMode = (id: string, m: string) =>
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        // 若任务已下载完成且之前是"不压缩"，此时用户补选了压缩模式，则立即入压缩队列
        if (t.status === "done" && (!t.compressMode || t.compressMode === "none") && m !== "none" && t.path) {
          onCompress?.(t.path, t.name, m);
        }
        return { ...t, compressMode: m };
      })
    );

  const doneCount = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);
  const doneCountRef = useRef(onDoneCountChange);
  doneCountRef.current = onDoneCountChange;
  useEffect(() => {
    doneCountRef.current?.(doneCount);
  }, [doneCount]);

  /* 活动状态上报（侧栏状态灯：有运行任务=绿闪，有失败=黄；running=进行中任务数，queued=等待数） */
  const actRef = useRef(onActivityChange);
  actRef.current = onActivityChange;
  useEffect(() => {
    const busy = tasks.some((t) => t.status === "downloading" || t.status === "merging");
    const fail = tasks.some((t) => t.status === "failed");
    const running = tasks.filter((t) => ["downloading", "parsing", "paused", "merging"].includes(t.status)).length;
    const queued = tasks.filter((t) => t.status === "waiting").length;
    actRef.current?.(busy, fail, running, queued);
  }, [tasks]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶部：URL + 探测 */}
      <div className="shrink-0 p-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && probe()}
              onPaste={(e) => {
                /* 右键/快捷键粘贴：自动提取 URL，清洗分享文案 */
                e.preventDefault();
                const text = e.clipboardData.getData("text");
                setUrl(extractUrl(text) || text.trim());
              }}
              onContextMenu={(e) => {
                /* 右键单击地址栏 = 立即粘贴（自动提取 URL），不弹系统菜单 */
                e.preventDefault();
                void (async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    setUrl(extractUrl(text) || text.trim());
                  } catch {
                    /* clipboard 权限失败时忽略 */
                  }
                })();
              }}
              placeholder={t("dl.placeholder")}
              className="w-full h-10 pl-3.5 pr-12 rounded-lg border border-border-soft bg-card text-[15px] text-text-main
                placeholder:text-text-sub/60 focus:outline-2 focus:outline-brand-500 focus:border-brand-300"
            />
            <IconBtn
              tip={t("dl.pasteTip")}
              onClick={paste}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8"
            >
              {/* 剪贴板 + 向下箭头：把剪贴板内容放入地址栏 */}
              <Icon d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm5 5v6m0 0 3-3m-3 3-3-3" size={16} />
            </IconBtn>
          </div>

          {/* 探测按钮 / 探测状态（可点击取消） */}
          {probeState === "probing" ? (
            <button
              onClick={cancelProbe}
              onMouseEnter={(e) => show(e.currentTarget, t("dl.probingTip"))}
              className="flex items-center gap-2 h-10 px-4 rounded-lg bg-brand-50 border border-brand-300 text-brand-700
                text-[14px] font-medium cursor-pointer hover:bg-brand-100 transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" className="ez-spin" style={{ color: "#005CE6" }}>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              {t("dl.probing")}
            </button>
          ) : (
            <Button onClick={probe} disabled={!url.trim()} className="h-10 px-4 text-[14px]">
              <Icon d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" size={15} />
              {t("dl.probeBtn")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[12px] text-text-sub">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
          {t("dl.hint")}
        </div>

        {/* 智能剪贴板感知提示条 */}
        {clipUrl && (
          <div className="mt-2.5 px-3 py-2 bg-brand-50/80 dark:bg-brand-950/40 border border-brand-200/80 dark:border-brand-800/60 rounded-lg flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2 text-[13px] text-brand-900 dark:text-brand-200 truncate mr-2 min-w-0">
              <span className="shrink-0 text-[14px]">📋</span>
              <span className="font-medium text-text-sub shrink-0">{t("dl.clipDetected")}</span>
              <span className="font-mono text-brand-700 dark:text-brand-300 bg-white/90 dark:bg-card/90 px-2 py-0.5 rounded border border-brand-200/60 dark:border-brand-700/60 truncate max-w-[380px]">
                {clipUrl}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => {
                  setUrl(clipUrl);
                  setClipUrl(null);
                  inputRef.current?.focus();
                }}
              >
                {t("dl.clipApply")}
              </Button>
              <button
                onClick={() => {
                  clipDismissedRef.current = clipUrl;
                  setClipUrl(null);
                }}
                className="text-text-sub hover:text-text-main text-[13px] px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 格式列表（常驻区域：未探测时为空态提示；超 300px 内容区滚动，表头固定） */}
      <div className="shrink-0 px-4 pb-2">
        <div className="rounded-xl border border-border-soft bg-card overflow-hidden">
          <div className="grid grid-cols-[100px_75px_85px_105px_1fr_80px] items-center h-9 px-3 bg-surface text-[12px] text-text-sub font-medium">
            <button className="flex items-center gap-1 cursor-pointer hover:text-text-main" onClick={() => toggleSort("res")}>
              {t("dl.col.res")}
              <span className="text-[10px] leading-none">{sortKey.key === "res" ? (sortKey.dir === 1 ? "▲" : "▼") : "⇅"}</span>
            </button>
            <button className="flex items-center gap-1 cursor-pointer hover:text-text-main" onClick={() => toggleSort("ext")}>
              {t("dl.col.ext")}
              <span className="text-[10px] leading-none">{sortKey.key === "ext" ? (sortKey.dir === 1 ? "▲" : "▼") : "⇅"}</span>
            </button>
            <button className="flex items-center gap-1 cursor-pointer hover:text-text-main" onClick={() => toggleSort("codec")}>
              {t("dl.col.codec")}
              <span className="text-[10px] leading-none">{sortKey.key === "codec" ? (sortKey.dir === 1 ? "▲" : "▼") : "⇅"}</span>
            </button>
            <button className="flex items-center gap-1 cursor-pointer hover:text-text-main" onClick={() => toggleSort("size")}>
              {t("dl.col.size")}
              <span className="text-[10px] leading-none">{sortKey.key === "size" ? (sortKey.dir === 1 ? "▲" : "▼") : "⇅"}</span>
            </button>
            <div>{t("dl.col.tip")}</div>
            <div className="text-right pr-1">{t("dl.col.action")}</div>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {formats.length === 0 ? (
              <div className="flex items-center justify-center min-h-[56px] text-[13px] text-text-sub/70 gap-1.5 p-2">
                {probeState === "probing" ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" className="ez-spin" style={{ color: "#005CE6" }}>
                      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    {t("dl.parsingFormats")}
                  </>
                ) : probeErr ? (
                  /authentication|cookie|403|forbidden|blocked|login/i.test(probeErr) ? (
                    <div className="w-full flex flex-col items-center text-center py-2 px-3 my-0.5 rounded-lg bg-surface/50 border border-border-soft/60">
                      <div className="flex items-center gap-1.5 text-brand-600 dark:text-brand-400 font-medium text-[13px]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        <span>{t("dl.authRequiredTitle")}</span>
                      </div>
                      <p className="mt-1 text-[12px] text-text-sub max-w-[580px] leading-relaxed">
                        {t("dl.authRequiredDesc")}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          size="sm"
                          onClick={openLoginWindow}
                          className="h-7 px-3 text-[12px] gap-1"
                        >
                          <Icon d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" size={13} />
                          {t("dl.openLoginBtn")}
                        </Button>
                        <button
                          onClick={probe}
                          className="h-7 px-3 rounded-lg border border-border-soft bg-card hover:bg-surface text-text-main text-[12px] font-medium transition-colors cursor-pointer"
                        >
                          {t("dl.retryProbeBtn")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-warn text-center px-4 leading-relaxed">{t("dl.probeFailed", { err: probeErr })}</span>
                  )
                ) : (
                  <>{t("dl.formatsPlaceholder")}</>
                )}
              </div>
            ) : (
              <div className="py-1">
                {sortedFormats.map((f) => (
                  <FormatRow key={f.id} f={f} onDownload={addTask} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 下载池 */}
      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        {/* 标题行固定高度（h-6）：选中注释/删除按钮出现与否都不改变高度，列表不跳动 */}
        <div className="flex items-center justify-between mb-2 shrink-0 h-6 overflow-hidden">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-[14px] font-semibold text-text-main whitespace-nowrap">
              {t("dl.poolTitle")}{" "}
              <span className="text-text-sub font-normal text-[13px]">
                {t("dl.poolSummary", { count: tasks.length, done: doneCount })}
              </span>
            </div>
            {sel.size > 0 && (
              <div className="text-[12px] text-text-sub whitespace-nowrap">{t("dl.poolSelectTip")}</div>
            )}
          </div>
          {sel.size > 0 ? (
            <button onClick={removeSelected} className="text-[13px] font-medium text-danger hover:underline shrink-0">
              {t("dl.poolRemoveSelected", { count: sel.size })}
            </button>
          ) : (
            <div className="text-[12px] text-text-sub whitespace-nowrap">{t("dl.poolDragTip")}</div>
          )}
        </div>
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setFileOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false);
          }}
          onDrop={(e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
              e.preventDefault();
              setFileOver(false);
              setTasks((prev) => [
                ...prev,
                ...Array.from(files).map((f, i) => ({
                  id: `d${Date.now()}${i}`,
                  name: f.name || `拖入文件-${i + 1}`,
                  status: "downloading" as const,
                  got: 0,
                  total: 0,
                  speed: 5.4 * 1024 ** 2,
                  compressMode: "none",
                })),
              ]);
              return;
            }
            const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list");
            if (text.trim()) {
              e.preventDefault();
              setTasks((prev) => [
                ...prev,
                {
                  id: `d${Date.now()}`,
                  name: text.trim().split("/").pop() || text.trim(),
                  status: "downloading" as const,
                  got: 0,
                  total: 0,
                  speed: 5.4 * 1024 ** 2,
                  compressMode: "none",
                },
              ]);
            }
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSel(new Set()); // 点击列表空白取消选中
          }}
          className={`relative flex-1 min-h-0 overflow-y-auto pr-1 rounded-lg transition-colors ${
            fileOver ? "bg-brand-50 ring-2 ring-brand-400/70 ring-inset" : ""
          }`}
        >
          {tasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center select-none">
              {/* 现代通用流媒体矢量抽象插画 (放大版) */}
              <div className="relative w-48 h-48 mb-6 flex items-center justify-center">
                {/* 柔和呼吸渐变底环 */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-brand-500/20 via-blue-400/15 to-purple-400/20 blur-2xl dark:opacity-30" />

                {/* 悬浮主卡片 */}
                <div className="relative w-36 h-30 bg-card/95 backdrop-blur-md rounded-2xl border border-border-soft dark:border-slate-700/80 shadow-xl p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-brand-500" />
                      <span className="w-2 h-2 rounded-full bg-blue-400" />
                      <span className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-1 h-3 rounded-full bg-brand-500/60" />
                      <span className="w-1 h-5 rounded-full bg-brand-600 dark:bg-brand-400" />
                      <span className="w-1 h-2.5 rounded-full bg-brand-400/50" />
                    </div>
                  </div>

                  <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-brand-600 to-indigo-700 text-white flex items-center justify-center shadow-lg shadow-brand-500/25">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>

                  <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-brand-500 to-indigo-500 h-full w-2/3 rounded-full" />
                  </div>
                </div>

                {/* 右上角流媒体链接节点微标 */}
                <div className="absolute -top-1 -right-1 w-10 h-10 rounded-2xl bg-card border border-border-soft dark:border-slate-700/80 shadow-md flex items-center justify-center text-brand-600 dark:text-brand-300">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </div>

                {/* 左下角高清规格标签 */}
                <div className="absolute -bottom-1 -left-1 px-2 py-0.5 rounded-lg bg-card border border-border-soft dark:border-slate-700/80 shadow-xs text-[11px] font-bold tracking-wider text-indigo-700 dark:text-indigo-300 font-mono">
                  4K HDR
                </div>
              </div>

              {/* 标题 */}
              <h3 className="text-[18px] font-bold text-text-main tracking-tight">
                {t("dl.emptyTitle")}
              </h3>

              {/* 纯文本中性合规胶囊 Tag（已去掉“广泛支持：”前缀） */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 max-w-lg">

                <span
                  onClick={() => {
                    setUrl("https://www.youtube.com/watch?v=");
                    inputRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-full bg-card hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-border-soft hover:border-brand-300 dark:hover:border-brand-500 text-[12.5px] text-text-main font-medium shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                  YouTube
                </span>

                <span
                  onClick={() => {
                    setUrl("https://www.bilibili.com/video/");
                    inputRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-full bg-card hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-border-soft hover:border-brand-300 dark:hover:border-brand-500 text-[12.5px] text-text-main font-medium shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                  Bilibili 哔哩哔哩
                </span>

                <span
                  onClick={() => {
                    setUrl("https://twitter.com/");
                    inputRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-full bg-card hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-border-soft hover:border-brand-300 dark:hover:border-brand-500 text-[12.5px] text-text-main font-medium shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-700 dark:bg-slate-300 shrink-0" />
                  X / Twitter
                </span>

                <span
                  onClick={() => {
                    setUrl("https://www.tiktok.com/");
                    inputRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-full bg-card hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-border-soft hover:border-brand-300 dark:hover:border-brand-500 text-[12.5px] text-text-main font-medium shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0" />
                  TikTok 抖音
                </span>

                <span
                  onClick={() => {
                    inputRef.current?.focus();
                  }}
                  className="px-2.5 py-1 rounded-full bg-card hover:bg-slate-100 dark:hover:bg-slate-800/80 border border-border-soft hover:border-brand-300 dark:hover:border-brand-500 text-[12.5px] text-text-main font-medium shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  m3u8 / MP4 直链
                </span>

                <span className="px-2.5 py-1 rounded-full bg-surface border border-border-soft text-[12px] text-text-sub font-medium">
                  {t("dl.emptyTagMore")}
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* 下载中/合并中：固定顶部，不参与拖拽；运行中不可选（不传 selected/onRowClick） */}
              {activeTasks.map((t) => (
                <DlRow
                  key={t.id}
                  t={t}
                  onCtx={openCtx}
                  onPause={pause}
                  onDelete={onDeleteClick}
                  onMode={(x, m) => setMode(x.id, m)}
                />
              ))}
              {/* 等待/暂停/失败：可拖拽排序（独立子容器，坐标从本区顶部算起）；
                  可拖行按下未拖拽视为点击→多选（走 useDragSort 的 onRowClick）；
                  失败行不可拖，直接行 onClick 走多选 */}
              <div ref={dragSort.containerRef} className="relative">
                {sortableTasks.map((t, i) => {
                  const p = dragSort.rowProps(t, i);
                  const draggable = t.status !== "failed";
                  return (
                    <DlRow
                      key={t.id}
                      t={t}
                      onCtx={openCtx}
                      drag={{
                        ...p,
                        onMouseDown: draggable ? (e) => dragSort.onRowMouseDown(e, t.id) : undefined,
                      }}
                      onRowClick={draggable ? undefined : (x, e) => handleRowClick(x, e)}
                      selected={sel.has(t.id)}
                      onResume={resume}
                      onRestart={restart}
                      onDelete={onDeleteClick}
                      onMode={(x, m) => setMode(x.id, m)}
                    />
                  );
                })}
              </div>
              {/* 完成：固定底部，不参与拖拽；可点选/多选 */}
              {doneTasks.map((t) => (
                <DlRow
                  key={t.id}
                  t={t}
                  onCtx={openCtx}
                  onRowClick={(x, e) => handleRowClick(x, e)}
                  selected={sel.has(t.id)}
                  onDelete={onDeleteClick}
                  onMode={(x, m) => setMode(x.id, m)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 行右键菜单（光标位置就近弹出） */}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems()} onClose={() => setCtx(null)} />}

      {/* 垃圾桶删除菜单（光标旁两行：仅移出 / 移出并删除文件或缓存） */}
      {delMenu && <ContextMenu x={delMenu.x} y={delMenu.y} items={delItems()} onClose={() => setDelMenu(null)} />}

      {/* 批量移出提示：含未完成任务 → 告知将删临时缓存（已完成保留） */}
      {confirmRemove && (
        <Dialog open onClose={() => setConfirmRemove(null)} title={t("dl.dlgRemoveTitle")} width={440}>
          <p className="text-[15px] text-text-main leading-relaxed">
            {t("dl.dlgRemoveDesc", { n: confirmRemove.n })}
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              {t("dl.cancel")}
            </Button>
            <Button variant="danger" onClick={() => confirmRemove && doRemoveIds(confirmRemove.ids)}>
              {t("dl.dlgRemoveConfirm")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

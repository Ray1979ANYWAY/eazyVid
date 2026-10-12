import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Button, IconBtn, Icon, Select, Dialog, fmtSize, fmtETA, useTip, ContextMenu, type CtxItem } from "./ui";
import { MODE_TINTS, getCompressModes, type CmpTask } from "../mock";
import { useDragSort } from "../hooks/useDragSort";
import { useEngine } from "../hooks/useEngine";
import { diag } from "../diag";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useI18n, type ResolvedLang } from "../i18n";

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

/* 输出文件路径（与引擎命名一致：源名_compressed.mp4；覆盖模式完成态用 done 事件 out） */
function outPathOf(t: CmpTask, outSame: boolean, outDir: string): string {
  if (t.outPath) return t.outPath;
  if (!t.path) return "";
  const sep = t.path.includes("\\") ? "\\" : "/";
  const last = t.path.lastIndexOf(sep);
  const dir = outSame ? t.path.slice(0, last) : outDir;
  const file = t.path.slice(last + 1).replace(/\.[^./\\]+$/, "");
  return `${dir}${sep}${file}_compressed.mp4`;
}

const ROW_H = 64; // 58px 行高 + 6px 间距

function fmtElapsed(sec: number, lang: ResolvedLang = "zh-CN") {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (lang === "en") {
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
  }
  return m > 0 ? `${m}分${r}秒` : `${r}秒`;
}

/* ============ 压缩任务行 ============ */
function CmpRow({
  t,
  onMode,
  onStop,
  onRestart,
  onTop,
  onDelete,
  onCtx,
  onRowClick,
  selected,
  drag,
}: {
  t: CmpTask;
  onMode: (m: string) => void;
  onStop: (t: CmpTask) => void;
  onRestart: (t: CmpTask) => void;
  onTop: (t: CmpTask) => void;
  onDelete: (t: CmpTask) => void;
  onCtx: (e: React.MouseEvent, t: CmpTask) => void;
  onRowClick?: (t: CmpTask, e: React.MouseEvent) => void;
  selected?: boolean;
  drag?: {
    isDragging: boolean;
    draggingTop: number;
    draggingLeft: number;
    draggingWidth: number;
    deltaY: number;
    isInsertBefore: boolean;
    isInsertAfter: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
  };
}) {
  const show = useTip();
  const { t: tr } = useI18n();
  const isRunning = t.status === "running";
  const pct = t.pct ?? 0;
  const draggable = t.status === "queued";
  const compressModes = useMemo(() => getCompressModes(tr), [tr]);

  const baseBg = isRunning
    ? "bg-card"
    : t.status === "done"
      ? "bg-lavender-row"
      : t.status === "stopped" || t.status === "skipped" || t.status === "failed"
        ? "bg-amber-row"
        : "bg-card";
  const bg = selected ? "bg-selected-row" : baseBg;

  const statusText: Record<string, string> = {
    running: tr("cmp.status.running"),
    queued: tr("cmp.status.queued"),
    done: tr("cmp.status.done"),
    stopped: tr("cmp.status.stopped"),
    skipped: tr("cmp.status.skipped"),
    failed: tr("cmp.status.failed"),
  };

  /* 行内容（进度条层 + 信息 grid），浮行与占位共用 */
  const inner = (
    <>
      {/* 压缩中：行底色进度（淡蓝，从左到删除按钮 = 100%） */}
      {isRunning && (
        <div
          className="absolute inset-y-0 left-0 bg-brand-500/25 transition-[width] duration-500 pointer-events-none"
          style={{ width: `${pct}%` }}
        />
      )}

      <div
        className="relative grid grid-cols-[1fr_95px_1fr_140px_100px] items-center h-[58px] px-3 gap-2"
        onContextMenu={(e) => onCtx(e, t)}
      >
        {/* 状态 + 文件名 */}
        <div className="min-w-0" onMouseEnter={(e) => show(e.currentTarget, t.name)}>
          <div className="text-[15px] text-text-main truncate">{t.name}</div>
          <div className="text-[12px] text-text-sub mt-0.5">{statusText[t.status]}</div>
        </div>

        {/* 原文件大小 */}
        <div className="text-[14px] text-text-sub tabular-nums">
          {t.orig > 0 ? fmtSize(t.orig) : "—"}
        </div>

        {/* 进度 / 结果信息 */}
        <div className="min-w-0 pr-2">
          {isRunning && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-brand-700 dark:text-brand-300 tabular-nums">{Math.round(pct)}%</span>
                <span className="text-[12px] text-text-sub tabular-nums">
                  {t.pos} / {t.dur}
                </span>
              </div>
              <div className="text-[12px] text-text-sub mt-0.5 tabular-nums">{tr("cmp.eta", { eta: fmtETA(t.etaSec ?? 0) })}</div>
            </>
          )}
          {t.status === "queued" && <div className="text-[14px] text-text-sub">{tr("cmp.waitingWorker")}</div>}
          {t.status === "done" && t.outSize !== undefined && (
            <>
              <div className="text-[14px] text-text-main tabular-nums">
                {fmtSize(t.outSize)} <span className="text-ok text-[12px]">↓{t.ratio}%</span>
              </div>
              <div className="text-[12px] text-text-sub mt-0.5">{tr("cmp.elapsed", { time: t.elapsed ?? "" })}</div>
            </>
          )}
          {(t.status === "stopped" || t.status === "skipped") && (
            <div className="text-[14px] text-warn">{t.status === "skipped" ? tr("cmp.skippedMsg") : tr("cmp.stoppedMsg")}</div>
          )}
          {t.status === "failed" && <div className="text-[14px] text-warn">{tr("cmp.statusFailed")}</div>}
        </div>

        {/* 模式（运行中变灰；已完成锁定不可改——已压完的模式改也无意义） */}
        <div>
          {t.status === "queued" || t.status === "stopped" || t.status === "skipped" || t.status === "failed" ? (
            <Select value={t.mode} onChange={(m) => onMode(m)} options={compressModes} tint={MODE_TINTS[t.mode] ?? ""} className="w-full" />
          ) : (
            <Select value={t.mode} onChange={() => {}} options={compressModes} disabled tint={MODE_TINTS[t.mode] ?? ""} className="w-full" />
          )}
        </div>

        {/* 操作（贴最右） */}
        <div className="flex items-center justify-end gap-1">
          {isRunning && (
            <IconBtn
              tip={tr("cmp.tip.stop")}
              data-action="stop"
              onClick={(e) => {
                e.stopPropagation();
                onStop(t);
              }}
              className="hover:text-danger hover:bg-danger/10"
            >
              <Icon d="M7 7h10v10H7z" size={18} />
            </IconBtn>
          )}
          {(t.status === "stopped" || t.status === "failed") && (
            <IconBtn
              tip={tr("cmp.tip.restart")}
              data-action="restart"
              onClick={(e) => {
                e.stopPropagation();
                onRestart(t);
              }}
            >
              <Icon d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14.9-2M4 15a8 8 0 0 0 14.9 2" size={18} />
            </IconBtn>
          )}
          {t.status === "queued" && (
            <IconBtn
              tip={tr("cmp.tip.top")}
              data-action="top"
              onClick={(e) => {
                e.stopPropagation();
                onTop(t);
              }}
            >
              <Icon d="M12 19V5m0 0-6 6m6-6 6 6" size={18} />
            </IconBtn>
          )}
          <IconBtn
            tip={tr("cmp.tip.delete")}
            data-action="delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(t);
            }}
            className="hover:text-danger hover:bg-danger/10"
          >
            <Icon d="M3 6h18M8 6V4h8v2m1 0 1 14H6L5 6m5 5v6m4-6v6" size={18} />
          </IconBtn>
        </div>
      </div>
    </>
  );

  /* 拖起时：原位置留虚线占位（列表高度恒定，底部完成/终止行不跳动）+ fixed 浮行跟手 */
  if (drag?.isDragging) {
    return (
      <>
        <div
          className="relative mb-1.5 rounded-lg border-2 border-dashed border-brand-300/60 bg-brand-50/40"
          style={{ height: 58 }}
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
      onMouseDown={draggable ? drag?.onMouseDown : undefined}
      onClick={
        onRowClick
          ? (e) => {
              if ((e.target as HTMLElement).closest("button, select, input, a")) return;
              onRowClick(t, e);
            }
          : undefined
      }
      className={`relative rounded-lg border border-border-soft mb-1.5 overflow-hidden ${bg}
        ${draggable ? "cursor-grab active:cursor-grabbing select-none" : ""}
        ${selected ? "ring-1 ring-brand-400/60" : ""}
        transition-transform duration-150 ease-out
        ${drag?.isInsertBefore ? "shadow-[0_-3px_0_0_#005CE6]" : ""}
        ${drag?.isInsertAfter ? "shadow-[0_3px_0_0_#005CE6]" : ""}
        ${draggable ? "transition-shadow" : ""}`}
      style={{ transform: `translateY(${drag?.deltaY ?? 0}px)` }}
    >
      {inner}
    </div>
  );
}

/* ============ 压缩面板 ============ */
/* 对 App 暴露：下载完成自动入队（队尾排队；若已点过"开始压缩"且有空闲线程 → 立即自动开始压缩） */
export type CompressPanelHandle = {
  addDownloadedTask: (path: string, name: string, mode: string) => void;
};

export const CompressPanel = forwardRef<CompressPanelHandle, {
  compressWorkers?: number;
  outSame?: boolean;
  outDir?: string;
  overwrite?: boolean;
  cover?: boolean;
  coverSec?: number;
  onActivityChange?: (busy: boolean, fail: boolean, running: number, queued: number) => void;
  onGainChange?: (gain: number) => void;
  /* 当前是否为可见面板：隐藏面板不响应 Delete/Backspace（多选删除只作用于当前面板） */
  active?: boolean;
}>(function CompressPanel(
  {
    compressWorkers = 3,
    outSame = true,
    outDir = "",
    overwrite = false,
    cover = false,
    coverSec = 5,
    onActivityChange,
    onGainChange,
    active = true,
  },
  ref,
) {
  const [tasks, setTasks] = useState<CmpTask[]>([]);
  const [defMode, setDefMode] = useState("default");
  const [fileOver, setFileOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; t: CmpTask } | null>(null);
  /* 终止确认：行内停止按钮（stop：终止保留行）或 右键移出运行中任务（remove：终止并移出）。
     两者都会删除未压缩完的中间输出（无法从断点继续） */
  const [confirmStop, setConfirmStop] = useState<{ t: CmpTask; action: "stop" | "remove" } | null>(null);
  const engine = useEngine();
  const show = useTip();
  const { t, lang } = useI18n();
  const compressModes = useMemo(() => getCompressModes(t), [t]);

  /* 行右键：右键行不在选中集合内 → 重置选中为该行（菜单按右键行提供单选选择）；
     右键行在选中集合内 → 保持多选，提供批量移出 */
  const openCtx = (e: React.MouseEvent, t: CmpTask) => {
    diag(`CTX open name=${t.name} btn=${e.button} type=${e.type}`);
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到 window（否则同一次右键会把刚渲染的菜单秒关）
    if (!sel.has(t.id)) {
      setSel(new Set([t.id]));
      setAnchor(t.id);
    }
    setCtx({ x: e.clientX, y: e.clientY, t });
    diag(`CTX set x=${e.clientX} y=${e.clientY}`);
  };
  const ctxItems = (): CtxItem[] => {
    if (!ctx) return [];
    const { t: task } = ctx;
    /* 多选（右键行在选中集合内）：只提供批量移出——不提供打开文件/目录，
       不同文件所属目录不同，多选打开会弹出一堆资源管理器 */
    if (sel.size > 1 && sel.has(task.id)) {
      return [{ label: t("cmp.removeMulti", { count: sel.size }), onClick: removeSelected }];
    }
    /* 单选：已完成 = 打开文件 + 打开输出目录 + 移出队列；非完成（含压缩中）= 打开输出目录 + 移出队列
       （压缩中移出 = 终止并移出，走确认警告：删未压缩完产物） */
    const out = outPathOf(task, outSame, outDir);
    const items: CtxItem[] = [];
    if (task.status === "done") {
      items.push({ label: t("cmp.openFile"), onClick: () => out && tryOpen(out, "cmp-open") });
    }
    items.push({
      label: t("cmp.openDir"),
      onClick: () => {
        if (!out) return;
        const dir = out.slice(0, Math.max(out.lastIndexOf("\\"), out.lastIndexOf("/")));
        // 完成态：定位输出文件；未完成：打开输出目录文件夹（输出文件还不存在，reveal 会 FAIL）
        if (task.status === "done") tryReveal(out, "cmp-reveal");
        else tryOpen(dir, "cmp-open-dir");
      },
    });
    items.push({
      label: t("cmp.removeFromList"),
      onClick: () => {
        if (task.status === "running") setConfirmStop({ t: task, action: "remove" });
        else remove(task.id);
      },
    });
    return items;
  };

  /* 活动状态上报（侧栏状态灯：有运行任务=绿闪，有失败=黄；running=进行中任务数，queued=等待数） */
  const actRef = useRef(onActivityChange);
  actRef.current = onActivityChange;
  useEffect(() => {
    const running = tasks.filter((t) => t.status === "running").length;
    const queued = tasks.filter((t) => t.status === "queued").length;
    const fail = tasks.some((t) => t.status === "failed" || t.status === "skipped");
    actRef.current?.(running > 0, fail, running, queued);
  }, [tasks]);

  const move = (id: string, fn: (t: CmpTask) => CmpTask) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));

  const top = (id: string) =>
    setTasks((prev) => {
      const t = prev.find((x) => x.id === id);
      if (!t) return prev;
      const rest = prev.filter((x) => x.id !== id);
      const idx = rest.findIndex((x) => x.status !== "queued");
      const arr = [...rest];
      arr.splice(idx === -1 ? arr.length : idx, 0, t);
      return arr;
    });

  const remove = (id: string) => {
    /* 删除运行中任务：先杀引擎进程（含删半成品输出），再移出列表；
       已完成/排队等其余状态仅移出列表（保留输出文件）。
       只要 cmpId 已绑定就发 cmp_stop——UI 状态与实际进程错位（如误显示排队）时也能兜底杀进程 */
    submittingRef.current.delete(id); // 若还在"提交启动中"，释放 submitting 槽
    const t = tasks.find((x) => x.id === id);
    diag(`REMOVE id=${id} status=${t?.status} cmpId=${t?.cmpId ?? "null"}`);
    if (t && t.cmpId != null) {
      engine.call("cmp_stop", { cmp_id: t.cmpId });
    }
    setTasks((prev) => prev.filter((x) => x.id !== id));
  };

  /* 删除：压缩中（有半成品产物）→ 弹终止警告（删中间输出后移出）；其余 → 直接移出列表（保留输出文件） */
  const onDeleteClick = (t: CmpTask) => {
    diag(`DELBTN id=${t.id} status=${t.status} cmpId=${t.cmpId ?? "null"}`);
    if (t.status === "running") setConfirmStop({ t, action: "remove" });
    else remove(t.id);
  };

  const appendTasks = (items: { path: string; name: string; mode?: string }[]) =>
    setTasks((prev) => {
      /* 过滤 + 去重：
         1) 压缩输出文件（xxx_compressed.mp4）与源文件同目录，扫描/拖入时会被当新任务——排除，避免输出被重复压缩（曾致两个 ffmpeg 同时压同一文件）
         2) 同一路径不重复入列：跨批（existing 含旧任务）与同批（seen）都去重 */
      const existing = new Set(prev.map((t) => t.path));
      const seen = new Set<string>();
      const fresh = items.filter((it) => {
        if (!it.path || existing.has(it.path) || seen.has(it.path)) return false;
        if (/_compressed\.mp4$/i.test(it.path)) return false;
        seen.add(it.path);
        return true;
      });
      return [
        ...prev,
        ...fresh.map((it, i) => ({
          id: `c${Date.now()}${i}`,
          name: it.name,
          path: it.path,
          status: "queued" as const,
          orig: 0,
          mode: it.mode ?? defMode,
        })),
      ];
    });

  /* 下载完成自动入队（App 经 ref 调用）：
     队尾排队；若已点过"开始压缩"（started）→ 自动补位 effect 会立即启动（有空闲线程时） */
  useImperativeHandle(ref, () => ({
    addDownloadedTask: (path, name, mode) => {
      diag(`DL-COMPLETE addDownloadedTask mode=${mode} path=${path}`);
      appendTasks([{ path, name, mode }]);
      /* 队列里没有运行中任务（或还有空闲线程）且已开过闸 → 让自动补位立即生效；
         未点过开始（started=false）则只排队（对齐 TK：添加文件只排队、点开始才压） */
      if (tasks.filter((t) => t.status === "running").length < compressWorkers) {
        setStarted(true);
      }
    },
  }));
  // eslint-disable-next-line react-hooks/exhaustive-deps

  /* 添加视频（系统文件对话框） */
  const pickVideos = async () => {
    const sel = await open({
      multiple: true,
      filters: [{ name: "视频", extensions: ["mp4", "mkv", "webm", "mov", "avi", "flv", "ts", "m4v"] }],
    });
    if (!sel) return;
    const paths = (Array.isArray(sel) ? sel : [sel]).filter(Boolean) as string[];
    appendTasks(paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() || p })));
  };

  /* 添加文件夹（递归枚举视频） */
  const pickFolder = async () => {
    const dir = await open({ directory: true });
    if (!dir) return;
    setBusy(true);
    try {
      const r = (await engine.call("cmp_scan_dir", { path: dir })) as { files?: string[] };
      const files = r?.files ?? [];
      appendTasks(files.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() || p })));
    } finally {
      setBusy(false);
    }
  };

  /* 拖入文件：Tauri 会拦截原生 HTML 拖拽，用 webview 的 onDragDropEvent 拿真实路径 */
  const lastDropRef = useRef(0);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setFileOver(true);
        } else if (event.payload.type === "drop") {
          setFileOver(false);
          /* StrictMode 双挂载可能残留双 listener → drop 触发两次；500ms 时间窗去重 */
          const now = Date.now();
          if (now - lastDropRef.current < 500) return;
          lastDropRef.current = now;
          const paths = event.payload.paths;
          if (paths.length > 0) {
            appendTasks(paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() || p })));
          }
        } else {
          setFileOver(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 排序分区：压缩中固定顶部不动；排队中可拖拽排序；完成/终止固定底部 */
  const runningTasks = tasks.filter((t) => t.status === "running");
  const queuedTasks = tasks.filter((t) => t.status === "queued");
  const endedTasks = tasks.filter(
    (t) => t.status === "done" || t.status === "stopped" || t.status === "skipped" || t.status === "failed",
  );

  /* ============ 多选（Ctrl/Shift 点击；运行中不可选；Delete 或右键批量移出） ============ */
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  const handleRowClick = (t: CmpTask, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (t.status === "running") return; // 运行中不可选（对齐 TK：运行中选不了）
    if (e.ctrlKey || e.metaKey) {
      setSel((prev) => {
        const next = new Set(prev);
        if (next.has(t.id)) next.delete(t.id);
        else next.add(t.id);
        return next;
      });
      setAnchor(t.id);
    } else if (e.shiftKey) {
      // 范围选择：按展示顺序（压缩中→排队中→结束态）从锚点跨到当前行
      const order = [...runningTasks, ...queuedTasks, ...endedTasks].map((x) => x.id);
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

  /* 批量移出：压缩面板只移出列表（输出文件保留），运行中除外 */
  /* 批量移出确认：选中的压缩中任务将被终止并删除中间输出（无法断点续压） */
  const [multiStop, setMultiStop] = useState<{ ids: string[]; n: number } | null>(null);

  const removeSelected = () => {
    const ids = [...sel];
    if (ids.length === 0) return;
    diag(`MULTIREMOVE ids=${ids.join(",")}`);
    const running = ids.filter((id) => tasks.find((t) => t.id === id)?.status === "running");
    if (running.length > 0) {
      setMultiStop({ ids, n: ids.length }); // 含压缩中任务：弹警告，确认后逐个终止+移出
      return;
    }
    ids.forEach((id) => submittingRef.current.delete(id));
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
    setSel(new Set());
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

  /* 拖拽排序（自定义指针实现：拎起浮行 + 其他行平滑挤开），仅作用于排队区；
     按下未拖拽（点击）→ 走多选逻辑 */
  const dragSort = useDragSort<CmpTask>(
    queuedTasks,
    ROW_H,
    () => true,
    (next) => {
      setTasks([...runningTasks, ...next, ...endedTasks]);
    },
    (id, e) => {
      const t = queuedTasks.find((x) => x.id === id);
      if (t) handleRowClick(t, e);
    },
  );

  /* 收益统计：原大小 × (1 - 压缩比) 求和，仅已完成行 */
  const gain = useMemo(() => {
    return tasks
      .filter((t) => t.status === "done" && t.orig && t.ratio !== undefined)
      .reduce((acc, t) => acc + t.orig * (1 - (t.ratio ?? 0) / 100), 0);
  }, [tasks]);

  const gainRef = useRef(onGainChange);
  gainRef.current = onGainChange;
  useEffect(() => {
    gainRef.current?.(gain);
  }, [gain]);

  const runningCount = runningTasks.length;

  /* 已点过"开始压缩"（对齐 TK 版 paused 取反）：初始只排队，点开始才启动；之后任务结束自动补位 */
  const [started, setStarted] = useState(false);
  /* 已提交 cmp_add 但尚未收到 cmp_id（状态还没变 running）的任务 id：
     防止进度事件触发 effect 时对同一批 queued 重复补位（曾致并发失控：9 个 ffmpeg 同时跑） */
  const submittingRef = useRef<Set<string>>(new Set());

  /* 启动单个任务：先占 submitting 槽（防重复），收到 cmp_id 后置 running */
  const launchTask = (t: CmpTask, ts: number, i: number) => {
    /* 入口防重：同一任务已在提交中（startCompress 与自动补位 effect 竞态会同时选中）→ 直接跳过，
       从源头消除重复 cmp_add（此前曾致引擎 dup 响应把已启动行误删） */
    if (submittingRef.current.has(t.id)) return;
    submittingRef.current.add(t.id);
    const doOverwrite = overwrite && outSame; // 覆盖仅"与原文件同目录"可用
    engine
      .call("cmp_add", {
        path: t.path,
        mode: t.mode,
        out_dir: outSame ? null : outDir || null,
        cover_sec: cover ? coverSec : null,
        overwrite: doOverwrite,
        limit: compressWorkers, // 引擎并发硬闸门：达上限拒绝启动（防 UI 竞态超发）
      })
      .then((r) => {
        const rr = r as { cmp_id?: number; dup?: boolean; limit?: boolean };
        if (rr.limit) {
          // 并发已满：保持 queued，交给自动补位 effect 在有空闲线程时启动
          return;
        }
        if (rr.dup) {
          // 引擎已有同路径任务在压：仅移除未绑定的重复行；已启动（有 cmpId）的行保留——
          // 竞态下同一任务被补位 effect 重复选中时，不能把正常运行的行删掉
          setTasks((prev) => prev.filter((x) => x.id !== t.id || x.cmpId != null));
          return;
        }
        const cid = rr.cmp_id;
        setTasks((prev) =>
          prev.map((x) => (x.id === t.id ? { ...x, cmpId: cid, status: "running", pct: 0, startTs: ts + i } : x)),
        );
      })
      .catch(() => {})
      .finally(() => {
        submittingRef.current.delete(t.id);
      });
  };

  /* 开始压缩：按空闲线程数启动队首任务（每个任务独立 cmp_add，绑 cmpId） */
  const startCompress = () => {
    setStarted(true);
    const idle = tasks.filter((t) => t.status === "running" || submittingRef.current.has(t.id)).length;
    const free = Math.max(0, compressWorkers - idle);
    const targets = tasks.filter((t) => t.status === "queued" && !submittingRef.current.has(t.id)).slice(0, free);
    if (targets.length === 0) return;
    const ts = Date.now();
    targets.forEach((t, i) => launchTask(t, ts, i));
  };

  /* 自动补位：已点过"开始压缩"后，任一任务结束（完成/失败/跳过/终止）有空闲线程就自动启动队首任务。
     未点过开始（started=false）时不自动启动——添加/拖入任务只排队（对齐 TK 版 paused 语义）。
     submitting 槽计入占用：提交中的任务（状态未变 running）不重复补位 */
  useEffect(() => {
    if (!started) return;
    const running = tasks.filter((t) => t.status === "running").length;
    const queued = tasks.filter((t) => t.status === "queued" && !submittingRef.current.has(t.id));
    const free = Math.max(0, compressWorkers - running - submittingRef.current.size);
    if (queued.length === 0 || free === 0) return;
    const targets = queued.slice(0, free);
    const ts = Date.now();
    targets.forEach((t, i) => launchTask(t, ts, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, tasks, compressWorkers, overwrite, outSame, outDir, cover, coverSec]);



  /* 终止：发引擎停止（UI 先乐观置为已终止，行变琥珀色、按钮切为重新压缩/删除；引擎回 stopped 事件最终对齐） */
  const stopTask = (t: CmpTask) => {
    submittingRef.current.delete(t.id);
    diag(`STOP_EXEC id=${t.id} cmpId=${t.cmpId ?? "null"}`);
    // 乐观更新：给用户立即的视觉反馈（不再干等引擎事件，防止界面毫无反应）
    setTasks((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, status: "stopped", pct: undefined } : x)),
    );
    if (t.cmpId != null) {
      engine.call("cmp_stop", { cmp_id: t.cmpId });
    }
  };

  /* 重新压缩：重置为排队，放到队尾 */
  const restartTask = (t: CmpTask) => {
    setTasks((prev) => [
      ...prev.filter((x) => x.id !== t.id),
      { ...t, status: "queued", cmpId: undefined, pct: undefined, pos: undefined, dur: undefined, outSize: undefined, ratio: undefined, elapsed: undefined, startTs: undefined },
    ]);
  };

  /* 引擎压缩事件流驱动 */
  useEffect(() => {
    return engine.on((ev) => {
      if (ev.ev !== "cmp") return;
      const e = ev as {
        id: number;
        state: string;
        pct?: number;
        pos?: string;
        dur?: string;
        eta?: number | null;
        orig?: number;
        outSize?: number;
        ratio?: number;
        out?: string;
      };
      const cid = Number(e.id);
      setTasks((prev) =>
        prev.map((t) => {
          if (t.cmpId !== cid) return t;
          switch (e.state) {
            case "started":
              return { ...t, orig: e.orig ?? t.orig };
            case "compressing":
              return { ...t, status: "running", pct: e.pct, pos: e.pos, dur: e.dur, etaSec: e.eta ?? undefined };
            case "done": {
              const el = t.startTs ? fmtElapsed((Date.now() - t.startTs) / 1000, lang) : undefined;
              return { ...t, status: "done", outSize: e.outSize, ratio: e.ratio, orig: e.orig ?? t.orig, elapsed: el, pct: 100, outPath: e.out || t.outPath };
            }
            case "failed":
              // 主动终止（stopped）后到达的 failed 是竞态残留，保持终止态不覆盖
              return { ...t, status: t.status === "stopped" ? "stopped" : "failed", pct: undefined };
            case "skipped":
              return {
                ...t,
                status: "skipped",
                pct: undefined,
                elapsed: t.startTs ? fmtElapsed((Date.now() - t.startTs) / 1000, lang) : undefined,
              };
            case "stopped":
              return { ...t, status: "stopped", pct: undefined };
            default:
              return t;
          }
        }),
      );
    });
  }, [engine]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 工具条 */}
      <div className="shrink-0 p-4 pb-3 flex items-center gap-2">
        <Button onClick={pickVideos} disabled={busy}>
          <Icon d="M12 5v14M5 12h14" size={14} />
          {t("cmp.addVideos")}
        </Button>
        <Button variant="soft" onClick={pickFolder} onMouseEnter={(e) => show(e.currentTarget, t("cmp.addFolderTip"))} disabled={busy}>
          <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={14} />
          {busy ? t("cmp.scanning") : t("cmp.addFolder")}
        </Button>

        <div
          className="flex items-center gap-1.5 ml-2 text-[14px] text-text-sub cursor-default"
          onMouseEnter={(e) => show(e.currentTarget, t("cmp.modeTip"))}
        >
          {t("cmp.modeLabel")}
          <Select value={defMode} onChange={setDefMode} options={compressModes} tint={MODE_TINTS[defMode] ?? ""} className="w-[145px]" />
        </div>

        <div className="flex-1" />

        <Button onClick={startCompress} disabled={queuedTasks.length === 0 || runningCount >= compressWorkers}>
          <Icon d="M8 5v14l11-7z" size={13} />
          {t("cmp.start")}
        </Button>
        <Button variant="ghost" onClick={() => setTasks((p) => p.filter((t) => t.status !== "done" && t.status !== "stopped" && t.status !== "failed" && t.status !== "skipped"))}>
          {t("cmp.clearDone")}
        </Button>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 min-h-0 px-4 pb-3 flex flex-col">
        {/* 标题行固定高度（h-6）：选中注释/删除按钮出现与否都不改变高度，列表不跳动 */}
        <div className="flex items-center justify-between mb-2 shrink-0 h-6 overflow-hidden">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-[14px] font-semibold text-text-main whitespace-nowrap">
              {t("cmp.title")}{" "}
              <span className="text-text-sub font-normal text-[13px]">{t("cmp.items", { count: tasks.length })}</span>
            </div>
            {sel.size > 0 && (
              <div className="text-[12px] text-text-sub whitespace-nowrap">{t("cmp.selectTip")}</div>
            )}
          </div>
          {sel.size > 0 ? (
            <button onClick={removeSelected} className="text-[13px] font-medium text-danger hover:underline shrink-0">
              {t("cmp.removeSelected", { count: sel.size })}
            </button>
          ) : (
            <div className="text-[12px] text-text-sub whitespace-nowrap">{t("cmp.dragPrompt")}</div>
          )}
        </div>
        <div
          className={`relative flex-1 min-h-0 overflow-y-auto pr-1 rounded-lg transition-colors ${
            fileOver ? "bg-brand-50 ring-2 ring-brand-400/70 ring-inset" : ""
          }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSel(new Set()); // 点击列表空白取消选中
          }}
        >
          {tasks.length === 0 ? (
            <div className="h-full flex flex-col p-2 select-none">
              <div className="flex-1 rounded-2xl border-2 border-dashed border-purple-300/70 hover:border-purple-400 bg-gradient-to-b from-purple-50/30 via-white to-purple-50/20 dark:from-transparent dark:via-transparent dark:to-transparent dark:bg-card/40 dark:border-purple-900/60 dark:hover:border-purple-700/80 flex flex-col items-center justify-center p-6 text-center transition-all">
                {/* 核心插画：文件减重瘦身艺术隐喻 (850MB ➔ 210MB，一秒辨识为视频压缩) */}
                <div className="relative w-48 h-36 mb-4 flex items-center justify-center">
                  {/* 柔和紫色渐变底环 */}
                  <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-400/20 via-pink-400/15 to-indigo-400/20 blur-xl dark:opacity-30" />

                  {/* 左侧：原始大视频文件 */}
                  <div className="absolute -left-2 w-24 h-28 bg-card rounded-xl border border-border-soft dark:border-slate-700/80 shadow-md p-2 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="w-2 h-2 rounded-full bg-rose-400" />
                      <span className="text-[10px] font-mono text-text-sub">MP4</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center mb-1">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                          <line x1="7" y1="2" x2="7" y2="22" />
                          <line x1="17" y1="2" x2="17" y2="22" />
                        </svg>
                      </div>
                      <span className="text-[12px] font-bold text-text-main">850 MB</span>
                    </div>
                    <span className="text-[9px] text-text-sub">{t("cmp.origSizeLabel")}</span>
                  </div>

                  {/* 中间：C-Clamp台钳挤压视频帧 (物理压榨减重视觉隐喻，告别误解的下载箭头) */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-violet-500 dark:from-purple-500 dark:via-indigo-500 dark:to-violet-400 text-white flex items-center justify-center shadow-lg shadow-purple-500/30 dark:shadow-purple-950/60 p-1.5 transition-transform hover:scale-105">
                      <svg viewBox="0 0 48 48" fill="none" className="w-7 h-7 text-white">
                        <defs>
                          <mask id="cmpFilmHolesMask">
                            <rect width="48" height="48" fill="white" />
                            {/* 左侧胶片齿孔 */}
                            <rect x="14.8" y="23" width="2" height="2" rx="0.5" fill="black" />
                            <rect x="14.8" y="26.8" width="2" height="2" rx="0.5" fill="black" />
                            <rect x="14.8" y="30.6" width="2" height="2" rx="0.5" fill="black" />
                            <rect x="14.8" y="34.4" width="2" height="2" rx="0.5" fill="black" />
                            {/* 右侧胶片齿孔 */}
                            <rect x="26.2" y="23" width="2" height="2" rx="0.5" fill="black" />
                            <rect x="26.2" y="26.8" width="2" height="2" rx="0.5" fill="black" />
                            <rect x="26.2" y="30.6" width="2" height="2" rx="0.5" fill="black" />
                            <rect x="26.2" y="34.4" width="2" height="2" rx="0.5" fill="black" />
                            {/* 核心播放键镂空三角 */}
                            <polygon points="19.5,25.5 19.5,33.5 25.8,29.5" fill="black" />
                          </mask>
                        </defs>

                        {/* C-Clamp 钳身骨架 (环绕右侧有力包夹) */}
                        <path
                          d="M 13 16.5 C 13 13.5 15 12 19 12 H 34 C 38.5 12 42 15.5 42 20 V 36 C 42 40.5 38.5 44 34 44 H 19 C 15 44 13 42.5 13 39.5"
                          stroke="currentColor"
                          strokeWidth="4.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* 顶部 T 型旋转把手 */}
                        <rect x="10.5" y="2.5" width="22" height="3" rx="1.5" fill="currentColor" />
                        <circle cx="10.5" cy="4" r="2.5" fill="currentColor" />
                        <circle cx="32.5" cy="4" r="2.5" fill="currentColor" />

                        {/* 螺旋下压丝杆 */}
                        <rect x="20" y="5" width="3" height="12" rx="0.5" fill="currentColor" />
                        <path d="M 18.5 7.5 h 6 M 18.5 10.5 h 6 M 18.5 13.5 h 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />

                        {/* 挤压平压脚 */}
                        <rect x="13" y="16.5" width="17" height="3" rx="1" fill="currentColor" />

                        {/* 被强力压榨的胶片视频帧 (带有镂空播放三角与胶片齿孔，透出渐变紫底色) */}
                        <rect x="13" y="20" width="17" height="18.5" rx="2.5" fill="currentColor" mask="url(#cmpFilmHolesMask)" />
                      </svg>
                    </div>
                    <span className="mt-1 px-1.5 py-0.5 rounded-full bg-purple-100/90 dark:bg-purple-950/80 border border-purple-200/60 dark:border-purple-800/60 text-purple-700 dark:text-purple-300 text-[10px] font-bold tracking-tight shadow-sm">
                      {t("cmp.slimmingBadge")}
                    </span>
                  </div>

                  {/* 右侧：压缩后精炼小文件 */}
                  <div className="absolute -right-2 w-24 h-28 bg-card rounded-xl border border-purple-200 dark:border-purple-800/60 shadow-md p-2 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-[10px] font-mono text-purple-600 dark:text-purple-300 font-bold">OPTIMIZED</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-1">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                      </div>
                      <span className="text-[12px] font-bold text-emerald-700 dark:text-emerald-300">210 MB</span>
                    </div>
                    <span className="text-[9px] text-text-sub">{t("cmp.optSizeLabel")}</span>
                  </div>
                </div>

                {/* 标题与副标题 */}
                <h3 className="text-[17px] font-bold text-text-main tracking-tight">
                  {t("cmp.emptyTitle")}
                </h3>
                <p className="mt-1.5 text-[13.5px] text-text-sub max-w-md leading-relaxed">
                  {t("cmp.emptyDesc")}
                </p>

                {/* 快速操作大按钮组 */}
                <div className="mt-5 flex items-center gap-3">
                  <Button onClick={pickVideos} disabled={busy} className="px-5 h-10 text-[13.5px]">
                    <Icon d="M12 5v14M5 12h14" size={14} />
                    <span>{t("cmp.btnBrowseFiles")}</span>
                  </Button>
                  <Button variant="soft" onClick={pickFolder} disabled={busy} className="px-5 h-10 text-[13.5px]">
                    <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={14} />
                    <span>{busy ? t("cmp.scanning") : t("cmp.btnBrowseFolder")}</span>
                  </Button>
                </div>

                {/* 底部常用模式速选卡片 */}
                <div className="mt-7 pt-5 border-t border-border-soft w-full max-w-xl">
                  <div className="text-[12px] text-text-sub/70 font-medium mb-2.5">
                    {t("cmp.presetQuickSelect")}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-left">
                    <div
                      onClick={() => setDefMode("default")}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer shadow-xs ${
                        defMode === "default"
                          ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300/40 dark:bg-emerald-950/45 dark:border-emerald-400 dark:ring-emerald-500/25"
                          : "border-emerald-200/80 bg-emerald-50/50 hover:bg-emerald-100/70 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:hover:bg-emerald-950/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] font-bold text-emerald-900 dark:text-emerald-200">{t("mode.default")}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      </div>
                      <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5 leading-tight">{t("cmp.presetDescDefault")}</p>
                    </div>

                    <div
                      onClick={() => setDefMode("hq")}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer shadow-xs ${
                        defMode === "hq"
                          ? "border-sky-400 bg-sky-50 ring-2 ring-sky-300/40 dark:bg-sky-950/45 dark:border-sky-400 dark:ring-sky-500/25"
                          : "border-sky-200/80 bg-sky-50/50 hover:bg-sky-100/70 dark:border-sky-900/60 dark:bg-sky-950/25 dark:hover:bg-sky-950/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] font-bold text-sky-900 dark:text-sky-200">{t("mode.hq")}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                      </div>
                      <p className="text-[11px] text-sky-700/80 dark:text-sky-400/80 mt-0.5 leading-tight">{t("cmp.presetDescHq")}</p>
                    </div>

                    <div
                      onClick={() => setDefMode("fast")}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer shadow-xs ${
                        defMode === "fast"
                          ? "border-amber-400 bg-amber-50 ring-2 ring-amber-300/40 dark:bg-amber-950/45 dark:border-amber-400 dark:ring-amber-500/25"
                          : "border-amber-200/80 bg-amber-50/50 hover:bg-amber-100/70 dark:border-amber-900/60 dark:bg-amber-950/25 dark:hover:bg-amber-950/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] font-bold text-amber-900 dark:text-amber-200">{t("mode.fast")}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      </div>
                      <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5 leading-tight">{t("cmp.presetDescFast")}</p>
                    </div>

                    <div
                      onClick={() => setDefMode("av1")}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer shadow-xs ${
                        defMode === "av1"
                          ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300/40 dark:bg-indigo-950/45 dark:border-indigo-400 dark:ring-indigo-500/25"
                          : "border-indigo-200/80 bg-indigo-50/50 hover:bg-indigo-100/70 dark:border-indigo-900/60 dark:bg-indigo-950/25 dark:hover:bg-indigo-950/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] font-bold text-indigo-900 dark:text-indigo-200">{t("mode.av1")}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      </div>
                      <p className="text-[11px] text-indigo-700/80 dark:text-indigo-400/80 mt-0.5 leading-tight">{t("cmp.presetDescAv1")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* 压缩中：固定顶部，不参与拖拽 */}
              {runningTasks.map((t) => (
                <CmpRow
                  key={t.id}
                  t={t}
                  onCtx={openCtx}
                  onMode={(m) => move(t.id, (x) => ({ ...x, mode: m }))}
                  onStop={(t) => { diag(`STOPBTN id=${t.id} cmpId=${t.cmpId ?? "null"}`); setConfirmStop({ t, action: "stop" }); }}
                  onRestart={restartTask}
                  onTop={(x) => top(x.id)}
                  onDelete={onDeleteClick}
                />
              ))}
              {/* 排队中：可拖拽排序（独立子容器，坐标从本区顶部算起） */}
              <div ref={dragSort.containerRef} className="relative">
                {queuedTasks.map((t, i) => {
                  const p = dragSort.rowProps(t, i);
                  return (
                    <CmpRow
                      key={t.id}
                      t={t}
                      selected={sel.has(t.id)}
                      onCtx={openCtx}
                      onMode={(m) => move(t.id, (x) => ({ ...x, mode: m }))}
                      onStop={(t) => { diag(`STOPBTN id=${t.id} cmpId=${t.cmpId ?? "null"}`); setConfirmStop({ t, action: "stop" }); }}
                      onRestart={restartTask}
                      onTop={(x) => top(x.id)}
                      onDelete={onDeleteClick}
                      drag={{
                        ...p,
                        onMouseDown: (e) => dragSort.onRowMouseDown(e, t.id),
                      }}
                    />
                  );
                })}
              </div>
              {/* 完成/终止：固定底部，不参与拖拽 */}
              {endedTasks.map((t) => (
                <CmpRow
                  key={t.id}
                  t={t}
                  selected={sel.has(t.id)}
                  onRowClick={handleRowClick}
                  onCtx={openCtx}
                  onMode={(m) => move(t.id, (x) => ({ ...x, mode: m }))}
                  onStop={(t) => { diag(`STOPBTN id=${t.id} cmpId=${t.cmpId ?? "null"}`); setConfirmStop({ t, action: "stop" }); }}
                  onRestart={restartTask}
                  onTop={(x) => top(x.id)}
                  onDelete={onDeleteClick}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 行右键菜单（光标位置就近弹出） */}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems()} onClose={() => setCtx(null)} />}

      {/* 终止确认：行内停止按钮（终止保留行）或右键移出压缩中任务（终止并移出）。
         两者都会删除未压缩完的中间输出，无法从断点继续 */}
      {confirmStop && (
        <Dialog open onClose={() => { diag(`STOPDLG cancel`); setConfirmStop(null); }} title={t("cmp.stopDlgTitle")} width={440}>
          <p className="text-[15px] text-text-main leading-relaxed">
            {t("cmp.stopDlgText")}
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => { diag(`STOPDLG cancel`); setConfirmStop(null); }}>
              {t("ffmpeg.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const c = confirmStop;
                diag(`STOPDLG confirm action=${c?.action} id=${c?.t.id} cmpId=${c?.t.cmpId ?? "null"}`);
                setConfirmStop(null);
                if (!c) return;
                if (c.action === "remove") remove(c.t.id);
                else stopTask(c.t);
              }}
            >
              {confirmStop.action === "remove" ? t("cmp.stopDlgStopAndRemove") : t("cmp.stopDlgStop")}
            </Button>
          </div>
        </Dialog>
      )}

      {/* 批量移出确认：选中集合含压缩中任务 */}
      {multiStop && (
        <Dialog open onClose={() => { diag(`MULTISTOP cancel n=${multiStop?.n}`); setMultiStop(null); }} title={t("cmp.multiStopTitle")} width={440}>
          <p className="text-[15px] text-text-main leading-relaxed">
            {t("cmp.multiStopDesc", { n: multiStop.n })}
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => { diag(`MULTISTOP cancel n=${multiStop?.n}`); setMultiStop(null); }}>
              {t("ffmpeg.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const m = multiStop;
                diag(`MULTISTOP confirm ids=${m?.ids?.join(",")}`);
                setMultiStop(null);
                if (!m) return;
                m.ids.forEach((id) => {
                  const t = tasks.find((x) => x.id === id);
                  if (t && t.cmpId != null) engine.call("cmp_stop", { cmp_id: t.cmpId });
                  submittingRef.current.delete(id);
                });
                setTasks((prev) => prev.filter((t) => !m.ids.includes(t.id)));
                setSel(new Set());
              }}
            >
              {t("cmp.multiStopConfirm")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
});

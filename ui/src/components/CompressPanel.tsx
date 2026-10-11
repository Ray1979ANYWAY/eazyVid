import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconBtn, Icon, Select, Toggle, fmtSize, fmtETA, useTip, ContextMenu, type CtxItem } from "./ui";
import { COMPRESS_MODES, type CmpTask } from "../mock";
import { useDragSort } from "../hooks/useDragSort";
import { useEngine } from "../hooks/useEngine";
import { diag } from "../diag";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";

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

const ROW_H = 58; // 52px 行高 + 6px 间距

function fmtElapsed(sec: number) {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
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
  const isRunning = t.status === "running";
  const pct = t.pct ?? 0;
  const draggable = t.status === "queued";

  const baseBg = isRunning
    ? "bg-white"
    : t.status === "done"
      ? "bg-lavender-row"
      : t.status === "stopped" || t.status === "skipped" || t.status === "failed"
        ? "bg-amber-row"
        : "bg-white";
  const bg = selected ? "bg-selected-row" : baseBg;

  const statusText: Record<string, string> = {
    running: "压缩中",
    queued: "排队中",
    done: "已完成",
    stopped: "已终止",
    skipped: "收益小，已跳过",
    failed: "压缩失败",
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
        className="relative grid grid-cols-[1fr_90px_1fr_130px_96px] items-center h-[52px] px-3 gap-2"
        onContextMenu={(e) => onCtx(e, t)}
      >
        {/* 状态 + 文件名 */}
        <div className="min-w-0" onMouseEnter={(e) => show(e.currentTarget, t.name)}>
          <div className="text-[13px] text-text-main truncate">{t.name}</div>
          <div className="text-[11px] text-text-sub mt-0.5">{statusText[t.status]}</div>
        </div>

        {/* 原文件大小 */}
        <div className="text-[12px] text-text-sub tabular-nums">
          {t.orig > 0 ? fmtSize(t.orig) : "—"}
        </div>

        {/* 进度 / 结果信息 */}
        <div className="min-w-0 pr-2">
          {isRunning && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-brand-700 tabular-nums">{Math.round(pct)}%</span>
                <span className="text-[11px] text-text-sub tabular-nums">
                  {t.pos} / {t.dur}
                </span>
              </div>
              <div className="text-[11px] text-text-sub mt-0.5 tabular-nums">预计剩余 {fmtETA(t.etaSec ?? 0)}</div>
            </>
          )}
          {t.status === "queued" && <div className="text-[12px] text-text-sub">等待空闲线程…</div>}
          {t.status === "done" && t.outSize !== undefined && (
            <>
              <div className="text-[12px] text-text-main tabular-nums">
                {fmtSize(t.outSize)} <span className="text-ok text-[11px]">↓{t.ratio}%</span>
              </div>
              <div className="text-[11px] text-text-sub mt-0.5">用时 {t.elapsed}</div>
            </>
          )}
          {(t.status === "stopped" || t.status === "skipped") && (
            <div className="text-[12px] text-warn">{t.status === "skipped" ? "预估压缩收益不足，已终止" : "已手动终止"}</div>
          )}
          {t.status === "failed" && <div className="text-[12px] text-warn">压缩失败，请查看日志</div>}
        </div>

        {/* 模式（运行中变灰；已完成锁定不可改——已压完的模式改也无意义） */}
        <div>
          {t.status === "queued" || t.status === "stopped" || t.status === "skipped" || t.status === "failed" ? (
            <Select value={t.mode} onChange={(m) => onMode(m)} options={COMPRESS_MODES} className="w-full" />
          ) : (
            <Select value={t.mode} onChange={() => {}} options={COMPRESS_MODES} disabled className="w-full" />
          )}
        </div>

        {/* 操作（贴最右） */}
        <div className="flex items-center justify-end gap-1">
          {isRunning && (
            <IconBtn tip="终止压缩（无法从断点继续）" onClick={() => onStop(t)} className="hover:text-danger hover:bg-danger/10">
              <Icon d="M7 7h10v10H7z" size={18} />
            </IconBtn>
          )}
          {(t.status === "stopped" || t.status === "failed") && (
            <IconBtn tip="重新压缩（排到队尾）" onClick={() => onRestart(t)}>
              <Icon d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14.9-2M4 15a8 8 0 0 0 14.9 2" size={18} />
            </IconBtn>
          )}
          {t.status === "queued" && (
            <IconBtn tip="置顶" onClick={() => onTop(t)}>
              <Icon d="M12 19V5m0 0-6 6m6-6 6 6" size={18} />
            </IconBtn>
          )}
          <IconBtn tip="删除（仅移出列表）" onClick={() => onDelete(t)} className="hover:text-danger hover:bg-danger/10">
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
          style={{ height: 52 }}
        />
        <div
          className="fixed z-50 rounded-lg overflow-hidden shadow-xl ring-2 ring-brand-400/70 opacity-95 scale-[1.02] bg-white"
          style={{ top: drag.draggingTop, left: drag.draggingLeft, width: drag.draggingWidth }}
        >
          {inner}
        </div>
      </>
    );
  }

  return (
    <div
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
export function CompressPanel({
  compressWorkers = 3,
  outSame = true,
  outDir = "",
  overwrite = false,
  cover = false,
  coverSec = 5,
  onActivityChange,
}: {
  compressWorkers?: number;
  outSame?: boolean;
  outDir?: string;
  overwrite?: boolean;
  cover?: boolean;
  coverSec?: number;
  onActivityChange?: (busy: boolean, fail: boolean, running: number) => void;
}) {
  const [tasks, setTasks] = useState<CmpTask[]>([]);
  const [defMode, setDefMode] = useState("default");
  const [shutdown, setShutdown] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; t: CmpTask } | null>(null);
  const engine = useEngine();
  const show = useTip();

  /* 行右键：完成态 = 打开文件 + 打开输出目录；其余 = 打开输出目录 */
  const openCtx = (e: React.MouseEvent, t: CmpTask) => {
    diag(`CTX open name=${t.name} btn=${e.button} type=${e.type}`);
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到 window（否则同一次右键会把刚渲染的菜单秒关）
    setCtx({ x: e.clientX, y: e.clientY, t });
    diag(`CTX set x=${e.clientX} y=${e.clientY}`);
  };
  const ctxItems = (): CtxItem[] => {
    if (!ctx) return [];
    const { t } = ctx;
    const out = outPathOf(t, outSame, outDir);
    const items: CtxItem[] = [];
    /* 右键行在选中集合内且多选 → 批量移出（运行中除外，压缩面板只移出列表） */
    if (sel.size > 1 && sel.has(t.id)) {
      items.push({ label: `移出队列（${sel.size} 项）`, onClick: removeSelected });
    }
    if (t.status === "done") {
      items.push({ label: "打开文件", onClick: () => out && tryOpen(out, "cmp-open") });
    }
    items.push({
      label: "打开输出目录",
      onClick: () => {
        if (!out) return;
        const dir = out.slice(0, Math.max(out.lastIndexOf("\\"), out.lastIndexOf("/")));
        // 完成态：定位输出文件；未完成：打开输出目录文件夹（输出文件还不存在，reveal 会 FAIL）
        if (t.status === "done") tryReveal(out, "cmp-reveal");
        else tryOpen(dir, "cmp-open-dir");
      },
    });
    return items;
  };

  /* 活动状态上报（侧栏状态灯：有运行任务=绿闪，有失败=黄；running=进行中任务数，退出确认用） */
  const actRef = useRef(onActivityChange);
  actRef.current = onActivityChange;
  useEffect(() => {
    const running = tasks.filter((t) => t.status === "running").length;
    const fail = tasks.some((t) => t.status === "failed" || t.status === "skipped");
    actRef.current?.(running > 0, fail, running);
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
       已完成/排队等其余状态仅移出列表（保留输出文件） */
    const t = tasks.find((x) => x.id === id);
    if (t && t.status === "running" && t.cmpId != null) {
      engine.call("cmp_stop", { cmp_id: t.cmpId });
    }
    setTasks((prev) => prev.filter((x) => x.id !== id));
  };

  const appendTasks = (items: { path: string; name: string }[]) =>
    setTasks((prev) => {
      /* 同一路径不重复入列（拖拽/多选可能重复触发） */
      const existing = new Set(prev.map((t) => t.path));
      const fresh = items.filter((it) => it.path && !existing.has(it.path));
      return [
        ...prev,
        ...fresh.map((it, i) => ({
          id: `c${Date.now()}${i}`,
          name: it.name,
          path: it.path,
          status: "queued" as const,
          orig: 0,
          mode: defMode,
        })),
      ];
    });

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
      setSel(new Set([t.id]));
      setAnchor(t.id);
    }
  };

  /* 批量移出：压缩面板只移出列表（输出文件保留），运行中除外 */
  const removeSelected = () => {
    const ids = [...sel].filter((id) => {
      const x = tasks.find((t) => t.id === id);
      return x && x.status !== "running";
    });
    if (ids.length === 0) return;
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
    setSel(new Set());
  };

  /* Delete / Backspace 键删除选中（焦点不在输入框时） */
  useEffect(() => {
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
  }, [sel, tasks]);

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

  const runningCount = runningTasks.length;

  /* 已点过"开始压缩"（对齐 TK 版 paused 取反）：初始只排队，点开始才启动；之后任务结束自动补位 */
  const [started, setStarted] = useState(false);

  /* 开始压缩：按空闲线程数启动队首任务（每个任务独立 cmp_add，绑 cmpId） */
  const startCompress = () => {
    setStarted(true);
    const free = Math.max(0, compressWorkers - runningCount);
    const targets = queuedTasks.slice(0, free);
    if (targets.length === 0) return;
    const ts = Date.now();
    targets.forEach((t, i) => {
      const doOverwrite = overwrite && outSame; // 覆盖仅"与原文件同目录"可用
      engine
        .call("cmp_add", {
          path: t.path,
          mode: t.mode,
          out_dir: outSame ? null : outDir || null,
          cover_sec: doOverwrite && cover ? coverSec : null,
          overwrite: doOverwrite,
        })
        .then((r) => {
          const cid = (r as { cmp_id?: number }).cmp_id;
          setTasks((prev) =>
            prev.map((x) => (x.id === t.id ? { ...x, cmpId: cid, status: "running", pct: 0, startTs: ts + i } : x)),
          );
        });
    });
  };

  /* 自动补位：已点过"开始压缩"后，任一任务结束（完成/失败/跳过/终止）有空闲线程就自动启动队首任务。
     未点过开始（started=false）时不自动启动——添加/拖入任务只排队（对齐 TK 版 paused 语义） */
  useEffect(() => {
    if (!started) return;
    const running = tasks.filter((t) => t.status === "running").length;
    const queued = tasks.filter((t) => t.status === "queued");
    const free = Math.max(0, compressWorkers - running);
    if (queued.length === 0 || free === 0) return;
    const targets = queued.slice(0, free);
    const ts = Date.now();
    targets.forEach((t, i) => {
      const doOverwrite = overwrite && outSame;
      engine
        .call("cmp_add", {
          path: t.path,
          mode: t.mode,
          out_dir: outSame ? null : outDir || null,
          cover_sec: doOverwrite && cover ? coverSec : null,
          overwrite: doOverwrite,
        })
        .then((r) => {
          const cid = (r as { cmp_id?: number }).cmp_id;
          setTasks((prev) =>
            prev.map((x) => (x.id === t.id ? { ...x, cmpId: cid, status: "running", pct: 0, startTs: ts + i } : x)),
          );
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, tasks, compressWorkers, overwrite, outSame, outDir, cover, coverSec]);

  /* 终止：发引擎停止（引擎回 stopped 事件驱动状态） */
  const stopTask = (t: CmpTask) => {
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
              const el = t.startTs ? fmtElapsed((Date.now() - t.startTs) / 1000) : undefined;
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
                elapsed: t.startTs ? fmtElapsed((Date.now() - t.startTs) / 1000) : undefined,
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
        <Button variant="soft" onClick={pickVideos} disabled={busy}>
          <Icon d="M12 5v14M5 12h14" size={14} />
          添加视频
        </Button>
        <Button variant="soft" onClick={pickFolder} onMouseEnter={(e) => show(e.currentTarget, "递归添加文件夹内全部视频")} disabled={busy}>
          <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={14} />
          {busy ? "扫描中…" : "添加文件夹"}
        </Button>

        <div className="flex items-center gap-1.5 ml-2 text-[12px] text-text-sub">
          默认模式
          <Select value={defMode} onChange={setDefMode} options={COMPRESS_MODES} className="w-[130px]" />
        </div>

        <div className="flex-1" />

        <Button onClick={startCompress} disabled={queuedTasks.length === 0 || runningCount >= compressWorkers}>
          <Icon d="M8 5v14l11-7z" size={13} />
          开始压缩
        </Button>
        <Button variant="ghost" onClick={() => setTasks((p) => p.filter((t) => t.status !== "done" && t.status !== "stopped" && t.status !== "failed" && t.status !== "skipped"))}>
          清空已完成
        </Button>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 min-h-0 px-4 pb-3 flex flex-col">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <div className="text-[12px] font-semibold text-text-main">
            压缩任务 <span className="text-text-sub font-normal">（{tasks.length} 项）</span>
          </div>
          {sel.size > 0 ? (
            <Button variant="danger" size="sm" onClick={removeSelected}>
              删除选中（{sel.size}）
            </Button>
          ) : (
            <div className="text-[11px] text-text-sub">可拖入文件 · 排队中可拖动调整优先级</div>
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
            <div className="h-full flex flex-col items-center justify-center text-text-sub/70 gap-2">
              <Icon d="M12 5v14M5 12h14" size={36} strokeWidth={1.5} />
              <div className="text-[12px]">添加视频文件后开始压缩</div>
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
                  onStop={stopTask}
                  onRestart={restartTask}
                  onTop={(x) => top(x.id)}
                  onDelete={(x) => remove(x.id)}
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
                      onStop={stopTask}
                      onRestart={restartTask}
                      onTop={(x) => top(x.id)}
                      onDelete={(x) => remove(x.id)}
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
                  onStop={stopTask}
                  onRestart={restartTask}
                  onTop={(x) => top(x.id)}
                  onDelete={(x) => remove(x.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 底部：收益统计 + 关机开关 */}
      <div className="shrink-0 h-11 px-4 border-t border-border-soft bg-white/70 flex items-center gap-4">
        <div className="text-[12px] text-text-main tabular-nums">
          当前任务列表，已完成压缩收益{" "}
          <span className="font-semibold text-brand-700">{(gain / 1024 ** 3).toFixed(2)} GB</span>
        </div>
        <div className="flex-1" />
        <div
          className="flex items-center gap-2 cursor-pointer select-none"
          onMouseEnter={(e) => show(e.currentTarget, "所有任务结束后自动关机")}
        >
          <Toggle checked={shutdown} onChange={setShutdown} />
          <span className="text-[12px] text-text-main">所有任务结束后关机</span>
        </div>
      </div>

      {/* 行右键菜单（光标位置就近弹出） */}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems()} onClose={() => setCtx(null)} />}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, IconBtn, Icon, fmtSize, fmtSpeed, useTip, ContextMenu, type CtxItem } from "./ui";
import { type DlFormat, type DlTask } from "../mock";
import { useDragSort } from "../hooks/useDragSort";
import { useEngine } from "../hooks/useEngine";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

const DL_ROW_H = 62; // 56px 行高 + 6px 间距

/* ============ 格式列表行 ============ */
function FormatRow({ f, onDownload }: { f: DlFormat; onDownload: (f: DlFormat) => void }) {  const [hover, setHover] = useState(false);
  const show = useTip();

  return (
    <div
      className="grid grid-cols-[90px_70px_80px_100px_1fr_72px] items-center h-11 px-3 rounded-lg border border-transparent
        hover:border-border-brand hover:bg-brand-50/50 transition-colors cursor-default"
      style={{ background: hover ? undefined : undefined }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={() => onDownload(f)}
    >
      <div className="text-[13px] font-semibold text-brand-700">{f.res}</div>
      <div className="text-[12px] text-text-sub">{f.ext.toUpperCase()}</div>
      <div className="text-[12px] text-text-sub">{f.codec}</div>
      <div className="text-[12px] text-text-main">{f.size}</div>
      <div className="flex items-center gap-1.5 min-w-0">
        {f.warn && (
          <span
            title={f.warnText}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-warn cursor-help"
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
            onMouseEnter={(e) => show(e.currentTarget, "下载此格式（双击行也可）")}
          >
            <Icon d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" size={13} />
            下载
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
  onPause?: (t: DlTask) => void;
  onResume?: (t: DlTask) => void;
  onRestart?: (t: DlTask) => void;
  onDelete?: (t: DlTask) => void;
}) {
  const pct = t.total > 0 ? Math.min(100, (t.got / t.total) * 100) : 0;
  const show = useTip();
  const isDownloading = t.status === "downloading" || t.status === "parsing";

  const statusText: Record<string, string> = {
    downloading: "下载中",
    parsing: "解析中…",
    merging: "正在合并音轨，请稍候",
    waiting: "等待下载",
    paused: "已暂停",
    done: "已完成",
    failed: "下载失败",
  };

  const rowBg =
    t.status === "done"
      ? "bg-lavender-row"
      : t.status === "failed"
        ? "bg-amber-row"
        : "bg-white";

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
        className="relative grid grid-cols-[1fr_140px_80px_90px_120px] items-center h-14 px-3 gap-2"
        onContextMenu={(e) => onCtx(e, t)}
      >
        {/* 文件名（溢出隐藏，tooltip 完整名） */}
        <div className="min-w-0" onMouseEnter={(e) => show(e.currentTarget, t.name)}>
          <div className="text-[13px] text-text-main truncate">{t.name}</div>
          <div className="text-[11px] text-text-sub mt-0.5">{statusText[t.status]}</div>
        </div>

        {/* 大小 */}
        <div className="text-[12px] text-text-sub tabular-nums">
          {fmtSize(t.got)} / {fmtSize(t.total)}
        </div>

        {/* 进度百分比 */}
        <div className="text-[12px] font-semibold text-brand-700 tabular-nums">
          {t.status === "downloading"
            ? `${Math.round(pct)}%`
            : t.status === "done" || t.status === "merging"
              ? "100%"
              : "—"}
        </div>

        {/* 速度 */}
        <div className="text-[12px] text-text-sub tabular-nums">
          {t.status === "downloading" || t.status === "merging"
            ? typeof t.speed === "string"
              ? t.speed
              : fmtSpeed(t.speed)
            : "—"}
        </div>

        {/* 操作（内容层在进度条之上，不被遮挡） */}
        <div className="flex items-center justify-end gap-1">
          {(t.status === "downloading" || t.status === "parsing") && (
            <IconBtn tip="暂停" onClick={() => onPause?.(t)}>
              <Icon d="M10 4v16M14 4v16" size={18} />
            </IconBtn>
          )}
          {t.status === "paused" && (
            <IconBtn tip="恢复（排入等待队列）" onClick={() => onResume?.(t)}>
              <Icon d="M8 5v14l11-7z" size={18} />
            </IconBtn>
          )}
          {t.status === "failed" && (
            <IconBtn tip="重新下载（排入等待队列）" onClick={() => onRestart?.(t)}>
              <Icon d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14.9-2M4 15a8 8 0 0 0 14.9 2" size={18} />
            </IconBtn>
          )}
          {t.status === "done" && (
            <>
              <IconBtn tip="打开文件" onClick={() => {}}>
                <Icon d="M14 4h6v6m0-6L9 15m11-11v6" size={18} />
              </IconBtn>
              <IconBtn tip="打开所在文件夹" onClick={() => {}}>
                <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={18} />
              </IconBtn>
            </>
          )}
          <IconBtn tip="删除" onClick={() => onDelete?.(t)} className="hover:text-danger hover:bg-danger/10">
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
          style={{ height: 56 }}
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
      onMouseDown={drag?.onMouseDown}
      className={`relative rounded-lg border border-border-soft mb-1.5 overflow-hidden ${rowBg}
        ${drag?.onMouseDown ? "cursor-grab active:cursor-grabbing select-none" : ""}
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
}: {
  dlWorkers?: number;
  dlDir?: string;
  onActivityChange?: (busy: boolean, fail: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [probeState, setProbeState] = useState<"idle" | "probing" | "done">("idle");
  const [formats, setFormats] = useState<DlFormat[]>([]);
  const [tasks, setTasks] = useState<DlTask[]>([]);
  const [fileOver, setFileOver] = useState(false);
  const [probeErr, setProbeErr] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; t: DlTask } | null>(null);
  /* 格式列表表头排序：分辨率/格式/编码/大小 可点击，同列点击翻转方向 */
  const [sortKey, setSortKey] = useState<{ key: "res" | "ext" | "codec" | "size"; dir: 1 | -1 }>({ key: "res", dir: 1 });
  const show = useTip();
  const inputRef = useRef<HTMLInputElement>(null);
  const engine = useEngine();

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

  /* 行右键：已完成 = 打开文件 + 打开所在目录；其余 = 打开所在目录 */
  const openCtx = (e: React.MouseEvent, t: DlTask) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到 window（否则同一次右键会把刚渲染的菜单秒关）
    setCtx({ x: e.clientX, y: e.clientY, t });
  };
  const ctxItems = (): CtxItem[] => {
    if (!ctx) return [];
    const { t } = ctx;
    const p = t.path || "";
    const items: CtxItem[] = [];
    if (t.status === "done" && p) {
      items.push({ label: "打开文件", onClick: () => openPath(p).catch(() => {}) });
    }
    items.push({
      label: "打开所在目录",
      onClick: () => {
        const dir = p ? p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"))) : dlDir;
        if (p) revealItemInDir(p).catch(() => (dir ? openPath(dir).catch(() => {}) : undefined));
        else if (dir) openPath(dir).catch(() => {});
      },
    });
    return items;
  };

  /* 引擎格式 → UI 格式行 */
  const toDlFormat = (f: Record<string, unknown>): DlFormat => {
    const vc = String(f.vcodec ?? "");
    let codec = "未知";
    if (vc.includes("av1")) codec = "AV1";
    else if (vc.includes("vp")) codec = "VP9";
    else if (vc.includes("avc") || vc.includes("h264")) codec = "H.264";
    else if (vc === "none") codec = "仅音频";
    const size = (f.size as number) ?? 0;
    const note = String(f.note ?? "");
    // 优先显示 "1080p" 式分辨率，其次 "1920x1080"
    const res = /^\d+[pk]$/i.test(note) ? note : String(f.res ?? f.note ?? "");
    return {
      id: String(f.id ?? ""),
      res,
      codec,
      size: size ? fmtSize(size) : "未知",
      ext: String(f.ext ?? "mp4"),
      ...(vc.includes("av1") ? { warn: true, warnText: "AV1 兼容性差，多数播放器无法硬解" } : {}),
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
     仅等待/暂停可拖；下载失败的行不可拖（重新下载进入等待队列后才能拖） */
  const dragSort = useDragSort<DlTask>(
    sortableTasks,
    DL_ROW_H,
    (t) => t.status !== "failed",
    (next) => {
      setTasks([...activeTasks, ...next, ...doneTasks]);
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
        setProbeErr(String(r.error || "未解析到可用格式"));
        return;
      }
      // 过滤纯音频流（vcodec=none），只展示视频格式
      const fmts = r.formats.filter((f) => String(f.vcodec) !== "none");
      if (!fmts.length) {
        setProbeState("idle");
        setProbeErr("仅解析到音频流，无视频格式");
        return;
      }
      setFormats(fmts.map(toDlFormat));
      setProbeState("done");
    } catch (e) {
      setProbeState("idle");
      setProbeErr(String(e instanceof Error ? e.message : e));
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const m = text.match(/https?:\/\/[^\s）)\]]+/);
      setUrl(m ? m[0] : text.trim());
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
      fmt_id: f.id,
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
      setTasks((prev) => {
        const existing = prev.find((t) => t.taskId === tid);
        if (!existing) {
          return [...prev, { id: `dl${tid}`, taskId: tid, name: name || `任务 #${tid}`, path, status: state, got, total, speed }];
        }
        return prev.map((t) => (t.taskId === tid ? { ...t, name: name || t.name, path: path || t.path, status: state, got, total, speed } : t));
      });
    });
  }, [engine]);

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
  const remove = (t: DlTask) => {
    if (t.taskId != null) void engine.call("dl_remove", { task_id: t.taskId });
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
  };

  const doneCount = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);

  /* 活动状态上报（侧栏状态灯：有运行任务=绿闪，有失败=黄） */
  const actRef = useRef(onActivityChange);
  actRef.current = onActivityChange;
  useEffect(() => {
    const busy = tasks.some((t) => t.status === "downloading" || t.status === "merging");
    const fail = tasks.some((t) => t.status === "failed");
    actRef.current?.(busy, fail);
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
              placeholder="粘贴视频页面地址，回车探测"
              className="w-full h-9 pl-3.5 pr-12 rounded-lg border border-border-soft bg-white text-[13px] text-text-main
                placeholder:text-text-sub/60 focus:outline-2 focus:outline-brand-500 focus:border-brand-300"
            />
            <IconBtn
              tip="粘贴（自动提取 URL）"
              onClick={paste}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7"
            >
              <Icon d="M9 5h6a2 2 0 0 1 2 2v9m-4 3H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2" size={15} />
            </IconBtn>
          </div>

          {/* 探测按钮 / 探测状态（可点击取消） */}
          {probeState === "probing" ? (
            <button
              onClick={cancelProbe}
              onMouseEnter={(e) => show(e.currentTarget, "正在探测，点击取消")}
              className="flex items-center gap-2 h-9 px-3.5 rounded-lg bg-brand-50 border border-brand-300 text-brand-700
                text-[13px] font-medium cursor-pointer hover:bg-brand-100 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" className="ez-spin" style={{ color: "#005CE6" }}>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              探测中…
            </button>
          ) : (
            <Button onClick={probe} disabled={!url.trim()} className="h-9">
              <Icon d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" size={14} />
              探测格式
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[11px] text-text-sub">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-ok" />
          直连探测优先；藏得太深的视频会自动引导进入嗅探
        </div>
      </div>

      {/* 格式列表（常驻区域：未探测时为空态提示；超 300px 内容区滚动，表头固定） */}
      <div className="shrink-0 px-4 pb-2">
        <div className="rounded-xl border border-border-soft bg-white overflow-hidden">
          <div className="grid grid-cols-[90px_70px_80px_100px_1fr_72px] items-center h-8 px-3 bg-surface text-[11px] text-text-sub font-medium">
            <button className="flex items-center gap-1 cursor-pointer hover:text-text-main" onClick={() => toggleSort("res")}>
              分辨率
              <span className="text-[9px] leading-none">{sortKey.key === "res" ? (sortKey.dir === 1 ? "▲" : "▼") : "⇅"}</span>
            </button>
            <button className="flex items-center gap-1 cursor-pointer hover:text-text-main" onClick={() => toggleSort("ext")}>
              格式
              <span className="text-[9px] leading-none">{sortKey.key === "ext" ? (sortKey.dir === 1 ? "▲" : "▼") : "⇅"}</span>
            </button>
            <button className="flex items-center gap-1 cursor-pointer hover:text-text-main" onClick={() => toggleSort("codec")}>
              编码
              <span className="text-[9px] leading-none">{sortKey.key === "codec" ? (sortKey.dir === 1 ? "▲" : "▼") : "⇅"}</span>
            </button>
            <button className="flex items-center gap-1 cursor-pointer hover:text-text-main" onClick={() => toggleSort("size")}>
              大小
              <span className="text-[9px] leading-none">{sortKey.key === "size" ? (sortKey.dir === 1 ? "▲" : "▼") : "⇅"}</span>
            </button>
            <div>提示</div>
            <div className="text-right pr-1">操作</div>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {formats.length === 0 ? (
              <div className="flex items-center justify-center h-14 text-[12px] text-text-sub/70 gap-1.5">
                {probeState === "probing" ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" className="ez-spin" style={{ color: "#005CE6" }}>
                      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    正在解析可用格式…
                  </>
                ) : probeErr ? (
                  <span className="text-warn">探测失败：{probeErr}</span>
                ) : (
                  <>点击「探测格式」后，可用格式将显示在这里</>
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
        <div className="flex items-center justify-between mb-2 shrink-0">
          <div className="text-[12px] font-semibold text-text-main">
            下载池 <span className="text-text-sub font-normal">（{tasks.length} 项 · 完成 {doneCount}）</span>
          </div>
          <div className="text-[11px] text-text-sub">
            并行下载 {dlWorkers} 路 · 拖入或右键多选 · 等待/暂停/失败可拖动调整优先级
          </div>
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
                },
              ]);
            }
          }}
          className={`relative flex-1 min-h-0 overflow-y-auto pr-1 rounded-lg transition-colors ${
            fileOver ? "bg-brand-50 ring-2 ring-brand-400/70 ring-inset" : ""
          }`}
        >
          {tasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-text-sub/70 gap-2">
              <Icon d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" size={36} strokeWidth={1.5} />
              <div className="text-[12px]">暂无下载任务</div>
            </div>
          ) : (
            <>
              {/* 下载中/合并中：固定顶部，不参与拖拽 */}
              {activeTasks.map((t) => (
                <DlRow
                  key={t.id}
                  t={t}
                  onCtx={openCtx}
                  onPause={pause}
                  onDelete={remove}
                />
              ))}
              {/* 等待/暂停/失败：可拖拽排序（独立子容器，坐标从本区顶部算起） */}
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
                      onResume={resume}
                      onRestart={restart}
                      onDelete={remove}
                    />
                  );
                })}
              </div>
              {/* 完成：固定底部，不参与拖拽 */}
              {doneTasks.map((t) => (
                <DlRow key={t.id} t={t} onCtx={openCtx} onDelete={remove} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 行右键菜单（光标位置就近弹出） */}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems()} onClose={() => setCtx(null)} />}
    </div>
  );
}

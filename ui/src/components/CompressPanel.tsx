import { useMemo, useState } from "react";
import { Button, IconBtn, Icon, Select, Toggle, fmtSize, fmtETA, useTip } from "./ui";
import { MOCK_CMP, COMPRESS_MODES, type CmpTask } from "../mock";
import { useDragSort } from "../hooks/useDragSort";

const ROW_H = 58; // 52px 行高 + 6px 间距

/* ============ 压缩任务行 ============ */
function CmpRow({
  t,
  onMode,
  onStop,
  onRestart,
  onTop,
  onDelete,
  drag,
}: {
  t: CmpTask;
  onMode: (m: string) => void;
  onStop: (t: CmpTask) => void;
  onRestart: (t: CmpTask) => void;
  onTop: (t: CmpTask) => void;
  onDelete: (t: CmpTask) => void;
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
      : t.status === "stopped" || t.status === "skipped"
        ? "bg-amber-row"
        : "bg-white";

  const statusText: Record<string, string> = {
    running: "压缩中",
    queued: "排队中",
    done: "已完成",
    stopped: "已终止",
    skipped: "收益小，已跳过",
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

      <div className="relative grid grid-cols-[1fr_110px_1fr_130px_110px_80px_36px] items-center h-[52px] px-3 gap-2">
        {/* 状态 + 文件名 */}
        <div className="min-w-0" onMouseEnter={(e) => show(e.currentTarget, t.name)}>
          <div className="text-[13px] text-text-main truncate">{t.name}</div>
          <div className="text-[11px] text-text-sub mt-0.5">{statusText[t.status]}</div>
        </div>

        {/* 原文件大小 */}
        <div className="text-[12px] text-text-sub tabular-nums">{fmtSize(t.orig)}</div>

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
        </div>

        {/* 模式（运行中变灰） */}
        <div>
          {t.status === "queued" || t.status === "done" || t.status === "stopped" ? (
            <Select value={t.mode} onChange={(m) => onMode(m)} options={COMPRESS_MODES} className="w-full" />
          ) : (
            <Select value={t.mode} onChange={() => {}} options={COMPRESS_MODES} disabled className="w-full" />
          )}
        </div>

        {/* 操作 */}
        <div className="flex items-center justify-end gap-1">
          {isRunning && (
            <IconBtn tip="终止压缩（无法从断点继续）" onClick={() => onStop(t)} className="hover:text-danger hover:bg-danger/10">
              <Icon d="M7 7h10v10H7z" size={18} />
            </IconBtn>
          )}
          {t.status === "stopped" && (
            <IconBtn tip="重新压缩" onClick={() => onRestart(t)}>
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

        {/* 占位（保持列宽对齐） */}
        <div className="w-[2px]" />
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
      className={`relative rounded-lg border border-border-soft mb-1.5 overflow-hidden ${baseBg}
        ${draggable ? "cursor-grab active:cursor-grabbing select-none" : ""}
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
export function CompressPanel({ compressWorkers = 3 }: { compressWorkers?: number }) {
  const [tasks, setTasks] = useState<CmpTask[]>(MOCK_CMP);
  const [defMode, setDefMode] = useState("default");
  const [shutdown, setShutdown] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const show = useTip();

  const move = (id: string, fn: (t: CmpTask) => CmpTask) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));

  const setStatus = (id: string, status: CmpTask["status"]) => move(id, (t) => ({ ...t, status }));

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

  const remove = (id: string) => setTasks((prev) => prev.filter((t) => t.id !== id));

  const addMock = () => {
    setTasks((prev) => [
      ...prev,
      {
        id: `c${Date.now()}`,
        name: `新增视频-${Math.floor(Math.random() * 99) + 1}.mkv`,
        status: "queued",
        orig: Math.round((300 + Math.random() * 500) * 1024 ** 2),
        mode: defMode,
      },
    ]);
  };

  /* 排序分区：压缩中固定顶部不动；排队中可拖拽排序；完成/终止固定底部 */
  const runningTasks = tasks.filter((t) => t.status === "running");
  const queuedTasks = tasks.filter((t) => t.status === "queued");
  const endedTasks = tasks.filter(
    (t) => t.status === "done" || t.status === "stopped" || t.status === "skipped",
  );

  /* 拖拽排序（自定义指针实现：拎起浮行 + 其他行平滑挤开），仅作用于排队区 */
  const dragSort = useDragSort<CmpTask>(queuedTasks, ROW_H, () => true, (next) => {
    setTasks([...runningTasks, ...next, ...endedTasks]);
  });

  /* 收益统计：原大小 × (1 - 压缩比) 求和，仅已完成行 */
  const gain = useMemo(() => {
    return tasks
      .filter((t) => t.status === "done" && t.orig && t.ratio !== undefined)
      .reduce((acc, t) => acc + t.orig * (1 - (t.ratio ?? 0) / 100), 0);
  }, [tasks]);

  const runningCount = runningTasks.length;

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setFileOver(true);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      e.preventDefault();
      setFileOver(false);
      setTasks((prev) => [
        ...prev,
        ...Array.from(files).map((f, i) => ({
          id: `c${Date.now()}${i}`,
          name: f.name || `拖入文件-${i + 1}`,
          status: "queued" as const,
          orig: 0,
          mode: defMode,
        })),
      ]);
      return;
    }
    const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list");
    if (text.trim()) {
      e.preventDefault();
      setTasks((prev) => [
        ...prev,
        { id: `c${Date.now()}`, name: text.trim().split("/").pop() || text.trim(), status: "queued" as const, orig: 0, mode: defMode },
      ]);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 工具条 */}
      <div className="shrink-0 p-4 pb-3 flex items-center gap-2">
        <Button variant="soft" onClick={addMock}>
          <Icon d="M12 5v14M5 12h14" size={14} />
          添加视频
        </Button>
        <Button variant="soft" onClick={addMock} onMouseEnter={(e) => show(e.currentTarget, "递归添加文件夹内全部视频")}>
          <Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" size={14} />
          添加文件夹
        </Button>

        <div className="flex items-center gap-1.5 ml-2 text-[12px] text-text-sub">
          默认模式
          <Select value={defMode} onChange={setDefMode} options={COMPRESS_MODES} className="w-[130px]" />
        </div>

        <div className="flex-1" />

        <Button onClick={addMock} disabled={runningCount >= compressWorkers}>
          <Icon d="M8 5v14l11-7z" size={13} />
          开始压缩
        </Button>
        <Button variant="ghost" onClick={() => setTasks((p) => p.filter((t) => t.status !== "done" && t.status !== "stopped"))}>
          清空已完成
        </Button>
      </div>

      {/* 任务列表 */}
      <div className="flex-1 min-h-0 px-4 pb-3 flex flex-col">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <div className="text-[12px] font-semibold text-text-main">
            压缩任务 <span className="text-text-sub font-normal">（{tasks.length} 项）</span>
          </div>
          <div className="text-[11px] text-text-sub">可拖入文件 · 排队中可拖动调整优先级</div>
        </div>
        <div
          onDragOver={handleDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false);
          }}
          onDrop={handleDrop}
          className={`relative flex-1 min-h-0 overflow-y-auto pr-1 rounded-lg transition-colors ${
            fileOver ? "bg-brand-50 ring-2 ring-brand-400/70 ring-inset" : ""
          }`}
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
                  onMode={(m) => move(t.id, (x) => ({ ...x, mode: m }))}
                  onStop={(x) => setStatus(x.id, "stopped")}
                  onRestart={(x) => setStatus(x.id, "queued")}
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
                      onMode={(m) => move(t.id, (x) => ({ ...x, mode: m }))}
                      onStop={(x) => setStatus(x.id, "stopped")}
                      onRestart={(x) => setStatus(x.id, "queued")}
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
                  onMode={(m) => move(t.id, (x) => ({ ...x, mode: m }))}
                  onStop={(x) => setStatus(x.id, "stopped")}
                  onRestart={(x) => setStatus(x.id, "queued")}
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
    </div>
  );
}

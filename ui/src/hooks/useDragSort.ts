import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 列表内拖拽排序（自定义指针实现，非 HTML5 DnD）：
 * - 拖起行浮起跟随鼠标（absolute + shadow + scale），有"拎起"感
 * - 其他行用 transform + transition 平滑挤开/让位（丝滑位移）
 * - 松开落定后重排
 */
export function useDragSort<T extends { id: string }>(
  items: T[],
  rowHeight: number, // 行高 + 行间距（px）
  canDrag: (t: T) => boolean,
  onReorder: (next: T[]) => void,
) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragTop, setDragTop] = useState(0); // 拖起行视口 top（fixed 定位）
  const [dragLeft, setDragLeft] = useState(0);
  const [dragWidth, setDragWidth] = useState(0);
  const [insertIdx, setInsertIdx] = useState<number | null>(null); // 新数组中拖起行的位置
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef(0); // 鼠标按下时相对行顶的偏移（保持"拎起"位置）
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const origIdx = dragId ? items.findIndex((t) => t.id === dragId) : -1;
  const dragging = dragId !== null;

  /* 行上按下：仅可拖行 + 非控件区域启动 */
  const onRowMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.button !== 0) return; // 只左键拖拽；右键留给 contextmenu（行右键菜单）
      const t = itemsRef.current.find((x) => x.id === id);
      if (!t || !canDrag(t)) return;
      if ((e.target as HTMLElement).closest("button, select, input, a")) return;
      e.preventDefault();
      const rowEl = e.currentTarget as HTMLElement;
      const rect = rowEl.getBoundingClientRect();
      const cRect = containerRef.current?.getBoundingClientRect();
      if (!cRect) return;
      dragOffset.current = e.clientY - rect.top;
      setDragLeft(rect.left);
      setDragWidth(rect.width);
      setDragTop(rect.top);
      setDragId(id);
      setInsertIdx(itemsRef.current.findIndex((x) => x.id === id));
    },
    [canDrag],
  );

  /* 拖动：fixed 视口坐标直接跟手；槽位以浮行视觉中心判断（看浮行在哪就插到哪） */
  const handleMove = useCallback(
    (clientY: number) => {
      if (!dragId || !containerRef.current) return;
      const dragOffsetNow = dragOffset.current;
      setDragTop(clientY - dragOffsetNow);

      const cRect = containerRef.current.getBoundingClientRect();
      const list = itemsRef.current;
      const n = list.length;
      const orig = list.findIndex((t) => t.id === dragId);
      if (orig === -1) return;
      // 浮行视觉中心（视口坐标）= 鼠标 - 按下偏移 + 半行高
      const floatCenter = clientY - dragOffsetNow + rowHeight / 2;
      const mouseY = floatCenter - cRect.top;
      // 物理槽位（不含拖起行：有效行占 0..n-2 槽）
      let p = Math.floor(mouseY / rowHeight);
      p = Math.max(0, Math.min(p, n - 2));
      const mid = (p + 0.5) * rowHeight;
      const insert = mouseY < mid ? p : p + 1;
      setInsertIdx(insert);
    },
    [dragId, rowHeight],
  );

  /* 松开：提交重排 */
  const commit = useCallback(() => {
    if (!dragId) return;
    const list = itemsRef.current;
    const orig = list.findIndex((t) => t.id === dragId);
    if (orig !== -1) {
      const insert = insertIdx ?? orig;
      const next = [...list];
      const [moving] = next.splice(orig, 1);
      next.splice(insert, 0, moving);
      onReorder(next);
    }
    setDragId(null);
    setInsertIdx(null);
  }, [dragId, insertIdx, onReorder]);

  /* 拖动期间 window 级监听（鼠标移出容器仍有效） */
  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: MouseEvent) => handleMove(e.clientY);
    const onUp = () => commit();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragId, handleMove, commit]);

  /* 每行渲染参数：浮起 / 位移 / 插入指示 */
  const rowProps = (t: T, i: number) => {
    const isDrag = dragId === t.id;
    if (isDrag) {
      return {
        isDragging: true,
        draggingTop: dragTop,
        draggingLeft: dragLeft,
        draggingWidth: dragWidth,
        deltaY: 0,
        isInsertBefore: false,
        isInsertAfter: false,
      };
    }
    let delta = 0;
    let isInsertBefore = false;
    let isInsertAfter = false;
    if (dragId && insertIdx !== null && origIdx >= 0) {
      // 移除拖起行后该行的序号
      let j = i - (i > origIdx ? 1 : 0);
      if (j >= insertIdx) j += 1;
      delta = (j - i) * rowHeight;
      const j0 = i - (i > origIdx ? 1 : 0);
      isInsertBefore = j0 === insertIdx;
      isInsertAfter = j0 === insertIdx - 1;
    }
    return { isDragging: false, draggingTop: 0, draggingLeft: 0, draggingWidth: 0, deltaY: delta, isInsertBefore, isInsertAfter };
  };

  return {
    dragging,
    dragId,
    containerRef,
    onRowMouseDown,
    rowProps,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 列表内拖拽排序（自定义指针实现，非 HTML5 DnD）：
 * - 拖起行浮起跟随鼠标（absolute + shadow + scale），有"拎起"感
 * - 其他行用 transform + transition 平滑挤开/让位（丝滑位移）
 * - 松开落定后重排
 * - 按下后移动 <5px 视为"点击"（触发 onRowClick，供多选使用），≥5px 才进入拖拽
 */
export function useDragSort<T extends { id: string }>(
  items: T[],
  rowHeight: number, // 行高 + 行间距（px）
  canDrag: (t: T) => boolean,
  onReorder: (next: T[]) => void,
  onRowClick?: (id: string, e: MouseEvent) => void, // 新增：按下未拖拽（点击）回调
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

  /* 同步镜像：setState 异步，事件回调里读最新值 */
  const dragIdRef = useRef<string | null>(null);
  const insertIdxRef = useRef<number | null>(null);
  const pressRef = useRef<{ id: string; y: number } | null>(null);

  const startDrag = (id: string) => {
    dragIdRef.current = id;
    setDragId(id);
  };
  const endDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    insertIdxRef.current = null;
    setInsertIdx(null);
  };

  const origIdx = dragId ? items.findIndex((t) => t.id === dragId) : -1;
  const dragging = dragId !== null;

  /* 行上按下：仅可拖行 + 非控件区域；记录起点，超移动阈值才算拖拽，否则视为点击 */
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
      pressRef.current = { id, y: e.clientY };
    },
    [canDrag],
  );

  /* 拖动：fixed 视口坐标直接跟手；槽位以浮行视觉中心判断（看浮行在哪就插到哪） */
  const handleMove = useCallback(
    (e: MouseEvent) => {
      const clientY = e.clientY;
      const press = pressRef.current;
      if (!dragIdRef.current && press) {
        // 未拖拽：移动超阈值（5px）才正式进入拖拽
        if (Math.abs(clientY - press.y) > 5) {
          startDrag(press.id);
          const idx = itemsRef.current.findIndex((x) => x.id === press.id);
          insertIdxRef.current = idx;
          setInsertIdx(idx);
        } else {
          return; // 还在点击判定区，未拖拽
        }
      }
      if (!dragIdRef.current || !containerRef.current) return;
      const dragOffsetNow = dragOffset.current;
      setDragTop(clientY - dragOffsetNow);

      const cRect = containerRef.current.getBoundingClientRect();
      const list = itemsRef.current;
      const n = list.length;
      const orig = list.findIndex((t) => t.id === dragIdRef.current);
      if (orig === -1) return;
      // 浮行视觉中心（视口坐标）= 鼠标 - 按下偏移 + 半行高
      const floatCenter = clientY - dragOffsetNow + rowHeight / 2;
      const mouseY = floatCenter - cRect.top;

      /* 插入位置按"视觉行实际位置"判断（不用均匀网格）：
         拖拽中其他行已补位/让位（delta 位移），均匀网格会与视觉错位——拖得越远偏差越明显。
         用与 rowProps 一致的 j 逻辑算每个有效行的视觉 top，找浮行中心落在哪个行内，
         超过该行 75% 高度插它后面，否则插它前面。 */
      const curIns = insertIdxRef.current ?? orig;
      const visTops: number[] = [];
      for (let i = 0; i < n; i++) {
        if (i === orig) continue;
        let j = i - (i > orig ? 1 : 0);
        if (j >= curIns) j += 1;
        visTops.push(j * rowHeight);
      }
      let insert = curIns;
      for (let k = 0; k < visTops.length; k++) {
        const top = visTops[k];
        const nextTop = k < visTops.length - 1 ? visTops[k + 1] : Infinity;
        if (mouseY >= top && mouseY < nextTop) {
          insert = mouseY - top > 0.75 * rowHeight ? k + 1 : k;
          break;
        }
      }
      // 浮行在列表上边界之上 / 下边界之下
      if (mouseY < (visTops[0] ?? 0)) insert = 0;
      else if (visTops.length > 0 && mouseY >= visTops[visTops.length - 1] + rowHeight) insert = n - 1;
      insert = Math.max(0, Math.min(insert, n - 1));
      insertIdxRef.current = insert;
      setInsertIdx(insert);
    },
    [rowHeight],
  );

  /* 松开：未拖拽 = 点击回调；已拖拽 = 提交重排 */
  const handleUp = useCallback(
    (e: MouseEvent) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (!dragIdRef.current) {
        if (press) onRowClick?.(press.id, e);
        return;
      }
      const list = itemsRef.current;
      const orig = list.findIndex((t) => t.id === dragIdRef.current);
      if (orig !== -1) {
        const insert = insertIdxRef.current ?? orig;
        const next = [...list];
        const [moving] = next.splice(orig, 1);
        next.splice(insert, 0, moving);
        onReorder(next);
      }
      endDrag();
    },
    [onReorder, onRowClick],
  );

  /* 按下期间 window 级监听（鼠标移出容器仍有效；mouseup 后自动解挂） */
  useEffect(() => {
    const onMove = (e: MouseEvent) => handleMove(e);
    const onUp = (e: MouseEvent) => handleUp(e);
    /* 窗口失焦（拖拽中弹窗/Alt-Tab 等）→ 终止拖拽，防止浮行/占位永久卡住盖住按钮 */
    const onBlur = () => {
      if (dragIdRef.current || pressRef.current) endDrag();
      pressRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [handleMove, handleUp]);

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

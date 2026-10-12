import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { diag } from "../diag";

/* ============ 基础按钮 ============ */
type BtnVariant = "primary" | "ghost" | "danger" | "soft" | "outline";
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 " +
    "disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer select-none";
  const sizes = {
    sm: "text-[13px] px-3 h-8",
    md: "text-[14px] px-3.5 h-9",
  };
  const variants: Record<BtnVariant, string> = {
    primary:
      "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm shadow-brand-500/25",
    ghost: "text-text-sub hover:bg-slate-100 hover:text-text-main",
    danger: "bg-danger/10 text-danger hover:bg-danger/20",
    soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 border border-border-brand",
    outline: "border border-border-soft bg-white text-text-main hover:border-brand-300 hover:text-brand-600",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/* ============ Tooltip（位置跟随）============ */
const TipCtx = createContext<(el: HTMLElement, text: string) => void>(() => {});
export const TipProvider = ({ children }: { children: ReactNode }) => {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback((el: HTMLElement, text: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    const r = el.getBoundingClientRect();
    setTip({ text, x: r.left + r.width / 2, y: r.top - 6 });
    timer.current = window.setTimeout(() => setTip(null), 2200);
  }, []);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <TipCtx.Provider value={show}>
      {children}
      {tip && (
        <div
          className="ez-tip"
          style={{ left: tip.x, top: tip.y, transform: "translate(-50%, -100%)" }}
        >
          {tip.text}
        </div>
      )}
    </TipCtx.Provider>
  );
};
export function useTip() {
  return useContext(TipCtx);
}

/* 带 tooltip 的图标按钮（默认 32px 点击区，适合行内操作） */
export function IconBtn({
  tip,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tip?: string }) {
  const show = useTip();
  return (
    <button
      className={`inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md text-text-sub hover:text-brand-600 hover:bg-brand-50 transition-colors cursor-pointer ${className}`}
      onMouseEnter={(e) => tip && show(e.currentTarget, tip)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ============ 方形 Toggle（用户指定：方形、无圆弧毛刺）============ */
export function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`w-9 h-5 shrink-0 rounded-[4px] transition-colors duration-150 cursor-pointer relative
        ${disabled ? "opacity-35 cursor-not-allowed" : ""}
        ${checked ? "bg-brand-500" : "bg-slate-300"}`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-[3px] bg-white shadow transition-all duration-150
          ${checked ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

/* ============ 下拉选择 ============ */
/* ============ 自定义下拉 ============
   原生 select 的 option 无法自定义底色，压缩模式需要"展开即可见紫色收益阶梯"，
   故重写为自定义下拉：触发按钮显示当前值底色，展开面板每行带各自色阶。
   面板用 createPortal 渲染到 body 顶层（fixed 定位），避免被列表容器 overflow 裁剪遮挡。 */
export type SelectOption = { value: string; label: string; tint?: string };
export function Select({
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  tint = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  /* 触发按钮底色（兼容旧调用；缺省时取当前选中项自身的 tint） */
  tint?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; bottom: number; left: number; width: number; up: boolean }>({
    top: 0,
    bottom: 0,
    left: 0,
    width: 120,
    up: false,
  });
  const cur = options.find((o) => o.value === value);
  const curTint = tint || cur?.tint || "";

  /* 点击外部（容器/面板之外）关闭 + Esc 关闭 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (ref.current && ref.current.contains(n)) return;
      if (panelRef.current && panelRef.current.contains(n)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const est = Math.min(options.length * 30 + 12, 200);
      setPos({
        top: r.bottom + 4,
        bottom: window.innerHeight - r.top + 4,
        left: r.left,
        width: r.width,
        up: window.innerHeight - r.bottom < est,
      });
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} className={`relative ${disabled ? "pointer-events-none opacity-40" : ""} ${className}`}>
      {/* 触发按钮：底色 = 当前选中模式色阶 */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        style={curTint ? { background: curTint } : undefined}
        className={`h-8 rounded-md border border-border-soft bg-white px-2.5 text-[14px] text-text-main
          flex items-center justify-between gap-1 cursor-pointer hover:border-brand-400
          focus:outline-2 focus:outline-brand-500 ${open ? "border-brand-400" : ""}`}
      >
        <span className="truncate">{cur?.label ?? value}</span>
        <span className="text-[11px] text-text-soft leading-none shrink-0">▾</span>
      </div>
      {/* 展开面板：portal 到 body 顶层，每行底色 = 该模式色阶（none/无 tint 为白底） */}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            className={`fixed z-[100] max-h-[220px] overflow-y-auto rounded-md border border-border-soft bg-white shadow-lg ${pos.up ? "mb-1" : "mt-1"}`}
            style={{
              left: pos.left,
              minWidth: pos.width,
              ...(pos.up ? { bottom: pos.bottom } : { top: pos.top }),
            }}
          >
            {options.map((o) => (
              <div
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                style={o.tint ? { background: o.tint } : undefined}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`px-2.5 py-1.5 text-[14px] cursor-pointer hover:bg-gray-100 flex items-center justify-between gap-1 whitespace-nowrap
                  ${o.value === value ? "font-semibold text-text-main" : "text-text-main"}`}
              >
                <span>{o.label}</span>
                {o.value === value && <span className="text-[11px] text-brand-600 leading-none">✓</span>}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ============ 进度条 ============ */
export function ProgressBar({
  pct,
  className = "",
  barClassName = "",
}: {
  pct: number;
  className?: string;
  barClassName?: string;
}) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className={`h-1.5 rounded-full bg-slate-200/80 overflow-hidden ${className}`}>
      <div
        className={`h-full bg-gradient-to-r from-brand-500 to-violet-brand transition-[width] duration-300 ${barClassName}`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

/* ============ 右键菜单（光标位置就近弹出）============ */
export type CtxItem = { label: string; onClick: () => void; danger?: boolean };
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: CtxItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    diag(`CTX mounted items=${items.length} at ${x},${y} vw=${window.innerWidth} vh=${window.innerHeight}`);
    /* 自检：800ms 后检查菜单 DOM 是否真实可见（定位"挂载但看不见"的实锤） */
    const checkTimer = window.setTimeout(() => {
      const el = document.querySelector("[data-ctx-menu]");
      if (el) {
        const r = el.getBoundingClientRect();
        diag(
          `CTX check rect=${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} ` +
            `onScreen=${r.width > 0 && r.height > 0} vw=${window.innerWidth} vh=${window.innerHeight} ` +
            `inViewport=${r.x >= 0 && r.y >= 0 && r.x < window.innerWidth && r.y < window.innerHeight}`,
        );
      } else {
        diag("CTX check NOT FOUND in DOM");
      }
    }, 800);
    const close = (e: Event) => {
      // 右键按下不关菜单（等 contextmenu 事件决定位置/关闭）
      if (e.type === "mousedown" && (e as MouseEvent).button !== 0) return;
      // 菜单内部点击不关闭：让 click 事件正常落到菜单项上（否则 mousedown 先卸载菜单，onClick 丢失）
      if (e.type === "mousedown" && e.target instanceof Element && e.target.closest("[data-ctx-menu]")) return;
      onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.clearTimeout(checkTimer);
      diag("CTX unmounted");
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [onClose, items.length, x, y]);
  /* Portal 到 body：右键菜单永远渲染在最顶层，不受容器 transform/overflow/z-index 干扰；
     贴窗口边缘时自动向内偏移（否则菜单被 WebView 裁掉/溢出） */
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    const pad = 4;
    if (nx + r.width > window.innerWidth - pad) nx = Math.max(pad, window.innerWidth - r.width - pad);
    if (ny + r.height > window.innerHeight - pad) ny = Math.max(pad, window.innerHeight - r.height - pad);
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);
  return createPortal(
    <div className="fixed z-[9999]" data-ctx-menu style={{ left: pos.x, top: pos.y }}>
      <div ref={menuRef} className="bg-white rounded-lg shadow-xl shadow-brand-900/15 border border-border-soft py-1 min-w-[150px]">
        {items.map((it, i) => (
          <button
            key={i}
            onClick={() => {
              it.onClick();
              onClose();
            }}
            className={`w-full text-left px-3.5 h-8.5 text-[14px] cursor-pointer hover:bg-brand-50 transition-colors ${it.danger ? "text-danger" : "text-text-main"}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/* ============ 模态对话框（默认居中）============ */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  height,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  height?: number;
}) {
  const openTs = useRef(Date.now());
  useEffect(() => {
    if (open) openTs.current = Date.now();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#14185e]/30 backdrop-blur-[2px]"
      onClick={(e) => {
        // 防止快速双击/连击触发按钮时，第二击落在遮罩上导致弹窗被秒关（此前 88ms 闪退无感知）
        if (e.target === e.currentTarget && Date.now() - openTs.current > 300) {
          onClose();
        }
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl shadow-brand-900/20 border border-border-soft flex flex-col max-h-[86vh] overflow-hidden"
        style={{ width, ...(height ? { height } : {}) }}
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-border-soft shrink-0">
          <div className="text-[16px] font-semibold text-brand-800 font-display">{title}</div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md inline-flex items-center justify-center text-text-sub hover:bg-slate-100 hover:text-text-main cursor-pointer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto overflow-x-hidden flex-1 min-h-0">{children}</div>
        {footer && <div className="shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

/* ============ 行内提示文案 ============ */
export function FieldRow({
  label,
  children,
  hint,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 min-h-10 ${disabled ? "opacity-45" : ""}`}>
      <div className="w-[210px] shrink-0 text-[15px] text-text-main leading-snug break-words">{label}</div>
      <div className="flex items-center gap-2 flex-1 min-w-0">{children}</div>
      {hint && <div className="text-[12px] text-text-sub leading-4 shrink-0 break-words">{hint}</div>}
    </div>
  );
}

/* ============ 状态圆点（当前面板黑/隐藏干活绿闪/失败黄）============ */
export function StatusDot({ mode }: { mode: "active" | "busy" | "fail" | "idle" }) {
  const cls =
    mode === "active"
      ? "bg-text-main"
      : mode === "busy"
        ? "bg-ok ez-breathe"
        : mode === "fail"
          ? "bg-warn"
          : "bg-slate-300";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}

/* ============ 文件大小格式化 ============ */
export function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(0) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}

export function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 ** 2) return (bytesPerSec / 1024 ** 2).toFixed(1) + " MB/s";
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(0) + " KB/s";
  return bytesPerSec + " B/s";
}

export function fmtETA(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${Math.round(sec % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/* ============ 小 SVG 图标集（线性）============ */
export function Icon({ d, size = 16, strokeWidth = 2 }: { d: string; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
export const I = {
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  pause: "M10 4v16M14 4v16",
  play: "M8 5v14l11-7z",
  trash: "M3 6h18M8 6V4h8v2m1 0 1 14H6L5 6m5 5v6m4-6v6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z",
  up: "M12 19V5m0 0-6 6m6-6 6 6",
  stop: "M7 7h10v10H7z",
  open: "M14 4h6v6m0-6L9 15m11-11v6",
  paste: "M9 5h6a2 2 0 0 1 2 2v9m-4 3H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2",
  close: "M18 6 6 18M6 6l12 12",
  check: "M4 12.5 9 17.5 20 6.5",
  warn: "M12 8v5m0 4v.5M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  plus: "M12 5v14M5 12h14",
};

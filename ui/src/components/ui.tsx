import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";

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
    sm: "text-[12px] px-2.5 h-7",
    md: "text-[13px] px-3.5 h-8",
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
export function Select({
  value,
  onChange,
  options,
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`h-7 rounded-md border border-border-soft bg-white px-2 text-[12px] text-text-main
        focus:outline-2 focus:outline-brand-500 disabled:opacity-40 cursor-pointer ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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

/* ============ 模态对话框（默认居中）============ */
export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#14185e]/30 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-white rounded-xl shadow-2xl shadow-brand-900/20 border border-border-soft flex flex-col max-h-[86vh]"
        style={{ width }}
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-border-soft shrink-0">
          <div className="text-[14px] font-semibold text-brand-800 font-display">{title}</div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md inline-flex items-center justify-center text-text-sub hover:bg-slate-100 hover:text-text-main cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
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
    <div className={`flex items-center gap-3 min-h-9 ${disabled ? "opacity-45" : ""}`}>
      <div className="w-[190px] shrink-0 text-[13px] text-text-main">{label}</div>
      <div className="flex items-center gap-2 flex-1">{children}</div>
      {hint && <div className="text-[11px] text-text-sub leading-4 shrink-0">{hint}</div>}
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

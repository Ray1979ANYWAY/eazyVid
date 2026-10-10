import { useId } from "react";

/**
 * eazyVid 品牌 Logo —— 复刻 ico/eazyVid.svg：
 * 白底异形底盘 + 蓝→紫渐变中心圆 + 白色播放三角 + 对角压缩直角标
 * size: 渲染边长（px）
 */
export function Logo({ size = 40, rounded = true }: { size?: number; rounded?: boolean }) {
  const id = useId().replace(/:/g, "");
  const gradCircle = `gradCircle-${id}`;
  const gradBL = `gradBL-${id}`;
  const gradTR = `gradTR-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      style={{ display: "block", borderRadius: rounded ? size * 0.14 : 0 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradCircle} x1="15%" y1="85%" x2="85%" y2="15%">
          <stop offset="0%" stopColor="#005CE6" />
          <stop offset="25%" stopColor="#0C34B8" />
          <stop offset="55%" stopColor="#14185E" />
          <stop offset="80%" stopColor="#501A94" />
          <stop offset="100%" stopColor="#7B2CBF" />
        </linearGradient>
        <linearGradient id={gradBL} x1="0%" y1="100%" x2="50%" y2="50%">
          <stop offset="0%" stopColor="#005CE6" />
          <stop offset="100%" stopColor="#0A44C9" />
        </linearGradient>
        <linearGradient id={gradTR} x1="50%" y1="50%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6F22B5" />
          <stop offset="100%" stopColor="#7B2CBF" />
        </linearGradient>
      </defs>

      <path
        d="M 152 32 L 480 32 L 480 360 C 480 426.27 426.27 480 360 480 L 32 480 L 32 152 C 32 85.73 85.73 32 152 32 Z"
        fill="#FFFFFF"
        stroke="#E5E7EB"
        strokeWidth="2"
      />
      <path d="M 336 64 H 448 V 176 H 420 V 92 H 336 Z" fill={`url(#${gradTR})`} />
      <path d="M 64 336 V 448 H 176 V 420 H 92 V 336 Z" fill={`url(#${gradBL})`} />
      <circle cx="256" cy="256" r="144" fill={`url(#${gradCircle})`} />
      <path
        d="M 218 188 C 212 184 204 188 204 196 L 204 316 C 204 324 212 328 218 324 L 316 264 C 322 260 322 252 316 248 Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

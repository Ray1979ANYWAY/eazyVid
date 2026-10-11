/* ============ UI 演示用 mock 数据（引擎接入后替换）============ */

export type DlFormat = {
  id: string;
  res: string;
  codec: string;
  size: string;
  ext: string;
  videoOnly?: boolean;
  warn?: boolean;
  warnText?: string;
};

export type DlTask = {
  id: string;
  taskId?: number;
  name: string;
  path?: string; // 引擎 out：下载完成后的文件路径
  status: "downloading" | "waiting" | "paused" | "done" | "failed" | "merging" | "parsing";
  got: number;
  total: number;
  speed: number | string;
  compressMode?: string; // "none"=不压缩；否则为 COMPRESS_MODES 值（下载完成后自动入压缩队列用）
};

export type CmpTask = {
  id: string;
  name: string;
  path?: string;
  cmpId?: number;
  status: "running" | "queued" | "done" | "stopped" | "skipped" | "failed";
  orig: number;
  mode: string;
  pct?: number;
  etaSec?: number;
  pos?: string;
  dur?: string;
  outSize?: number;
  ratio?: number;
  elapsed?: string;
  startTs?: number;
  outPath?: string; // 引擎 done 事件携带的实际输出路径（覆盖模式下即替换后的文件）
};

export const MOCK_FORMATS: DlFormat[] = [
  { id: "f1", res: "1080p", codec: "H.264", size: "320.6 MB", ext: "mp4" },
  { id: "f2", res: "1080p", codec: "AV1", size: "198.2 MB", ext: "webm", warn: true, warnText: "AV1 兼容性差，多数播放器无法硬解" },
  { id: "f3", res: "720p", codec: "H.264", size: "148.4 MB", ext: "mp4" },
  { id: "f4", res: "480p", codec: "H.264", size: "72.1 MB", ext: "mp4" },
  { id: "f5", res: "360p", codec: "H.264", size: "41.6 MB", ext: "mp4" },
];

export const MOCK_DL: DlTask[] = [
  { id: "d1", name: "老友记.H265.1080P.SE01.01.mkv", status: "downloading", got: 208 * 1024 ** 2, total: 686 * 1024 ** 2, speed: 6.2 * 1024 ** 2 },
  { id: "d2", name: "4K 城市夜景延时摄影.mp4", status: "merging", got: 412 * 1024 ** 2, total: 412 * 1024 ** 2, speed: 0 },
  { id: "d6", name: "纪录片 - 地球脉动.S02E01.mkv", status: "waiting", got: 0, total: 1240 * 1024 ** 2, speed: 0 },
  { id: "d3", name: "BBC 纪录片 - 蓝色星球.1080p.mp4", status: "paused", got: 512 * 1024 ** 2, total: 940 * 1024 ** 2, speed: 0 },
  { id: "d5", name: "课程录像 - 高等数学第12讲.mp4", status: "failed", got: 96 * 1024 ** 2, total: 260 * 1024 ** 2, speed: 0 },
  { id: "d4", name: "YouTube 音乐现场 - Live in Tokyo.mkv", status: "done", got: 178 * 1024 ** 2, total: 178 * 1024 ** 2, speed: 0 },
];

export const MOCK_CMP: CmpTask[] = [
  { id: "c1", name: "老友记.H265.1080P.SE02.03.mkv", status: "running", orig: 712 * 1024 ** 2, mode: "默认", pct: 38, etaSec: 1540, pos: "08:42", dur: "22:41" },
  { id: "c2", name: "老友记.H265.1080P.SE02.04.mkv", status: "running", orig: 698 * 1024 ** 2, mode: "默认", pct: 12, etaSec: 2310, pos: "02:47", dur: "22:33" },
  { id: "c3", name: "老友记.H265.1080P.SE02.05.mkv", status: "queued", orig: 705 * 1024 ** 2, mode: "默认" },
  { id: "c4", name: "老友记.H265.1080P.SE02.06.mkv", status: "queued", orig: 683 * 1024 ** 2, mode: "默认" },
  { id: "c5", name: "老友记.H265.1080P.SE01.07.mkv", status: "done", orig: 686 * 1024 ** 2, mode: "默认", outSize: 465 * 1024 ** 2, ratio: 32.3, elapsed: "52分18秒" },
  { id: "c6", name: "老友记.H265.1080P.SE01.08.mkv", status: "done", orig: 692 * 1024 ** 2, mode: "默认", outSize: 326 * 1024 ** 2, ratio: 52.9, elapsed: "48分06秒" },
  { id: "c7", name: "720p 修复版 - 老友记特别篇.mkv", status: "stopped", orig: 892 * 1024 ** 2, mode: "默认" },
];

/* 压缩模式下拉底色：紫色色阶表示压缩程度（品牌紫 #7B2CBF 呼应，统一 30% 透明度）。
   画质优先（体积收益最小）最浅 → 默认 → 速度优先 → AV1 极限压缩（最狠）最深；
   最深即图标品牌紫，避免更深。 */
export const MODE_TINTS: Record<string, string> = {
  hq: "rgba(215, 198, 234, 0.30)",
  default: "rgba(189, 161, 220, 0.30)",
  fast: "rgba(157, 113, 205, 0.30)",
  av1: "rgba(123, 44, 191, 0.30)",
};

export const COMPRESS_MODES = [
  { value: "default", label: "默认（均衡）", tint: MODE_TINTS.default },
  { value: "hq", label: "画质优先", tint: MODE_TINTS.hq },
  { value: "fast", label: "速度优先", tint: MODE_TINTS.fast },
  { value: "av1", label: "AV1 极限压缩", tint: MODE_TINTS.av1 },
];

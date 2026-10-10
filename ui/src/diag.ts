/* 前端诊断锚：把关键交互事件发到引擎探针（engine_reqs.txt），供离线排查。
   纯调试用途；非 Tauri 环境（浏览器预览）自动静默。 */
import { invoke } from "@tauri-apps/api/core";

export function diag(line: string) {
  try {
    void invoke("engine_send", { line: JSON.stringify({ cmd: "diag", line }) }).catch(() => {});
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}

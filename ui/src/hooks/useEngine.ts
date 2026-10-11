/* eazyVid 引擎桥接：Rust spawn 的 Python engine_rpc.py
   call() 发命令（Promise 匹配响应）；on() 订阅引擎事件流（进度/状态） */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type EngineEvent = {
  ev?: string;
  [k: string]: unknown;
};

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let seq = 1;
const pending = new Map<number, Pending>();
const listeners = new Set<(ev: EngineEvent) => void>();
let engineReady = false;
const readyWaiters = new Set<() => void>();
let started = false;

function ensureListening() {
  if (started) return;
  started = true;
  listen<string>("engine:event", (e) => {
    let obj: EngineEvent | null = null;
    try {
      obj = JSON.parse(e.payload) as EngineEvent;
    } catch {
      return;
    }
    if (obj == null) return;
    // 命令响应：带 id 且非事件（事件如 cmp/dl 的 id 是任务 id，不能当响应匹配）
    const id = obj.id as number | undefined;
    if (id != null && obj.ev == null) {
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        if (obj.ok === true) p.resolve(obj);
        else p.reject(new Error(String(obj.error || "引擎错误")));
      }
      return;
    }
    if (obj.ev === "ready") {
      engineReady = true;
      readyWaiters.forEach((fn) => fn());
      readyWaiters.clear();
      return;
    }
    listeners.forEach((fn) => fn(obj as EngineEvent));
  }).catch(() => {});
}

export function useEngine() {
  const [ready, setReady] = useState(engineReady);
  const mounted = useRef(true);

  useEffect(() => {
    ensureListening();
    mounted.current = true;
    if (!engineReady) {
      const onReady = () => {
        if (mounted.current) setReady(true);
      };
      readyWaiters.add(onReady);
      return () => {
        mounted.current = false;
        readyWaiters.delete(onReady);
      };
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  const call = useCallback((cmd: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const id = seq++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      invoke("engine_send", {
        line: JSON.stringify({ id, cmd, ...params }),
      }).catch((e) => {
        pending.delete(id);
        reject(new Error(String(e)));
      });
    });
  }, []);

  const on = useCallback((fn: (ev: EngineEvent) => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return { ready, call, on };
}

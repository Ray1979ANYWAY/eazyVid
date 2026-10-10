# -*- coding: utf-8 -*-
"""eazyVid 引擎 RPC 服务（stdio JSON 行协议）
被 Tauri(Rust) 主进程 spawn；stdin 收命令，stdout 逐行 JSON（响应/事件）。
命令：
  {"id":1,"cmd":"ping"}
  {"id":2,"cmd":"probe","url":"...","timeout":90,"force_cookie":false}
  {"id":3,"cmd":"dl_add","url":"...","fmt_id":"...","out_dir":"...","title":"...","size":123,"workers":3,"use_cookie":false,"referer":null}
  {"id":4,"cmd":"dl_pause","task_id":1}
  {"id":5,"cmd":"dl_resume","task_id":1}
  {"id":6,"cmd":"dl_remove","task_id":1}          # 删除临时缓存（UI 已决定移出列表）
  {"id":7,"cmd":"cmp_add","path":"...","mode":"default","out_dir":null,"cover_sec":null,"overwrite":false}
  {"id":8,"cmd":"cmp_stop","id":1}
  {"id":9,"cmd":"quit"}
事件（stdout 行，无 id 字段）：
  {"ev":"dl","task_id":1,"state":"waiting|downloading|paused|done|failed|merging","pct":27.0,"got":123,"total":456,"speed":"5.4MiB/s","title":"..."}
  {"ev":"cmp","id":1,"state":"compressing|done|failed|stopped","pct":38.0,"pos":"08:42","dur":"22:41","eta":1540,"out":"...","ratio":32.3,"elapsed":"52分18秒","orig":123,"error":"..."}
"""
import json
import os
import sys
import threading

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdin.reconfigure(encoding="utf-8", errors="replace")

import eazyvid  # noqa: E402  （项目根模块：探测/下载/压缩引擎）

_lock = threading.Lock()


def emit(obj):
    """原子写一行 JSON（多线程安全）"""
    line = json.dumps(obj, ensure_ascii=False)
    with _lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def reply(req_id, **kw):
    emit({"id": req_id, **kw})


# ---------- 下载池（复用引擎 DownloadPool，UI 回调替换为 RPC 事件） ----------
_dl_pool = None
_dl_pool_lock = threading.Lock()


class _RpcUI:
    """DownloadTask.ui 的假壳：tkinter 版用 ui 门控进度回调，
    RPC 版无真实组件——挂上占位对象让进度/速度事件正常流出。
    属性需满足 eazyvid 的访问：ui.refresh()、ui.frame.destroy()"""

    def refresh(self):
        pass

    frame = None


def _fmt_speed(s):
    """yt-dlp 速度串 → 紧凑：803K/S / 1.9M/S（UI 直接显示）"""
    try:
        import re
        m = re.match(r"([\d.]+)(MiB|GiB|KiB|B)/s", str(s or "").strip())
        if not m:
            return ""
        v = float(m.group(1)) * {"B": 1, "KiB": 1024, "MiB": 1048576, "GiB": 1073741824}[m.group(2)]
        if v >= 1073741824:
            return f"{v / 1073741824:.1f}G/S"
        if v >= 1048576:
            x = v / 1048576
            return f"{x:.1f}M/S" if x < 10 else f"{int(round(x))}M/S"
        if v >= 1024:
            return f"{int(round(v / 1024))}K/S"
        return f"{int(v)}B/S"
    except Exception:
        return ""


def _dl_state(task):
    """DownloadTask → UI 状态（merging：pct≥100 且进程未结束 = 合并音轨中）"""
    if task.state == "downloading":
        if task.progress >= 100.0 and task.proc is not None and task.proc.poll() is None:
            return "merging"
        return "downloading"
    return task.state


def _dl_event(kind, task):
    emit({
        "ev": "dl",
        "task_id": task.task_id,
        "state": _dl_state(task),
        "pct": round(min(100.0, task.progress), 1),
        "got": int(task.dl_bytes or 0),
        "total": int(task._total_bytes or 0),
        "speed": _fmt_speed(task.speed),
        "title": task.title or "",
        "out": task.out_path or "",
        "kind": kind,  # added / progress / done / paused / removed
    })


def _get_dl_pool(workers):
    global _dl_pool
    with _dl_pool_lock:
        if _dl_pool is None:
            def on_update(evt):
                kind, task = evt
                _dl_event(kind, task)
            _dl_pool = eazyvid.DownloadPool(on_update, lambda msg: emit({"ev": "log", "msg": msg}),
                                            max_concurrent=max(1, int(workers or 3)))
        else:
            # workers 变化：重建信号量（简单起见：换新池，旧任务已完成/被清理）
            if int(workers or 3) != _dl_pool.sem._value:
                old = _dl_pool
                def on_update2(evt):
                    kind, task = evt
                    _dl_event(kind, task)
                _dl_pool = eazyvid.DownloadPool(on_update2, lambda msg: emit({"ev": "log", "msg": msg}),
                                                max_concurrent=max(1, int(workers or 3)))
                for t in list(old.tasks):
                    if t.state in ("waiting", "downloading"):
                        eazyvid._kill_proc_tree(t.proc)
        return _dl_pool


def _cmd_dl_add(req):
    pool = _get_dl_pool(req.get("workers", 3))
    out_dir = req.get("out_dir") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloaded")
    os.makedirs(out_dir, exist_ok=True)
    t = pool.add(
        req["url"], req.get("fmt_id") or "", out_dir, "download",
        req.get("title") or "视频", req.get("use_cookie", False),
        req.get("referer"), size=req.get("size"),
    )
    t.ui = _RpcUI()  # 挂假 UI 壳：进度/速度/总大小回调才会流出
    reply(req["id"], ok=True, task_id=t.task_id, state=t.state)


def _cmd_dl_pause(req):
    for t in list((_dl_pool or []).tasks if _dl_pool else []):
        if t.task_id == int(req.get("task_id", -1)):
            t.pause()
            reply(req["id"], ok=True)
            return
    reply(req["id"], ok=False, error="任务不存在")


def _cmd_dl_resume(req):
    for t in list((_dl_pool or []).tasks if _dl_pool else []):
        if t.task_id == int(req.get("task_id", -1)):
            t.resume()
            reply(req["id"], ok=True)
            return
    reply(req["id"], ok=False, error="任务不存在")


def _cmd_dl_retry(req):
    """失败任务重新下载：重置进度、清临时缓存、排入等待队列尾"""
    for t in list((_dl_pool or []).tasks if _dl_pool else []):
        if t.task_id == int(req.get("task_id", -1)):
            t.retry()
            reply(req["id"], ok=True)
            return
    reply(req["id"], ok=False, error="任务不存在")


def _cmd_dl_remove(req):
    for t in list((_dl_pool or []).tasks if _dl_pool else []):
        if t.task_id == int(req.get("task_id", -1)):
            if _dl_pool:
                _dl_pool.remove(t)
            emit({"ev": "dl", "task_id": t.task_id, "state": "removed", "pct": 0, "got": 0,
                  "total": 0, "speed": "", "title": t.title or "", "out": "", "kind": "removed"})
            reply(req["id"], ok=True)
            return
    reply(req["id"], ok=False, error="任务不存在")


# ---------- 压缩（单任务：add 即起线程，UI 压缩队列下一轮接） ----------
_cmp_running = {}
_cmp_lock = threading.Lock()
_cmp_seq = [0]


def _compress_worker(req, rec):
    path = req["path"]
    mode = req.get("mode", "default")
    out_dir = req.get("out_dir") or None
    cover_sec = req.get("cover_sec")
    overwrite = req.get("overwrite", False)

    # started：先报原大小（UI 运行中显示）
    try:
        orig = os.path.getsize(path)
    except OSError:
        orig = 0
    emit({"ev": "cmp", "id": rec["id"], "state": "started", "orig": orig, "mode": mode})

    def log(msg):
        emit({"ev": "log", "msg": msg})

    def progress(frac, us, duration):
        eta_sec = None
        if frac and frac > 0.001:
            eta_sec = (1.0 / frac - 1.0) * (us / 1_000_000.0)
        # dur 显示为 总时长 mm:ss（_fmt_pos(0,dur) 提取后半段，等价 _fmt_time）
        dur_txt = ""
        try:
            p = eazyvid._fmt_pos(0, duration)
            if p and "/" in p:
                dur_txt = p.split("/")[1]
        except Exception:
            pass
        emit({
            "ev": "cmp", "id": rec["id"], "state": "compressing",
            "pct": round(frac * 100, 1),
            "pos": eazyvid._fmt_pos(us / 1_000_000.0, duration),
            "dur": dur_txt,
            "eta": eta_sec, "mode": mode,
        })

    try:
        ok, out = eazyvid.compress_video(path, mode, log, progress, out_dir=out_dir,
                                         proc_holder=rec, cover_sec=cover_sec)
    except Exception as e:
        emit({"ev": "cmp", "id": rec["id"], "state": "failed", "error": str(e), "mode": mode})
        return
    with _cmp_lock:
        _cmp_running.pop(rec["id"], None)
    if not ok:
        emit({"ev": "cmp", "id": rec["id"], "state": "failed", "error": "压缩失败，见日志", "mode": mode})
        return
    # 统计：原大小 / 输出大小 / 压缩比
    orig = os.path.getsize(path)
    out_sz = os.path.getsize(out) if out and os.path.exists(out) else 0
    ratio = round((1 - out_sz / orig) * 100, 1) if orig and out_sz else 0
    if overwrite and out and os.path.abspath(out) != os.path.abspath(path):
        try:
            os.replace(out, path)
            out = path
        except OSError:
            pass
    emit({"ev": "cmp", "id": rec["id"], "state": "done", "out": out or "",
          "orig": orig, "outSize": out_sz, "ratio": ratio, "mode": mode})


def _cmd_cmp_scan_dir(req):
    """递归扫描目录内视频文件（压缩面板"添加文件夹"）"""
    root = req.get("path", "")
    exts = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".ts", ".m4v", ".mpg", ".mpeg", ".wmv"}
    found = []
    if root and os.path.isdir(root):
        for dp, _dn, fn in os.walk(root):
            for f in fn:
                if os.path.splitext(f)[1].lower() in exts:
                    found.append(os.path.join(dp, f))
    reply(req["id"], ok=True, files=found)


def _cmd_cmp_add(req):
    with _cmp_lock:
        _cmp_seq[0] += 1
        cid = _cmp_seq[0]
        _cmp_running[cid] = {"proc": None}
    threading.Thread(target=_compress_worker, args=(req, {"id": cid}), daemon=True).start()
    reply(req["id"], ok=True, cmp_id=cid)  # cmp_id = 压缩任务 id（避免与 RPC 响应 id 键冲突）


def _cmd_cmp_stop(req):
    with _cmp_lock:
        rec = _cmp_running.get(req.get("id"))
    if rec and rec.get("proc") is not None:
        eazyvid._kill_proc_tree(rec["proc"])
        emit({"ev": "cmp", "id": req.get("id"), "state": "stopped", "mode": req.get("mode", "")})
        reply(req["id"], ok=True)
        return
    reply(req["id"], ok=False, error="压缩任务不存在或已结束")


# ---------- 主循环 ----------
def main():
    emit({"ev": "ready", "pid": os.getpid(),
          "ytdlp": os.path.join(os.path.dirname(os.path.abspath(__file__)), "yt-dlp.exe"),
          "ffmpeg": os.path.join(os.path.dirname(os.path.abspath(__file__)), "ffmpeg.exe")})
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            emit({"ev": "log", "msg": f"RPC 解析失败: {line[:200]}"})
            continue
        cmd = req.get("cmd")
        try:
            if cmd == "ping":
                reply(req.get("id"), ok=True, pid=os.getpid())
            elif cmd == "probe":
                info, err = eazyvid.probe_url(req.get("url", ""), req.get("timeout", 90),
                                              req.get("force_cookie", False))
                if err:
                    fmts, err2 = eazyvid.probe_formats_f(req.get("url", ""), req.get("timeout", 90),
                                                          req.get("force_cookie", False))
                    if err2:
                        reply(req.get("id"), ok=False, error=err2)
                    else:
                        reply(req.get("id"), ok=True, formats=fmts, title="", source="F")
                else:
                    fmts = eazyvid.extract_formats(info)
                    title = info.get("title") or ""
                    reply(req.get("id"), ok=True, formats=fmts, title=title, source="J")
            elif cmd == "dl_add":
                _cmd_dl_add(req)
            elif cmd == "dl_pause":
                _cmd_dl_pause(req)
            elif cmd == "dl_resume":
                _cmd_dl_resume(req)
            elif cmd == "dl_retry":
                _cmd_dl_retry(req)
            elif cmd == "dl_remove":
                _cmd_dl_remove(req)
            elif cmd == "cmp_add":
                _cmd_cmp_add(req)
            elif cmd == "cmp_stop":
                _cmd_cmp_stop(req)
            elif cmd == "cmp_scan_dir":
                _cmd_cmp_scan_dir(req)
            elif cmd == "quit":
                # 杀干净所有下载/压缩子进程 + 清理临时目录残留
                if _dl_pool:
                    for t in list(_dl_pool.tasks):
                        eazyvid._kill_proc_tree(t.proc)
                        if t.tmpdir and os.path.isdir(t.tmpdir):
                            import shutil as _sh
                            _sh.rmtree(t.tmpdir, ignore_errors=True)
                with _cmp_lock:
                    for rec in _cmp_running.values():
                        eazyvid._kill_proc_tree(rec.get("proc"))
                emit({"ev": "bye"})
                break
            else:
                reply(req.get("id"), ok=False, error=f"未知命令: {cmd}")
        except Exception as e:
            reply(req.get("id"), ok=False, error=f"{type(e).__name__}: {e}")
    sys.stdout.flush()


if __name__ == "__main__":
    main()

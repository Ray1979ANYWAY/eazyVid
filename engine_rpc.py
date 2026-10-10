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
import re
import shutil
import subprocess
import sys
import threading
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stdin.reconfigure(encoding="utf-8", errors="replace")

import eazyvid  # noqa: E402  （项目根模块：探测/下载/压缩引擎）

NO_WINDOW = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW：不弹控制台窗口

_lock = threading.Lock()
_EVT_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tmp", "engine_events.txt")
_REQ_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tmp", "engine_reqs.txt")


def _trace(kind, obj):
    """调试探针：引擎事件/请求落盘（tmp/，gitignored）。诊断 UI 链路时用。"""
    try:
        os.makedirs(os.path.dirname(_EVT_LOG), exist_ok=True)
        with open(_EVT_LOG if kind == "ev" else _REQ_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
    except Exception:
        pass


def emit(obj):
    """原子写一行 JSON（多线程安全）"""
    line = json.dumps(obj, ensure_ascii=False)
    _trace("ev", obj)
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

    # 记录输出路径供 cmp_stop 清理半成品（与 compress_video 命名对齐）
    rec["out_path"] = os.path.join(out_dir or os.path.dirname(path),
                                   os.path.basename(os.path.splitext(path)[0]) + "_compressed.mp4")

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
        # 主动终止（cmp_stop 已杀进程并发 stopped）时不发 failed，避免覆盖终止态
        if rec.get("stopped"):
            return
        emit({"ev": "cmp", "id": rec["id"], "state": "failed", "error": "压缩失败，见日志", "mode": mode})
        return
    if not out:
        # (True, None) = 试压判定无收益 / 输出比源更大，已放弃输出并保留原文件 → 标"收益小已终止"
        try:
            orig = os.path.getsize(path)
        except OSError:
            orig = 0
        emit({"ev": "cmp", "id": rec["id"], "state": "skipped", "orig": orig, "mode": mode})
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
        rec = {"proc": None, "id": cid}   # 同一 dict 同时注册进 _cmp_running 和传给 worker
        _cmp_running[cid] = rec
    threading.Thread(target=_compress_worker, args=(req, rec), daemon=True).start()
    reply(req["id"], ok=True, cmp_id=cid)  # cmp_id = 压缩任务 id（避免与 RPC 响应 id 键冲突）


def _cmd_cmp_stop(req):
    cid = req.get("cmp_id", req.get("id"))   # 参数键用 cmp_id，避免与 RPC 请求 id 键冲突
    with _cmp_lock:
        rec = _cmp_running.get(cid)
    if rec and rec.get("proc") is not None:
        eazyvid._kill_proc_tree(rec["proc"])
        rec["stopped"] = True   # 标记主动终止：worker 察觉进程被杀时不得再发 failed 覆盖 stopped
        # 终止即删半成品输出（用户规则：终止任务应删除压缩一半的文件）
        out = rec.get("out_path")
        if out and os.path.exists(out):
            try:
                os.remove(out)
            except OSError:
                pass
        emit({"ev": "cmp", "id": cid, "state": "stopped", "mode": req.get("mode", "")})
        reply(req["id"], ok=True)
        return
    reply(req["id"], ok=False, error="压缩任务不存在或已结束")


def _ver_key(v):
    """'7.1.1' → (7,1,1)，用于版本号比较"""
    try:
        return tuple(int(x) for x in str(v).split(".")[:3])
    except (TypeError, ValueError):
        return (0, 0, 0)


def _cmd_ffmpeg_check(req):
    """检查 ffmpeg 是否有新的稳定版：本地版本 vs ffmpeg.org 官方 release 最新稳定版。
    本地为 nightly/自编译（版本号 N-xxx）时也提示（建议换稳定版）。
    网络失败/解析失败时静默返回（不打扰用户，newer=False）。"""
    cur = ""
    cur_nightly = False
    try:
        ff = os.path.join(eazyvid.SCRIPT_DIR, "ffmpeg.exe")
        r = subprocess.run([ff, "-version"], capture_output=True, text=True, timeout=10,
                           creationflags=NO_WINDOW | 0x00004000)
        m = re.search(r"ffmpeg version (\d+\.\d+(?:\.\d+)?)", r.stdout or "")
        if m:
            cur = m.group(1)
        else:
            m = re.search(r"ffmpeg version (N-\d+[^\s]*)", r.stdout or "")
            if m:
                cur = m.group(1)
                cur_nightly = True
    except Exception:
        pass
    latest = ""
    try:
        import urllib.request
        hreq = urllib.request.Request("https://ffmpeg.org/releases/", headers={"User-Agent": "Mozilla/5.0"})
        html = urllib.request.urlopen(hreq, timeout=10).read().decode("utf-8", "replace")
        vers = re.findall(r"ffmpeg-(\d+\.\d+(?:\.\d+)?)\.tar\.", html)
        if vers:
            latest = max(vers, key=_ver_key)
    except Exception:
        pass
    # 本地是 nightly → 只要存在稳定版就提示；本地是稳定版 → 版本号严格更大才提示
    newer = bool(latest and ((cur_nightly and cur) or (cur and _ver_key(latest) > _ver_key(cur))))
    reply(req.get("id"), ok=True, current=cur, latest=latest, newer=newer, nightly=cur_nightly)


def _cmd_ffmpeg_update(req):
    """一键更新 ffmpeg 到最新稳定版（gyan.dev release-full.7z，Windows 官方推荐构建）：
    下载（带进度事件）→ Windows 自带 bsdtar 解 7z → 备份旧版 → 替换 → 验证版本 → 清理临时文件。
    任一步失败：恢复旧版备份并清理临时目录，返回错误。"""
    script = eazyvid.SCRIPT_DIR
    tmp = os.path.join(script, "ffmpeg_update_tmp")
    FF_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z"
    try:
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp, exist_ok=True)

        # 1. 下载（带进度事件）
        emit({"ev": "ffmpeg_progress", "stage": "download", "percent": 0})
        import urllib.request
        hreq = urllib.request.Request(FF_URL, headers={"User-Agent": "Mozilla/5.0"})
        resp = urllib.request.urlopen(hreq, timeout=30)
        total = int(resp.headers.get("Content-Length") or 0)
        got = 0
        dst = os.path.join(tmp, "ffmpeg.7z")
        with open(dst, "wb") as f:
            while True:
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                if total:
                    emit({"ev": "ffmpeg_progress", "stage": "download",
                          "percent": min(99, int(got * 100 / total))})

        # 2. 解压（Windows 10+ 自带 bsdtar 支持 7z）
        emit({"ev": "ffmpeg_progress", "stage": "extract", "percent": 100})
        ex = os.path.join(tmp, "x")
        os.makedirs(ex, exist_ok=True)
        subprocess.run(["tar", "-xf", dst, "-C", ex], timeout=600,
                       creationflags=NO_WINDOW | 0x00004000, check=True)

        # 3. 定位新构建的 bin 目录
        new_bin = None
        for root, dirs, files in os.walk(ex):
            if "ffmpeg.exe" in files and os.path.basename(root) == "bin":
                new_bin = root
                break
        if not new_bin:
            raise RuntimeError("解压内容中未找到 bin/ffmpeg.exe")

        # 4. 备份旧版 → 替换 → 失败则回滚备份
        for name in ("ffmpeg.exe", "ffprobe.exe", "ffplay.exe"):
            src = os.path.join(new_bin, name)
            if not os.path.exists(src):
                continue
            dst2 = os.path.join(script, name)
            bak = dst2 + ".old"
            if os.path.exists(dst2):
                os.replace(dst2, bak)
            try:
                shutil.copy2(src, dst2)
            except Exception:
                if os.path.exists(bak):
                    os.replace(bak, dst2)
                raise
            if os.path.exists(bak):
                os.remove(bak)

        # 5. 验证新版本号
        ver = ""
        try:
            r = subprocess.run([os.path.join(script, "ffmpeg.exe"), "-version"],
                               capture_output=True, text=True, timeout=10,
                               creationflags=NO_WINDOW | 0x00004000)
            m = re.search(r"ffmpeg version (\d+\.\d+(?:\.\d+)?)", r.stdout or "")
            ver = m.group(1) if m else ""
        except Exception:
            pass
        shutil.rmtree(tmp, ignore_errors=True)
        emit({"ev": "ffmpeg_progress", "stage": "done", "percent": 100})
        reply(req.get("id"), ok=True, version=ver)
    except Exception as e:
        shutil.rmtree(tmp, ignore_errors=True)
        reply(req.get("id"), ok=False, error=f"更新失败: {e}")


# ---------- 主循环 ----------
def _cmd_quit(req=None):
    """退出清理：杀干净所有下载/压缩子进程 + 清理临时文件（.part 缓存、压缩半成品）"""
    if _dl_pool:
        for t in list(_dl_pool.tasks):
            eazyvid._kill_proc_tree(t.proc)
            if t.tmpdir and os.path.isdir(t.tmpdir):
                import shutil as _sh
                _sh.rmtree(t.tmpdir, ignore_errors=True)
    with _cmp_lock:
        for rec in _cmp_running.values():
            eazyvid._kill_proc_tree(rec.get("proc"))
            # 删除压缩到一半的不完整输出（同"终止"语义，重试抗文件锁定）
            op = rec.get("out_path")
            if op:
                for _ in range(3):
                    try:
                        if os.path.exists(op):
                            os.remove(op)
                        break
                    except OSError:
                        time.sleep(0.2)
    emit({"ev": "bye"})


def _cleanup_stale_tmpdirs():
    """启动时清理意外中断（断电/强杀）残留的下载临时目录：>10 分钟、非当前进程的 .eazyvid_ 目录"""
    try:
        cur = os.getpid()
        cutoff = time.time() - 600
        bases = {os.path.dirname(os.path.abspath(__file__)),
                 os.path.join(os.path.expanduser("~"), "Downloads")}
        for base in bases:
            if not os.path.isdir(base):
                continue
            for d in os.listdir(base):
                if not d.startswith(".eazyvid_"):
                    continue
                if f"_{cur}" in d:
                    continue
                p = os.path.join(base, d)
                try:
                    if os.path.isdir(p) and os.path.getmtime(p) < cutoff:
                        import shutil as _sh
                        _sh.rmtree(p, ignore_errors=True)
                        _trace("ev", {"ev": "cleanup", "removed": p})
                except Exception:
                    pass
    except Exception:
        pass


def main():
    # 启动清理：意外中断（断电/强杀）残留的下载 .eazyvid_ 临时目录
    _cleanup_stale_tmpdirs()
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
        _trace("req", {"id": req.get("id"), "cmd": cmd, "args": {k: v for k, v in req.items() if k not in ("id", "cmd")}})
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
            elif cmd == "ffmpeg_check":
                _cmd_ffmpeg_check(req)
            elif cmd == "ffmpeg_update":
                _cmd_ffmpeg_update(req)
            elif cmd == "quit":
                _cmd_quit()
                break
            else:
                reply(req.get("id"), ok=False, error=f"未知命令: {cmd}")
        except Exception as e:
            reply(req.get("id"), ok=False, error=f"{type(e).__name__}: {e}")
    sys.stdout.flush()


if __name__ == "__main__":
    main()

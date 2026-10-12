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
    """调试探针：引擎事件/请求落盘（tmp/，gitignored）。诊断 UI 链路时用。
    每行前缀时间戳（yyyy-mm-dd HH:MM:SS.mmm），用于区分新旧进程记录。"""
    try:
        os.makedirs(os.path.dirname(_EVT_LOG), exist_ok=True)
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()) + f".{int(time.time() % 1 * 1000):03d}"
        with open(_EVT_LOG if kind == "ev" else _REQ_LOG, "a", encoding="utf-8") as f:
            f.write(ts + " " + json.dumps(obj, ensure_ascii=False) + "\n")
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


def _safe_int(val, default=-1):
    try:
        if val is None:
            return default
        return int(val)
    except (TypeError, ValueError):
        return default


_dl_pool_workers = [3]


def _get_dl_pool(workers):
    global _dl_pool
    target = max(1, _safe_int(workers, 3))
    with _dl_pool_lock:
        if _dl_pool is None:
            def on_update(evt):
                kind, task = evt
                _dl_event(kind, task)
            _dl_pool = eazyvid.DownloadPool(on_update, lambda msg: emit({"ev": "log", "msg": msg}),
                                            max_concurrent=target)
            _dl_pool_workers[0] = target
        else:
            old_target = _dl_pool_workers[0]
            if target != old_target:
                _dl_pool_workers[0] = target
                diff = target - old_target
                if diff > 0:
                    for _ in range(diff):
                        _dl_pool.sem.release()
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
    tid = _safe_int(req.get("task_id"), -1)
    for t in list((_dl_pool or []).tasks if _dl_pool else []):
        if t.task_id == tid:
            t.pause()
            reply(req["id"], ok=True)
            return
    reply(req["id"], ok=False, error="任务不存在")


def _cmd_dl_resume(req):
    tid = _safe_int(req.get("task_id"), -1)
    for t in list((_dl_pool or []).tasks if _dl_pool else []):
        if t.task_id == tid:
            t.resume()
            reply(req["id"], ok=True)
            return
    reply(req["id"], ok=False, error="任务不存在")


def _cmd_dl_retry(req):
    """失败任务重新下载：重置进度、清临时缓存、排入等待队列尾"""
    tid = _safe_int(req.get("task_id"), -1)
    for t in list((_dl_pool or []).tasks if _dl_pool else []):
        if t.task_id == tid:
            t.retry()
            reply(req["id"], ok=True)
            return
    reply(req["id"], ok=False, error="任务不存在")


def _cmd_dl_remove(req):
    delete_file = bool(req.get("delete_file", False))
    tid = _safe_int(req.get("task_id"), -1)
    for t in list((_dl_pool or []).tasks if _dl_pool else []):
        if t.task_id == tid:
            out_path = t.out_path
            # _dl_pool.remove 已封装：杀进程、释放信号量、删 tmpdir
            if _dl_pool:
                _dl_pool.remove(t)
            else:
                eazyvid._kill_proc_tree(t.proc)
                if t.tmpdir and os.path.isdir(t.tmpdir):
                    import shutil as _sh
                    _sh.rmtree(t.tmpdir, ignore_errors=True)
            if delete_file and out_path and os.path.exists(out_path):
                for _ in range(3):
                    try:
                        os.remove(out_path)
                        break
                    except OSError:
                        time.sleep(0.2)
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

    t_start = time.monotonic()
    last_emit_t = [0.0]
    cached_eta = [None]
    eta_ema = [None]

    def progress(frac, us, duration):
        now = time.monotonic()
        elapsed_clock = now - t_start
        video_pos = (us / 1_000_000.0) if us else 0.0

        # 每 1.0 秒重新评估并平滑更新一次 ETA（低于 2.5 秒初始缓冲或进度极小时不估）
        if now - last_emit_t[0] >= 1.0 or frac >= 0.999:
            last_emit_t[0] = now
            if elapsed_clock >= 2.5 and video_pos > 0.5 and duration and duration > video_pos:
                remaining_video = max(0.0, duration - video_pos)
                # 耗时系数 = 实际走过的现实秒数 / 视频走过的流秒数
                # 即：每压缩 1 秒视频内容，现实中需要花费多少秒
                cost_ratio = elapsed_clock / video_pos
                instant_eta = remaining_video * cost_ratio

                # 指数平滑（alpha=0.35），抑制复杂场景带来的瞬时帧率抖动，让倒计时平稳单调递减
                if eta_ema[0] is None:
                    eta_ema[0] = instant_eta
                else:
                    eta_ema[0] = 0.35 * instant_eta + 0.65 * eta_ema[0]
                cached_eta[0] = max(0.0, eta_ema[0])
            elif frac >= 0.999:
                cached_eta[0] = 0.0

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
            "pos": eazyvid._fmt_pos(video_pos, duration),
            "dur": dur_txt,
            "eta": cached_eta[0], "mode": mode,
        })

    try:
        ok, out = eazyvid.compress_video(path, mode, log, progress, out_dir=out_dir,
                                         proc_holder=rec, cover_sec=cover_sec)
    except Exception as e:
        emit({"ev": "cmp", "id": rec["id"], "state": "failed", "error": str(e), "mode": mode})
        return
    finally:
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
    try:
        orig = os.path.getsize(path)
    except OSError:
        orig = 0
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
                # 压缩输出（xxx_compressed.mp4）与源文件同目录，不重新入队
                if f.lower().endswith("_compressed.mp4"):
                    continue
                if os.path.splitext(f)[1].lower() in exts:
                    found.append(os.path.join(dp, f))
    reply(req["id"], ok=True, files=found)


def _cmd_cmp_add(req):
    path = req.get("path", "")
    limit = req.get("limit", 0)   # UI 传入并发上限；0 = 不限（脚本/直调）
    with _cmp_lock:
        # 同路径去重：同一源文件已在压缩（未结束）时拒绝重复启动——
        # 兜底 UI 补位竞态/拖入重复（曾致两个 ffmpeg 同时压同一个输出文件）
        for _rid, _rec in _cmp_running.items():
            if _rec.get("path") == path:
                reply(req["id"], ok=True, cmp_id=_rec["id"], dup=True)
                return
        # 并发硬闸门：正在压缩（未 stopped）的任务数已达上限 → 拒绝启动（UI 保持 queued 等补位）
        if limit > 0:
            running = sum(1 for _r in _cmp_running.values() if not _r.get("stopped"))
            if running >= limit:
                reply(req["id"], ok=True, limit=True)
                return
        _cmp_seq[0] += 1
        cid = _cmp_seq[0]
        rec = {"proc": None, "id": cid, "path": path}   # 同一 dict 同时注册进 _cmp_running 和传给 worker
        _cmp_running[cid] = rec
    threading.Thread(target=_compress_worker, args=(req, rec), daemon=True).start()
    reply(req["id"], ok=True, cmp_id=cid)  # cmp_id = 压缩任务 id（避免与 RPC 响应 id 键冲突）


def _cmd_cmp_stop(req):
    cid = req.get("cmp_id")
    if cid is None:
        cid = req.get("task_id")
    cid = _safe_int(cid, None)
    if cid is None:
        cid = _safe_int(req.get("id"), None)
    with _cmp_lock:
        rec = _cmp_running.get(cid)
    if rec is None:
        reply(req["id"], ok=False, error="压缩任务不存在或已结束")
        return
    if rec.get("proc") is not None:
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
    # 竞态窗口：cmp_add 刚回，worker 尚未 Popen（proc 仍为 None）。
    # 先打 stopped 标记——compress_video 的 Popen 补杀保险看到该标记会立即杀进程，不放过。
    rec["stopped"] = True
    emit({"ev": "cmp", "id": cid, "state": "stopped", "mode": req.get("mode", "")})
    reply(req["id"], ok=True)


def _ver_key(v):
    """'7.1.1' → (7,1,1)，用于版本号比较"""
    try:
        return tuple(int(x) for x in str(v).split(".")[:3])
    except (TypeError, ValueError):
        return (0, 0, 0)


def _cmd_check_updates(req):
    """检查全部组件与主程序的最新稳定版本：
    1. eazyVid 主程序 (默认 0.1.0 vs GitHub latest release)
    2. yt-dlp 视频下载核心 (本地版本 vs GitHub yt-dlp/yt-dlp latest release)
    3. ffmpeg & ffprobe 音视频转码核心 (本地版本 vs gyan.dev/ffmpeg.org latest release)
    返回结构清晰区分每个组件的名称、作用说明、当前版本与最新版本。"""
    def _worker():
        script = eazyvid.SCRIPT_DIR
        app_cur = req.get("app_version", "0.1.0")
        app_latest = app_cur
        app_newer = False
        app_url = "https://github.com/Ray1979ANYWAY/eazyVid/releases"

        # 1. eazyVid 主程序检查
        try:
            import urllib.request
            hreq = urllib.request.Request("https://api.github.com/repos/Ray1979ANYWAY/eazyVid/releases/latest",
                                          headers={"User-Agent": "eazyVid"})
            with urllib.request.urlopen(hreq, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                tag = (data.get("tag_name") or "").lstrip("v").strip()
                if tag:
                    app_latest = tag
                    app_newer = _ver_key(app_latest) > _ver_key(app_cur)
                    app_url = data.get("html_url") or app_url
        except Exception:
            pass

        # 2. yt-dlp 版本检查
        ytdlp_cur = ""
        ytdlp_latest = ""
        ytdlp_newer = False
        try:
            yt_bin = os.path.join(script, "yt-dlp.exe")
            r = subprocess.run([yt_bin, "--version"], capture_output=True, text=True, timeout=5,
                               creationflags=NO_WINDOW | 0x00004000)
            ytdlp_cur = (r.stdout or "").strip()
        except Exception:
            pass
        try:
            import urllib.request
            hreq = urllib.request.Request("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest",
                                          headers={"User-Agent": "eazyVid"})
            with urllib.request.urlopen(hreq, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                ytdlp_latest = (data.get("tag_name") or "").strip()
                if ytdlp_cur and ytdlp_latest:
                    ytdlp_newer = ytdlp_latest > ytdlp_cur
        except Exception:
            if not ytdlp_latest and ytdlp_cur:
                ytdlp_latest = ytdlp_cur

        # 3. ffmpeg & ffprobe 版本检查
        ff_cur = ""
        ff_cur_nightly = False
        try:
            ff = os.path.join(script, "ffmpeg.exe")
            r = subprocess.run([ff, "-version"], capture_output=True, text=True, timeout=10,
                               creationflags=NO_WINDOW | 0x00004000)
            m = re.search(r"ffmpeg version (\d+\.\d+(?:\.\d+)?)", r.stdout or "")
            if m:
                ff_cur = m.group(1)
            else:
                m = re.search(r"ffmpeg version (N-\d+[^\s]*)", r.stdout or "")
                if m:
                    ff_cur = m.group(1)
                    ff_cur_nightly = True
        except Exception:
            pass
        ff_latest = ""
        # 优先读取 gyan.dev release-version（Windows 官方构建源，仅数字节，响应极快）
        try:
            import urllib.request
            hreq = urllib.request.Request("https://www.gyan.dev/ffmpeg/builds/release-version",
                                          headers={"User-Agent": "eazyVid/0.1.0"})
            with urllib.request.urlopen(hreq, timeout=6) as resp:
                txt = resp.read().decode("utf-8", "replace").strip()
                m = re.search(r"(\d+\.\d+(?:\.\d+)?)", txt)
                if m:
                    ff_latest = m.group(1)
        except Exception:
            pass
        # 备选读取 ffmpeg.org/releases/
        if not ff_latest:
            try:
                import urllib.request
                hreq = urllib.request.Request("https://ffmpeg.org/releases/", headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(hreq, timeout=8) as resp:
                    html = resp.read(65536).decode("utf-8", "replace")
                    vers = re.findall(r"ffmpeg-(\d+\.\d+(?:\.\d+)?)\.tar\.", html)
                    if vers:
                        ff_latest = max(vers, key=_ver_key)
            except Exception:
                pass
        if not ff_latest and ff_cur:
            ff_latest = ff_cur
        ff_newer = bool(ff_latest and ((ff_cur_nightly and ff_cur) or (ff_cur and _ver_key(ff_latest) > _ver_key(ff_cur))))

        has_any_update = app_newer or ytdlp_newer or ff_newer

        items = [
            {
                "id": "app",
                "name": "eazyVid 主程序",
                "role": "桌面界面与核心调度管理",
                "current": app_cur,
                "latest": app_latest,
                "newer": app_newer,
                "url": app_url,
                "is_app": True,
            },
            {
                "id": "ytdlp",
                "name": "yt-dlp",
                "role": "流媒体嗅探与多平台下载内核",
                "current": ytdlp_cur,
                "latest": ytdlp_latest,
                "newer": ytdlp_newer,
                "is_app": False,
            },
            {
                "id": "ffmpeg",
                "name": "ffmpeg / ffprobe",
                "role": "音视频封装、硬件加速压制与解码内核",
                "current": ff_cur,
                "latest": ff_latest,
                "newer": ff_newer,
                "nightly": ff_cur_nightly,
                "is_app": False,
            },
        ]
        reply(req.get("id"), ok=True, has_update=has_any_update, items=items)

    threading.Thread(target=_worker, daemon=True).start()


def _cmd_update_component(req):
    """更新单个组件：
    - ytdlp: 调用 yt-dlp.exe -U 自动升级至最新稳定版
    - ffmpeg: 执行完整稳定版下载替换流程"""
    comp = req.get("component")
    if comp == "ytdlp":
        def _yt_worker():
            try:
                emit({"ev": "component_progress", "component": "ytdlp", "percent": 50})
                yt_bin = os.path.join(eazyvid.SCRIPT_DIR, "yt-dlp.exe")
                r = subprocess.run([yt_bin, "-U"], capture_output=True, text=True, timeout=120,
                                   creationflags=NO_WINDOW | 0x00004000)
                # 获取新版本号
                r2 = subprocess.run([yt_bin, "--version"], capture_output=True, text=True, timeout=5,
                                    creationflags=NO_WINDOW | 0x00004000)
                new_ver = (r2.stdout or "").strip()
                emit({"ev": "component_progress", "component": "ytdlp", "percent": 100})
                reply(req.get("id"), ok=True, component="ytdlp", version=new_ver)
            except Exception as e:
                reply(req.get("id"), ok=False, component="ytdlp", error=str(e))
        threading.Thread(target=_yt_worker, daemon=True).start()
    elif comp == "ffmpeg":
        threading.Thread(target=_cmd_ffmpeg_update, args=(req,), daemon=True).start()
    else:
        reply(req.get("id"), ok=False, error=f"未知组件: {comp}")


def _cmd_ffmpeg_check(req):
    """旧接口兼容：检查 ffmpeg 是否有新的稳定版"""
    def _worker():
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
        newer = bool(latest and ((cur_nightly and cur) or (cur and _ver_key(latest) > _ver_key(cur))))
        reply(req.get("id"), ok=True, current=cur, latest=latest, newer=newer, nightly=cur_nightly)

    threading.Thread(target=_worker, daemon=True).start()


def _cmd_ffmpeg_update(req):
    """一键更新 ffmpeg 到最新稳定版（gyan.dev release-full.7z，Windows 官方推荐构建）：
    下载（带进度事件，已下载的 7z 保留供重试复用）→ 解压（优先 7-Zip，其次 bsdtar）→
    备份旧版 → 替换 → 验证版本 → 清理临时文件。任一步失败：恢复旧版备份并报错。"""
    script = eazyvid.SCRIPT_DIR
    tmp = os.path.join(script, "ffmpeg_update_tmp")
    dst = os.path.join(tmp, "ffmpeg.7z")
    SZ = r"C:\Program Files\7-Zip\7z.exe"
    use_sz = os.path.exists(SZ)
    FF_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z"
    try:
        os.makedirs(tmp, exist_ok=True)

        # 1. 已有 7z → 先校验完整性；无效或缺失 → 重新下载（失败不清 tmp，重试复用）
        need_dl = True
        if os.path.exists(dst) and os.path.getsize(dst) > 1_000_000:
            try:
                if use_sz:
                    r = subprocess.run([SZ, "t", dst], capture_output=True, timeout=120,
                                       creationflags=NO_WINDOW | 0x00004000)
                    need_dl = r.returncode != 0
                else:
                    need_dl = False  # 无 7-Zip 无法校验，直接用；解压失败再删重下
            except Exception:
                need_dl = True
        if need_dl:
            emit({"ev": "ffmpeg_progress", "stage": "download", "percent": 0})
            import urllib.request
            hreq = urllib.request.Request(FF_URL, headers={"User-Agent": "Mozilla/5.0"})
            resp = urllib.request.urlopen(hreq, timeout=30)
            total = int(resp.headers.get("Content-Length") or 0)
            got = 0
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

        # 2. 解压（7-Zip 优先；无 7-Zip 时 bsdtar 兜底——部分 7z 特性 libarchive 不支持会失败）
        emit({"ev": "ffmpeg_progress", "stage": "extract", "percent": 100})
        ex = os.path.join(tmp, "x")
        shutil.rmtree(ex, ignore_errors=True)
        os.makedirs(ex, exist_ok=True)
        ok = False
        err = ""
        if use_sz:
            r = subprocess.run([SZ, "x", dst, f"-o{ex}", "-y"], capture_output=True, text=True,
                               timeout=600, creationflags=NO_WINDOW | 0x00004000)
            if r.returncode == 0:
                ok = True
            else:
                err = (r.stdout or "")[-400:] + (r.stderr or "")[-400:]
        if not ok:
            r = subprocess.run(["tar", "-xf", dst, "-C", ex], capture_output=True, text=True,
                               timeout=600, creationflags=NO_WINDOW | 0x00004000)
            if r.returncode == 0:
                ok = True
            else:
                err = (r.stdout or "")[-400:] + (r.stderr or "")[-400:]
        if not ok:
            # 解压失败：7z 可能损坏 → 删除重下；保留 tmp 其他内容
            if os.path.exists(dst):
                try:
                    os.remove(dst)
                except OSError:
                    pass
            raise RuntimeError(f"解压失败: {err[:200]}")

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
        # 保留 tmp（已下载的 7z 供重试复用），只清理解压目录
        shutil.rmtree(os.path.join(tmp, "x"), ignore_errors=True)
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


def _kill_stale_ffmpeg():
    """启动时清理上一次会话残留的压缩 ffmpeg（强杀/断电留下的孤儿进程，UI 无法再 stop）：
    特征 = 命令行含 _compressed 输出且带 -progress（本项目压缩进程）。
    正常退出（托盘退出）时 Engine::shutdown 已杀树，此处扫描不到任何进程，无副作用。"""
    try:
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | "
             "ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            creationflags=NO_WINDOW, timeout=20)
        for line in (ps.stdout or "").splitlines():
            line = line.strip()
            if "|" not in line:
                continue
            pid_s, cmdline = line.split("|", 1)
            if not cmdline or "_compressed" not in cmdline.lower() or "-progress" not in cmdline.lower():
                continue
            try:
                pid = int(pid_s)
            except ValueError:
                continue
            if pid == os.getpid():
                continue
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           capture_output=True, creationflags=NO_WINDOW, timeout=10)
            _trace("ev", {"ev": "cleanup", "killed_stale_ffmpeg": pid})
    except Exception:
        pass


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


def _cmd_system_shutdown(req):
    delay = _safe_int(req.get("delay"), 60)
    try:
        subprocess.Popen(["shutdown", "/s", "/t", str(delay)], creationflags=NO_WINDOW)
        reply(req["id"], ok=True)
    except Exception as e:
        reply(req["id"], ok=False, error=str(e))


def _cmd_cancel_shutdown(req):
    try:
        subprocess.Popen(["shutdown", "/a"], creationflags=NO_WINDOW)
        reply(req["id"], ok=True)
    except Exception as e:
        reply(req["id"], ok=False, error=str(e))


def main():
    # 启动清理：① 上次会话残留的压缩 ffmpeg 孤儿（强杀/断电留下，UI 无法再 stop）
    #            ② 意外中断残留的下载 .eazyvid_ 临时目录
    _kill_stale_ffmpeg()
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
            elif cmd == "check_updates":
                _cmd_check_updates(req)
            elif cmd == "update_component":
                _cmd_update_component(req)
            elif cmd == "ffmpeg_check":
                _cmd_ffmpeg_check(req)
            elif cmd == "ffmpeg_update":
                threading.Thread(target=_cmd_ffmpeg_update, args=(req,), daemon=True).start()
            elif cmd == "system_shutdown":
                _cmd_system_shutdown(req)
            elif cmd == "cancel_shutdown":
                _cmd_cancel_shutdown(req)
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

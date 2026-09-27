# -*- coding: utf-8 -*-
"""
eazyVid v2 —— 视频下载压缩工具（图形界面版）

定稿交互：
  1. 粘贴 URL → 探测格式；成功列出格式（悬停出下载按钮）
  2. 探测失败 → 提示窗 → 确认后自动开播放窗口（CDP 嗅探）→ 播放捕获 → tooltip 回主窗
  3. 下载池：并行下载、暂停/恢复、每行压缩下拉；完成变灰
  4. 压缩队列：下载完自动衔接（空闲即压/忙则排队）
"""
import subprocess
import sys
import os
import json
import re
import queue
import threading
import time
import shutil
import tempfile
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
YTDLP = os.path.join(SCRIPT_DIR, "yt-dlp.exe")
FFMPEG = os.path.join(SCRIPT_DIR, "ffmpeg.exe")
FFPROBE = os.path.join(SCRIPT_DIR, "ffprobe.exe")
# GUI 用 pythonw 运行（无控制台），子进程若不指定此标志会在桌面弹黑色命令窗口
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
CHROME_PORT = 9222
CAPTURE_PORT = 8899  # 书签通道备用端口
CHROME_PROFILE = os.path.join(SCRIPT_DIR, ".eazyvid_profile")
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "eazyvid_settings.json")  # 记忆配置（下载目录等，不入库）
MAX_CONCURRENT = 3          # 并行下载数（吃满带宽）
SNIFF_TIMEOUT = 60          # 嗅探无动作超时（秒）

# ---------- 压缩模式（与 compress.py 保持一致） ----------
COMPRESS_MODES = {
    "x265 默认(推荐)": {"codec": "libx265", "params": ["-crf", "24", "-preset", "medium"], "desc": "画质基本不变，体积约减半"},
    "x265 高画质":     {"codec": "libx265", "params": ["-crf", "20", "-preset", "medium"], "desc": "最接近原片，体积减小较少"},
    "x265 小体积":     {"codec": "libx265", "params": ["-crf", "27", "-preset", "medium"], "desc": "体积最小，画质略有损失"},
    "NVENC 硬件加速":   {"codec": "hevc_nvenc", "params": [], "desc": "用显卡编码，速度快10倍，体积减小较少"},
}

def fmt_size(n):
    if not n:
        return "未知"
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "未知"
    for unit in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"

def fmt_time(sec):
    if not sec:
        return "?"
    try:
        sec = int(float(sec))
    except (TypeError, ValueError):
        return "?"
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"

# YouTube DASH 流 itag → (分辨率/类型标签, 编码标签)
ITAG_LABELS = {
    137: ("1080p H.264", "H.264"), 136: ("720p H.264", "H.264"), 135: ("480p H.264", "H.264"),
    134: ("360p H.264", "H.264"), 133: ("240p H.264", "H.264"), 160: ("144p H.264", "H.264"),
    248: ("1080p VP9", "VP9"), 247: ("720p VP9", "VP9"), 244: ("480p VP9", "VP9"),
    243: ("360p VP9", "VP9"), 242: ("240p VP9", "VP9"), 278: ("144p VP9", "VP9"),
    299: ("1080p60 VP9", "VP9"), 298: ("720p60 VP9", "VP9"),
    399: ("1080p AV1", "AV1"), 398: ("1080p AV1", "AV1"), 397: ("480p AV1", "AV1"),
    396: ("360p AV1", "AV1"), 395: ("240p AV1", "AV1"), 394: ("144p AV1", "AV1"),
    140: ("音频 m4a 128k", "m4a"), 251: ("音频 opus 160k", "opus"),
    139: ("音频 m4a 48k", "m4a"), 258: ("音频 m4a", "m4a"), 599: ("音频", "?"),
    18: ("360p 合并", "H.264"), 22: ("720p 合并", "H.264"), 37: ("1080p 合并", "H.264"),
}

_SNIFFER = None
_cookie_lock = threading.Lock()

_COOKIE_CACHE = {"path": None, "ts": 0.0}

def cookie_args(force=False):
    """优先 CDP 取 cookie（嗅探 Chrome 运行时，Network.getAllCookies 无文件锁问题，
    且拿到的是嗅探窗口的登录态）；兜底复制 .eazyvid_profile 副本。
    CDP 调用同步且可达 1~2 秒，缓存 120 秒：探测/嗅探的后台线程已取过，
    下载启动（主线程）直接命中缓存，避免界面卡顿。
    force=True：跳过缓存强制重取（探测报 Fresh cookies 时的重试）。"""
    now = time.time()
    if not force and _COOKIE_CACHE["path"] and now - _COOKIE_CACHE["ts"] < 120:
        return ["--cookies", _COOKIE_CACHE["path"]]
    if _SNIFFER is not None:
            try:
                cf = _SNIFFER.cookie_file()
                if cf:
                    _COOKIE_CACHE["path"] = cf
                    _COOKIE_CACHE["ts"] = now
                    return ["--cookies", cf]
            except Exception:
                pass
    src_cookies = os.path.join(CHROME_PROFILE, "Default", "Network", "Cookies")
    if not os.path.exists(src_cookies):
        return []
    tmp = os.path.join(tempfile.gettempdir(), "eazyvid_ck_" + str(os.getpid()))
    for _ in range(4):
        try:
            os.makedirs(os.path.join(tmp, "Default", "Network"), exist_ok=True)
            ls = os.path.join(CHROME_PROFILE, "Local State")
            if os.path.exists(ls):
                shutil.copy2(ls, os.path.join(tmp, "Local State"))
            shutil.copy2(src_cookies, os.path.join(tmp, "Default", "Network", "Cookies"))
            j = src_cookies + "-journal"
            if os.path.exists(j):
                shutil.copy2(j, os.path.join(tmp, "Default", "Network", "Cookies-journal"))
            return ["--cookies-from-browser", f"chrome:{tmp}"]
        except Exception:
            time.sleep(0.5)
    return []

# ---------- 探测模块：yt-dlp -J ----------
def probe_url(url, timeout=90, force_cookie=False):
    """返回 (info_dict, error)"""
    try:
        r = subprocess.run(
            [YTDLP, "--ffmpeg-location", FFMPEG, "--no-playlist"] + cookie_args(force=force_cookie) + ["-J", url],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
            creationflags=NO_WINDOW | 0x00004000)
    except subprocess.TimeoutExpired:
        return None, "探测超时（90秒），可能是网络慢或需要代理"
    if r.returncode != 0:
        return None, (r.stderr or r.stdout or "").strip()[-800:]
    try:
        return json.loads(r.stdout), None
    except Exception as e:
        return None, f"解析失败: {e}"

def probe_formats_f(url, timeout=90, force_cookie=False):
    """-J 探测失败的 -F 兜底：解析 yt-dlp 格式表（与命令行脚本一致）。
    返回 (formats, error)；formats 结构与 extract_formats 兼容。"""
    try:
        r = subprocess.run(
            [YTDLP, "--ffmpeg-location", FFMPEG, "--no-playlist"] + cookie_args(force=force_cookie) + ["-F", url],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
            creationflags=NO_WINDOW | 0x00004000)
    except subprocess.TimeoutExpired:
        return None, "探测超时（90秒），可能是网络慢或需要代理"
    if r.returncode != 0:
        return None, (r.stderr or r.stdout or "").strip()[-800:]
    fmts = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("-") or line.startswith("ID"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        fid = parts[0]
        if fid in ("ID", "---") or not re.match(r'^[a-zA-Z0-9+_.-]+$', fid):
            continue
        ext = parts[1]
        res = ""
        for pp in parts:
            if re.match(r'^\d+x\d+$', pp) or re.match(r'^\d+(p|k)$', pp):
                res = pp
                break
        lower = line.lower()
        if "av1" in lower or "vp9" in lower or "vp08" in lower or "vp09" in lower:
            vcodec = "vp9"
        elif "avc1" in lower or "h264" in lower:
            vcodec = "avc1"
        else:
            vcodec = "unknown"
        acodec = "none" if ("video only" in lower or "videoonly" in lower) else ("mp4a" if ("audio only" in lower or "m4a" in lower) else "")
        size = None
        msz = re.search(r'([\d.]+)\s*(MiB|GiB|KiB|MB|GB|KB)', line)
        if msz:
            v = float(msz.group(1))
            unit = msz.group(2)
            size = int(v * 1024**2) if unit in ("MiB", "MB") else int(v * 1024**3) if unit in ("GiB", "GB") else int(v * 1024)
        fmts.append({"id": fid, "ext": ext, "res": str(res), "vcodec": vcodec,
                     "acodec": acodec, "size": size, "note": ""})
    if not fmts:
        return None, "未解析到格式（-F 输出为空）"
    fmts.sort(key=lambda x: x["vcodec"] == "none")
    return fmts, None

def extract_formats(info):
    out = []
    for f in info.get("formats", []):
        vid = f.get("vcodec") or "none"
        aud = f.get("acodec") or "none"
        if vid == "none" and aud == "none":
            continue
        height = f.get("height") or 0
        if height:
            res = f"{f.get('width') or 0}x{height}"
        else:
            res = f.get("format_note") or f.get("resolution") or ""
        size = f.get("filesize") or f.get("filesize_approx")
        out.append({
            "id": f.get("format_id", ""),
            "ext": f.get("ext", ""),
            "res": str(res),
            "vcodec": vid,
            "acodec": aud,
            "size": size,
            "note": f.get("format_note", ""),
        })
    out.sort(key=lambda x: x["vcodec"] == "none")
    return out

def format_size(b):
    if not b:
        return "未知大小"
    b = float(b)
    u = "B"
    for u in ("B", "KB", "MB", "GB", "TB"):
        if b < 1024 or u == "TB":
            break
        b /= 1024
    return f"{b:.1f}{u}" if u != "B" else f"{int(b)}B"

def fmt_arg_for(fmt):
    vid = fmt.get("vcodec") or "none"
    aud = fmt.get("acodec") or "none"
    if vid != "none" and aud != "none":
        return fmt["id"]
    if vid != "none":
        return f"{fmt['id']}+bestaudio/best"
    return fmt["id"]

# ---------- 嗅探（CDP） ----------
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

def find_browser():
    for c in CHROME_CANDIDATES:
        if os.path.isfile(c):
            return c
    try:
        import winreg
        for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            for sub in (r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"):
                try:
                    k = winreg.OpenKey(root, sub)
                    v, _ = winreg.QueryValueEx(k, None)
                    if v and os.path.isfile(v):
                        return v
                except OSError:
                    continue
    except Exception:
        pass
    return None

def is_video_request(url, headers):
    if not url or url.startswith("data:"):
        return False
    # YouTube 无扩展名流（googlevideo/videoplayback）特征兜底
    if "googlevideo.com" in url or "/videoplayback" in url:
        return True
    ct = (headers.get("content-type") or headers.get("Content-Type") or "").lower()
    if ct.startswith("video/") or ct in ("application/vnd.apple.mpegurl", "application/x-mpegurl",
                                         "application/dash+xml", "application/vnd.ms-sstr+xml"):
        return True
    if "octet-stream" in ct and re.search(r"\.(mp4|webm|flv)(\?|$)", url):
        return True
    if re.search(r"\.(m3u8|mp4|webm|flv|mov|m4s|mpd|f4m)(\?|$)", url.lower()):
        return True
    # 媒体 CDN 域名兜底：无扩展名视频流（如 vd755.okcdn.ru/?expires=... 这类裸签名 URL）
    # 覆盖 video/media/stream/player 域名与 vd* 编号域名；排除明显静态资源路径
    try:
        from urllib.parse import urlparse
        netloc = (urlparse(url).netloc or "").lower()
    except Exception:
        netloc = ""
    if netloc and re.search(r"(^vd\d*\.|(^|\.)video\.|(^|\.)media\.|(^|\.)stream\.|(^|\.)player\.)", netloc):
        base = url.lower().split("?", 1)[0]
        if not re.search(r"\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ico|json|html)(\?|$)", base):
            return True
    return False

class Sniffer:
    """CDP 嗅探：启动调试浏览器 → 监听 Network → 识别视频流。
    event_cb(kind, payload): kind in ("captured", url) / ("timeout", None)"""
    def __init__(self, log_cb, event_cb=None, root=None):
        self.root = root
        self.log_cb = log_cb
        self.event_cb = event_cb
        self.proc = None
        self.ws = None
        self.thread = None
        self.running = False
        self.seen = set()
        self.start_url = "about:blank"
        self._captured = False
        self._timeout_fired = False
        self._auto_clicked = False
        self._base_path = None
        self._cookie_wait = None

    def start(self, url=""):
        browser = find_browser()
        if not browser:
            return "找不到 Chrome/Edge，请手动安装浏览器"
        os.makedirs(CHROME_PROFILE, exist_ok=True)
        cmd = [browser,
               f"--remote-debugging-port={CHROME_PORT}",
               f"--user-data-dir={CHROME_PROFILE}",
               "--no-first-run", "--no-default-browser-check",
               "--remote-allow-origins=*",
               "--disable-extensions",
               "--disable-sync",
               "--disable-features=ExtensionsToolbarMenu,Translate,ReadingList,BookmarkBar",
               "--app=about:blank"]
        if self.root is not None:
            try:
                rx = self.root.winfo_rootx(); ry = self.root.winfo_rooty()
                rw = self.root.winfo_width(); rh = self.root.winfo_height()
                wx = rx + (rw - 960) // 2
                wy = ry + (rh - 720) // 2
                cmd.append(f"--window-position={wx},{wy}")
            except Exception:
                pass
        try:
            self.proc = subprocess.Popen(cmd, creationflags=0x00004000)  # BELOW_NORMAL：嗅探 Chrome 不抢界面
        except OSError as e:
            return f"启动浏览器失败: {e}"
        self.start_url = url or "about:blank"
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        # 超时计时：60 秒无捕获 → 提示用户再点一次探测
        threading.Thread(target=self._timeout_watch, daemon=True).start()
        return None

    def _timeout_watch(self):
        time.sleep(SNIFF_TIMEOUT)
        if self.running and not self._captured and not self._timeout_fired:
            self._timeout_fired = True
            if self.event_cb:
                self.event_cb("timeout", None)
            self.stop()

    def _vid_path(self, url):
        """视频流的'主路径'：去掉文件名后的目录路径，用于区分同一视频的不同清晰度 vs 页面跳转/推荐流"""
        try:
            path = urllib.parse.urlparse(url).path
            parts = [p for p in path.split("/") if p]
            if parts:
                parts = parts[:-1]
            return "/".join(parts)
        except Exception:
            return None

    def _run(self):
        import websocket
        tabs = []
        for _ in range(40):
            if not self.running:
                return
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{CHROME_PORT}/json")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    tabs = json.loads(resp.read().decode("utf-8", "replace"))
                if any(t.get("type") in ("page", "iframe") for t in tabs):
                    break
            except Exception:
                pass
            time.sleep(0.5)
        pages = [t for t in tabs if t.get("type") in ("page", "iframe")]
        if not pages:
            self.log_cb("嗅探：未能连接浏览器调试端口")
            return
        main = None
        for t in pages:
            if t.get("type") != "page":
                continue
            u = t.get("url", "")
            if self.start_url and self.start_url != "about:blank" and u.startswith(self.start_url):
                main = t
                break
        if main is None:
            for t in pages:
                if t.get("type") == "page":
                    main = t
                    break
        if main is None and pages:
            main = pages[0]
        self.log_cb(f"嗅探：发现 {len(pages)} 个页面/浮层（主：{main.get('url','')[:70]}）")
        self.wss = []
        self._conn_urls = set()
        try:
            for t in pages:
                wu = t.get("webSocketDebuggerUrl")
                if not wu:
                    continue
                try:
                    ws = websocket.create_connection(wu, timeout=15)
                    ws.settimeout(0.3)
                    ws.send(json.dumps({"id": 1, "method": "Network.enable"}))
                    ws.send(json.dumps({"id": 2, "method": "Runtime.enable"}))
                    self.wss.append(ws)
                    self._conn_urls.add(wu)
                except Exception:
                    pass
            if not self.wss:
                self.log_cb("嗅探：所有页面连接失败")
                return
            self.ws = self.wss[0]
            self.log_cb("嗅探：已连接，正在加载播放页…")
            # 嗅探就绪后再导航：确保页面加载时的所有媒体请求（含自动播放）都在监听内
            if self.start_url and self.start_url != "about:blank":
                try:
                    self.wss[0].send(json.dumps({"id": 3, "method": "Page.navigate",
                                                 "params": {"url": self.start_url}}))
                    self.log_cb(f"嗅探：已加载播放页 {self.start_url[:80]}，请播放（需要登录的网站请先登录）")
                except Exception:
                    self.log_cb("嗅探：导航失败，请手动打开视频页并点击播放")
            self._last_tab_refresh = 0
            while self.running:
                # 播放状态轮询（诊断）：每 3 秒检查 video 是否在播
                if time.time() - getattr(self, "_vts", 0) > 3:
                    self._vts = time.time()
                    for _ws in self.wss:
                        try:
                            _ws.send(json.dumps({"id": 901, "method": "Runtime.evaluate",
                                                 "params": {"expression": "var v=document.querySelector('video'); v?JSON.stringify({t:Math.round(v.currentTime),r:v.readyState}):'nov'", "returnByValue": True}}))
                        except Exception:
                            pass
                # 每 5 秒刷新 target 列表，自动补连新开的页面（登录弹窗/新窗口）
                if time.time() - self._last_tab_refresh > 5:
                    self._last_tab_refresh = time.time()
                    self._refresh_targets()
                for ws in self.wss:
                    try:
                        msg = json.loads(ws.recv())
                    except Exception:
                        continue
                    if msg.get("id") == 901:
                        try:
                            val = (msg.get("result") or {}).get("result") or {}
                            val = val.get("value")
                            if val and val != "nov" and str(val).startswith("{"):
                                d = json.loads(val)
                                t = d.get("t") or 0
                                if t > 0:
                                    self.log_cb(f"嗅探VIDEO: 播放中 t={t}s")
                        except Exception:
                            pass
                        continue
                    if msg.get("id") == 900:
                        if self._cookie_wait:
                            ev, _ = self._cookie_wait
                            self._cookie_wait = (ev, msg.get("result", {}))
                            ev.set()
                        continue
                    method = msg.get("method", "")
                    params = msg.get("params", {})
                    if method.startswith("Network.webSocket"):
                        try:
                            u = params.get("url", "") or params.get("request", {}).get("url", "") or ""
                            self.log_cb("嗅探WS: " + method.split(".")[1] + " " + str(u)[:80])
                        except Exception:
                            pass
                        continue
                    if method == "Runtime.consoleAPICalled":
                        try:
                            args_ = params.get("args", [])
                            text = " ".join((a.get("value") if isinstance(a.get("value"), str) else str(a.get("value", ""))) for a in args_)
                            if text:
                                self.log_cb("嗅探JS: " + text)
                        except Exception:
                            pass
                        continue
                    url = None
                    headers = {}
                    if method == "Network.requestWillBeSent":
                        req_ = params.get("request", {})
                        url = req_.get("url")
                        headers = req_.get("headers", {})
                    elif method == "Network.responseReceived":
                        resp = params.get("response", {})
                        url = resp.get("url")
                        headers = resp.get("headers", {})
                    # 调试日志（临时）：打印所有请求，定位 OK.ru 视频流真实路径
                    if url:
                        try:
                            ct_s = headers.get("content-type") or "?"
                            self.log_cb("嗅探DBG: " + method.split(".")[1] + " video=" + str(is_video_request(url, headers))
                                        + " ct=" + str(ct_s)[:25] + " " + url[:120])
                        except Exception:
                            pass
                    if url and is_video_request(url, headers):
                        if url in self.seen:
                            continue
                        vp = self._vid_path(url)
                        if self._base_path is None:
                            self._base_path = vp
                        elif vp and vp != self._base_path:
                            # m3u8/mpd 清单豁免：主视频 HLS/DASH 常与广告/预览流不同路径，不忽略
                            if not re.search(r'\.(m3u8|mpd)(\?|$)', url):
                                self.log_cb(f"嗅探：检测到页面跳转/推荐视频流（与当前视频不同），已忽略：{url}")
                                continue
                        self.seen.add(url)
                        self._captured = True
                        self.log_cb("嗅探：捕获 " + url)
                        if self.event_cb:
                            self.event_cb("captured", url)
                        if not self._auto_clicked:
                            self._auto_clicked = True
                            threading.Thread(target=self._auto_quality, daemon=True).start()
        except Exception as e:
            self.log_cb(f"嗅探：连接中断 {e}")
        finally:
            for ws in getattr(self, "wss", []):
                try:
                    ws.close()
                except Exception:
                    pass

    def _refresh_targets(self):
        """每 5 秒刷新 page target 列表，自动补连新开的页面（登录弹窗/新窗口/OOPIF）。"""
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{CHROME_PORT}/json")
            with urllib.request.urlopen(req, timeout=2) as resp:
                tabs = json.loads(resp.read().decode("utf-8", "replace"))
            import websocket
            for t in tabs:
                if t.get("type") not in ("page", "iframe"):
                    continue
                wu = t.get("webSocketDebuggerUrl")
                if not wu or wu in getattr(self, "_conn_urls", set()):
                    continue
                try:
                    ws = websocket.create_connection(wu, timeout=10)
                    ws.settimeout(0.3)
                    ws.send(json.dumps({"id": 1, "method": "Network.enable"}))
                    ws.send(json.dumps({"id": 2, "method": "Runtime.enable"}))
                    self.wss.append(ws)
                    self._conn_urls.add(wu)
                    self.log_cb(f"嗅探：已补连新页面 {t.get('url','')[:70]}")
                except Exception:
                    pass
        except Exception:
            pass
    def _auto_quality(self):
        """通用清晰度遍历（不依赖站点结构）：
        状态机 —— 0 找档位直显 / 找设置·清晰度按钮打开菜单 → 1 菜单开（找 Quality 子菜单或档位）→ 2 逐个点档位。
        每轮固定等待 3 秒（点档位/API 切换时新流 1~3 秒出现，捕获是事件驱动不丢流），最多 8 轮（约 25 秒封顶）。"""
        time.sleep(1.5)
        if not self.running or not self.ws:
            return
        self.log_cb("嗅探：自动遍历清晰度档位（通用播放器识别，最多约 40 秒）")
        for _ in range(8):
            if not self.running or not self.ws:
                return
            before = len(self.seen)
            js = r"""(() => {
  const isQ = /^(自动|流畅|标清|高清|超清|蓝光|\d{2,4}\s?p?|2k|4k)$/i;
  const v = document.querySelector('video');
  if (v) {
    for (const ev of ['mousemove','pointermove','mouseover','mousedown']) {
      try { v.dispatchEvent(new MouseEvent(ev, {bubbles: true, clientX: 200, clientY: 150, view: window})); } catch(e) {}
    }
  }
  let root = v ? (v.closest('.jwplayer') || v.closest('.jw-media') || v.parentElement.parentElement || v.parentElement || document) : document;
  if (window.__eq_api !== 'jw') {
    try {
      if (typeof window.jwplayer === 'function') {
        const inst = jwplayer();
        if (inst && inst.getQualityLevels) {
          const lv = inst.getQualityLevels();
          if (lv && lv.length) {
            window.__eq_api = 'jw';
            window.__eq_api_levels = lv.map(l => (l && (l.label || l.name)) || '');
            console.log('EQ api: jw ' + JSON.stringify(window.__eq_api_levels));
          }
        }
      }
    } catch(e) {}
  }
  if (window.__eq_api === 'jw') {
    const levels = window.__eq_api_levels || [];
    const total = levels.length;
    const step = window.__eq_api_idx || 0;
    if (step < total) {
      const target = total - 1 - step;
      const retry = window.__eq_api_retry || 0;
      try {
        jwplayer().setCurrentQuality(target);
        console.log('EQ api click: ' + levels[target]);
        window.__eq_api_idx = step + 1;
        window.__eq_api_retry = 0;
      } catch(e) {
        if (retry < 2) { window.__eq_api_retry = retry + 1; console.log('EQ api retry: ' + levels[target]); }
        else { window.__eq_api_idx = step + 1; window.__eq_api_retry = 0; console.log('EQ api skip: ' + levels[target]); }
      }
      return 'ok';
    }
    window.__eq_state = 9;
    console.log('EQ api done');
    return 'ok';
  }
  const st = window.__eq_state || 0;
  if (window.__eq_dump === undefined) {
    window.__eq_dump = 1;
    try {
      const gears = [...root.querySelectorAll('[class*=settings], [aria-label*="settings" i]')];
      console.log('EQ gears: ' + JSON.stringify(gears.slice(0, 10).map(e => ({
        tag: e.tagName, aria: e.getAttribute('aria-label')||'', cls: (e.className||'').toString().slice(0, 60),
        kids: e.children.length, vis: e.offsetParent!==null
      }))));
    } catch(e) { console.log('EQ gears err'); }
  }
  const qOpts = () => [...root.querySelectorAll('li,div,span,button,a')].filter(e => {
    const t = (e.textContent || '').trim();
    return isQ.test(t) && e.children.length <= 1 && e.offsetParent !== null;
  });
  const settingsBtn = [...root.querySelectorAll('button,div,span,a')].find(e => {
    const t = (e.textContent || '').trim();
    const cls = (e.className || '').toString();
    const ariaTitle = ((e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).trim();
    if (/menu|topbar|submenu|close/i.test(ariaTitle + ' ' + cls)) return false;
    const okCls = /jw-icon-settings/.test(cls);
    const okAttr = /(^|\s)(settings|设置|齿轮)(\s|$)/i.test(ariaTitle);
    const okText = /^(settings|设置|齿轮)$/i.test(t);
    return (okCls || okAttr || okText) && e.children.length <= 6;
  });
  const findSub = (scope) => {
    const topBar = [...scope.querySelectorAll('.jw-settings-topbar [class*=jw-icon], .jw-settings-topbar-buttons [class*=jw-icon], .jw-settings-topbar [class*=settings]')].find(e => {
      const t = (e.textContent || '').trim();
      const aria = (e.getAttribute('aria-label') || '').trim();
      return ((/(quality|画质|清晰度|解析度)/i.test(t) && t.length <= 12) || /^(quality|画质|清晰度|解析度)$/i.test(aria)) && e.offsetParent !== null;
    });
    if (topBar) return topBar;
    return [...scope.querySelectorAll('.jw-menu-item, .jw-settings-content-item, li, div, span, button, a')].find(e => {
      const t = (e.textContent || '').trim();
      const a = (e.getAttribute('aria-label') || '') + ' ' + (e.className || '');
      return (/(quality|画质|清晰度|质量|解析度)/i.test(t) && t.length <= 10 && e.offsetParent !== null) ||
             (/jw-menu-item|jw-settings-content-item/.test(a) && /(quality|画质|清晰)/i.test(a)) ||
             (/^(quality|画质|清晰度)$/i.test((e.getAttribute('aria-label')||'').trim()) && e.offsetParent !== null);
    });
  };
  if (st === 2) {
    const opts = qOpts();
    if (opts.length) {
      const idx = window.__eq_opt_idx || 0;
      const chosen = opts[Math.min(idx, opts.length - 1)];
      window.__eq_opt_idx = idx + 1;
      if (chosen) { chosen.click(); console.log('EQ: click opt ' + (chosen.textContent || '').trim()); }
      return 'ok';
    }
    const sub = findSub(root);
    if (sub) { sub.click(); console.log('EQ: sub again'); return 'ok'; }
    console.log('EQ: done no opts'); window.__eq_state = 9; return 'done';
  }
  if (st === 1) {
    const menuEl = root.querySelector('.jw-settings-menu, [class*=settings-menu]');
    const open = menuEl && menuEl.offsetParent !== null;
    if (!open) {
      if (settingsBtn) { settingsBtn.click(); console.log('EQ: reopen settings'); return 'ok'; }
      console.log('EQ: done no settings'); window.__eq_state = 9; return 'done';
    }
    const sub = findSub(root);
    if (sub) { sub.click(); window.__eq_state = 2; console.log('EQ: sub ' + (sub.textContent || '').trim()); return 'ok'; }
    const opts = qOpts();
    if (opts.length) { window.__eq_state = 2; console.log('EQ: opts visible'); return 'ok'; }
    console.log('EQ: menu open no opts yet'); return 'ok';
  }
  const sub = findSub(root);
  if (sub) { sub.click(); window.__eq_state = 2; console.log('EQ: sub ' + (sub.textContent || '').trim()); return 'ok'; }
  const opts = qOpts();
  if (opts.length) { window.__eq_state = 2; console.log('EQ: opts visible'); return 'ok'; }
  if (settingsBtn) { settingsBtn.click(); window.__eq_state = 1; console.log('EQ: settings btn ' + (settingsBtn.getAttribute('aria-label') || (settingsBtn.textContent||'').trim() || 'gear')); return 'ok'; }
  console.log('EQ: done no settings'); window.__eq_state = 9; return 'done';
})()"""
            try:
                self.ws.send(json.dumps({"id": 70 + _, "method": "Runtime.evaluate",
                                         "params": {"expression": js, "returnByValue": True}}))
            except Exception:
                return
            time.sleep(3)
            if not self.running or not self.ws:
                return
            if len(self.seen) > before:
                self.log_cb(f"嗅探：第 {_+1} 轮有新流，已捕获 {len(self.seen)} 个流")
        self.log_cb("嗅探：清晰度遍历结束（可手动切换清晰度继续捕获）")

    def cookie_file(self):
        """CDP Network.getAllCookies → 写 NetScape 格式 cookie 文件（无文件锁问题）。
        返回文件路径；失败返回 None。"""
        if not self.ws or not self.running:
            return None
        try:
            ev = threading.Event()
            self._cookie_wait = (ev, None)
            self.ws.send(json.dumps({"id": 900, "method": "Network.getAllCookies"}))
            ev.wait(4)
            res = self._cookie_wait[1]
            if not res:
                return None
            cookies = res.get("cookies", [])
            if not cookies:
                return None
            path = os.path.join(tempfile.gettempdir(), f"eazyvid_cookies_{os.getpid()}.txt")
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write("# Netscape HTTP Cookie File\n")
                f.write("# This file was generated by eazyVid. Do not edit.\n\n")
                for c in cookies:
                    domain = c.get("domain", "")
                    inc = "TRUE" if domain.startswith(".") else "FALSE"
                    try:
                        expiry = int(c.get("expires", 0))
                    except Exception:
                        expiry = 0
                    sec = "TRUE" if c.get("secure") else "FALSE"
                    name = c.get("name", "")
                    value = c.get("value", "")
                    pp = c.get("path", "/") or "/"
                    f.write(f"{domain}\t{inc}\t{pp}\t{sec}\t{expiry}\t{name}\t{value}\n")
            return path
        except Exception:
            return None

    def page_tip(self, msg):
        """在播放页注入浮动提示条（CDP Runtime.evaluate），6 秒后自动消失。"""
        if not self.ws or not self.running:
            return False
        try:
            js = ("(function(){"
                  "var t=document.createElement('div');"
                  "t.style.cssText='position:fixed;top:18px;right:18px;z-index:2147483647;"
                  "background:rgba(0,0,0,0.85);color:#4cff88;padding:12px 18px;border-radius:10px;"
                  "font:bold 14px/1.4 sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.5);"
                  "pointer-events:none;';"
                  "t.textContent=" + json.dumps(msg, ensure_ascii=False) + ";"
                  "document.documentElement.appendChild(t);"
                  "setTimeout(function(){t.remove();},6000);})()")
            self.ws.send(json.dumps({"id": 601, "method": "Runtime.evaluate",
                                     "params": {"expression": js}}))
            return True
        except Exception:
            return False

    def stop(self):
        self.running = False
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass

# ---------- 本地接收（书签通道，保留备用） ----------
class CaptureHandler(BaseHTTPRequestHandler):
    APP = None
    def do_POST(self):
        try:
            if self.path == "/capture":
                ln = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(ln).decode("utf-8", "replace")
                data = json.loads(body)
                url = data.get("url")
                if url and self.APP:
                    self.APP.on_capture_url(url)
        except Exception:
            pass
        try:
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b"ok")
        except Exception:
            pass
    def log_message(self, *a):
        pass

# ---------- 下载池 ----------
def build_dl_cmd(url, fmt_arg, out_dir, task_id, use_cookie=False, referer=None):
    tmpdir = os.path.join(out_dir, f".eazyvid_{task_id}_{os.getpid()}")
    os.makedirs(tmpdir, exist_ok=True)
    cmd = [YTDLP, "--ffmpeg-location", FFMPEG, "--no-playlist", "--newline",
           "--progress-delta", "0.5"]
    if fmt_arg:
        cmd += ["-f", fmt_arg]
    if "googlevideo.com" in url or "/videoplayback" in url:
        cmd += ["--referer", "https://www.youtube.com/"]
    elif referer:
        cmd += ["--referer", referer]
    cmd += ["--merge-output-format", "mp4",
            "-o", os.path.join(tmpdir, "%(title)s.%(ext)s"),
            "-c"]
    if use_cookie:
        cmd += cookie_args()
    cmd.append(url)
    return cmd, tmpdir

def _fmt_sz(n):
    """字节 → 紧凑单位：81M / 1.2G / 803K"""
    try:
        n = max(0, int(n))
    except Exception:
        return "?"
    if n >= 1073741824:
        return f"{n / 1073741824:.1f}G"
    if n >= 1048576:
        return f"{int(round(n / 1048576))}M"
    if n >= 1024:
        return f"{int(round(n / 1024))}K"
    return f"{n}B"

def _fmt_speed(s):
    """yt-dlp 速度串（如 3.21MiB/s）→ 紧凑格式（如 803K/S、1.9M/S）"""
    if not s:
        return ""
    m = re.match(r"([\d.]+)(MiB|GiB|KiB|B)/s", s.strip())
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

def _kill_proc_tree(proc):
    """Windows 杀整个进程树：yt-dlp.exe 是 pyinstaller onefile 双进程架构
    （bootloader 父进程 + 实际下载子进程），terminate 只杀父进程会让子进程
    变孤儿继续下载。taskkill /T /F 才能连子进程一起杀掉。"""
    if proc is None:
        return
    try:
        if proc.poll() is None:
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                           capture_output=True, timeout=5, creationflags=NO_WINDOW | 0x00004000)
    except Exception:
        pass
    try:
        proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=3)
    except Exception:
        pass

class DownloadTask:
    """单个下载任务；state: waiting/downloading/paused/done/failed"""
    def __init__(self, url, fmt_arg, out_dir, mode, title, pool, task_id, use_cookie=False, referer=None, size=None):
        self.url = url
        self.fmt_arg = fmt_arg
        self.out_dir = out_dir
        self.mode = mode
        self.title = title
        self.pool = pool
        self.task_id = task_id
        self.use_cookie = use_cookie
        self.referer = referer
        self.state = "waiting"
        self.progress = 0.0
        self.size_str = ""
        self.speed = ""   # 下载速度（yt-dlp at X/s）
        self.total_known = bool(size)
        self.dl_bytes = 0
        self._total_bytes = int(size) if size else 0
        self.proc = None
        self.out_path = None
        self.tmpdir = None
        self._merge_tip_shown = False   # 合并音轨气泡防重复
        self.ui = None   # 任务行组件

    def start(self):
        if self.proc is not None and self.proc.poll() is None:
            return   # 防重入：已有下载进程在跑，避免同任务双进程（进度互相覆盖、重复下载）
        cmd, self.tmpdir = build_dl_cmd(self.url, self.fmt_arg, self.out_dir, self.task_id,
                                         self.use_cookie, self.referer)
        self.state = "downloading"
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, encoding="utf-8", errors="replace",
                                     creationflags=NO_WINDOW | 0x00004000)  # BELOW_NORMAL：下载不抢界面
        if not self.fmt_arg:
            threading.Thread(target=self._preprobe, daemon=True).start()
        threading.Thread(target=self._run, daemon=True).start()
        if self.ui:
            self.ui.refresh()

    def _preprobe(self):
        """嗅探流直链：下载前用 yt-dlp -J 拿总大小和真实标题（解决摆锤和文件名）"""
        try:
            args = [YTDLP, "--ffmpeg-location", FFMPEG, "--no-playlist", "-J", "--no-warnings"]
            args += cookie_args()
            if self.referer and "googlevideo.com" not in self.url:
                args += ["--referer", self.referer]
            args.append(self.url)
            r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=25, creationflags=NO_WINDOW | 0x00004000)
            if r.returncode != 0:
                return
            info = json.loads(r.stdout)
            size = info.get("filesize") or info.get("filesize_approx")
            if size:
                self._total_bytes = int(size)
                self.total_known = True
                if self.ui:
                    self.pool.on_task_update(self)
            title = info.get("title")
            if title:
                ext = info.get("ext") or "mp4"
                self.title = f"{title}.{ext}"
                if self.ui:
                    self.pool.on_task_update(self)
        except Exception:
            pass

    def _run(self):
        _unit = {"KiB": 1024, "MiB": 1048576, "GiB": 1073741824}

        # 兜底：嗅探流直链 yt-dlp 可能不输出进度行，先 HEAD 拿总大小（仅流 URL，referer 用真实页面）
        if self.url and not self.url.startswith("file://") and self.referer and self.referer != self.url:
            try:
                import urllib.request
                req = urllib.request.Request(self.url, method="HEAD",
                                             headers={"User-Agent": "Mozilla/5.0",
                                                      "Referer": self.referer})
                with urllib.request.urlopen(req, timeout=10) as r:
                    cl = r.headers.get("Content-Length")
                    if cl:
                        self._total_bytes = int(cl)
                        self.total_known = True
            except Exception:
                pass

        def poll_part():
            while self.state == "downloading":
                if self.tmpdir and os.path.isdir(self.tmpdir):
                    got = 0
                    name = None
                    npart = []
                    try:
                        for f in os.listdir(self.tmpdir):
                            fp = os.path.join(self.tmpdir, f)
                            if not os.path.isfile(fp):
                                continue
                            if f.endswith(".part"):
                                got += os.path.getsize(fp)
                            elif not f.endswith((".ytdl", ".json")):
                                npart.append(os.path.getsize(fp))
                            if not name or len(f) > len(name):
                                name = f
                    except OSError:
                        pass
                    if npart:
                        got += max(npart)
                    changed = False
                    if name:
                        n = name[:-5] if name.endswith(".part") else name
                        n = re.sub(r"\.f\d+(?=\.)", "", n)
                        if n and n != self.title:
                            self.title = n
                            changed = True
                    if got != self.dl_bytes:
                        self.dl_bytes = got
                        changed = True
                    if self._total_bytes > 0:
                        self.total_known = True
                        pct = min(99.9, got / self._total_bytes * 100)
                        if pct > self.progress:
                            self.progress = pct
                            changed = True
                    if changed and self.ui:
                        self.pool.on_task_update(self)
                time.sleep(0.5)

        threading.Thread(target=poll_part, daemon=True).start()
        for line in self.proc.stdout:
            line = line.strip()
            m = re.search(r"\[download\]\s+([\d.]+)%\s+of\s+~?\s?([\d.]+(?:MiB|GiB|KiB))\s+at\s+([\d.]+(?:MiB|GiB|KiB|B)/s)", line)
            if m:
                # 多流下载（视频+音频分离）时进度行会从 10% 重新走一遍：只涨不跌，避免进度反复/误认为重复下载
                pct = float(m.group(1))
                if pct > self.progress:
                    self.progress = pct
                self.size_str = m.group(2)
                self.speed = m.group(3)
                mm = re.match(r"([\d.]+)(MiB|GiB|KiB)", m.group(2))
                if mm:
                    self._total_bytes = int(float(mm.group(1)) * _unit[mm.group(2)])
                    self.total_known = True
                if self.ui:
                    self.pool.on_task_update(self)
            elif line.startswith("ERROR"):
                self.pool.log(f"下载错误：{line}")
        self.proc.wait()
        if self.state == "paused":
            self.pool.log("已暂停，断点保留，可点「继续」续传")
            return
        ok = self.proc.returncode == 0
        out = None
        if self.tmpdir and os.path.isdir(self.tmpdir):
            for f in os.listdir(self.tmpdir):
                p = os.path.join(self.tmpdir, f)
                if os.path.isfile(p) and f.lower().endswith((".mp4", ".mkv", ".webm")):
                    out = p
                    break
        if ok and out:
            dest = os.path.join(self.out_dir, os.path.basename(out))
            base, ext = os.path.splitext(dest)
            i = 1
            while os.path.exists(dest):
                dest = f"{base}_{i}{ext}"
                i += 1
            try:
                shutil.move(out, dest)
            except OSError as e:
                dest = out
                self.pool.log(f"移动文件失败：{e}")
            try:
                shutil.rmtree(self.tmpdir, ignore_errors=True)
            except Exception:
                pass
            self.out_path = dest
            self.state = "done"
        else:
            self.state = "failed"
            if not ok:
                self.pool.log(f"下载失败（退出码 {self.proc.returncode}）：{self.url}")
            else:
                self.pool.log(f"下载进程正常退出但未找到成品文件，请查看下方日志；URL：{self.url}")
        self.progress = 100.0 if ok else self.progress
        self.pool.on_task_done(self)

    def pause(self):
        if self.state == "downloading" and self.proc:
            self.state = "paused"
            _kill_proc_tree(self.proc)
            self.pool.on_task_paused(self)

    def resume(self):
        if self.state == "paused":
            self.state = "waiting"
            threading.Thread(target=self.pool._schedule, args=(self,), daemon=True).start()

    def retry(self):
        if self.state != "failed":
            return
        if self.tmpdir and os.path.isdir(self.tmpdir):
            shutil.rmtree(self.tmpdir, ignore_errors=True)
        self.progress = 0.0
        self.size_str = ""
        self.out_path = None
        self.state = "waiting"
        if self.ui:
            self.pool.on_task_update(self)
        threading.Thread(target=self.pool._schedule, args=(self,), daemon=True).start()

class DownloadPool:
    def __init__(self, on_update, log_cb, max_concurrent=MAX_CONCURRENT):
        self.sem = threading.Semaphore(max_concurrent)
        self.out_dir = None      # 压缩输出目录（None=与源文件同目录；设置页可改）
        self.tasks = []
        self.task_seq = 0
        self.on_update = on_update
        self.log = log_cb

    def add(self, url, fmt_arg, out_dir, mode, title, use_cookie=False, referer=None, size=None):
        self.task_seq += 1
        t = DownloadTask(url, fmt_arg, out_dir, mode, title, self, self.task_seq,
                         use_cookie, referer, size=size)
        self.tasks.append(t)
        self.on_update(("added", t))
        threading.Thread(target=self._schedule, args=(t,), daemon=True).start()
        return t

    def _schedule(self, task):
        if task.state == "paused":
            return
        self.sem.acquire()
        if task.state != "waiting":
            self.sem.release()
            return
        task.start()

    def on_task_update(self, task):
        self.on_update(("progress", task))

    def remove(self, task):
        if task in self.tasks:
            self.tasks.remove(task)
        _kill_proc_tree(task.proc)
        if task.state != "done":
            if task.tmpdir and os.path.isdir(task.tmpdir):
                shutil.rmtree(task.tmpdir, ignore_errors=True)
        ui = task.ui
        task.ui = None
        if ui:
            try:
                ui.frame.destroy()
            except Exception:
                pass

    def on_task_done(self, task):
        self.sem.release()
        self.on_update(("done", task))

    def on_task_paused(self, task):
        self.sem.release()  # 让出并发名额，其他任务可继续
        self.on_update(("paused", task))

# ---------- 压缩队列 ----------
def get_duration(path):
    try:
        r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                            "-of", "json", path], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=30,
                           creationflags=NO_WINDOW | 0x00004000)
        d = json.loads(r.stdout).get("format", {}).get("duration")
        return float(d) if d else None
    except Exception:
        return None

def _probe_duration(path, log_cb=None):
    """ffmpeg -i 解析视频时长（秒）；失败返回 None"""
    try:
        ff = os.path.join(SCRIPT_DIR, "ffmpeg.exe")
        if not os.path.exists(ff):
            ff = "ffmpeg"
        r = subprocess.run([ff, "-i", path], capture_output=True, text=True,
                           timeout=10, errors="replace",
                           creationflags=NO_WINDOW | 0x00004000)
        mm = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr or "")
        if mm:
            h, mi, s = int(mm.group(1)), int(mm.group(2)), float(mm.group(3))
            return h * 3600 + mi * 60 + s
    except Exception:
        pass
    return None

def compress_video(in_path, mode_name, log_cb, progress_cb=None, out_dir=None, proc_holder=None):
    """压缩单个视频；返回 (是否成功, 输出路径)。mode_name 必须是 COMPRESS_MODES 的键。
    与 compress.py 对齐：分辨率不变、低码率音频原样复制、10bit 适配、NVENC 失败自动降级软件 x265。"""
    try:
        m = COMPRESS_MODES.get(mode_name) or next(iter(COMPRESS_MODES.values()))
        if out_dir:
            try:
                os.makedirs(out_dir, exist_ok=True)
            except OSError:
                pass
            out_path = os.path.join(out_dir, os.path.basename(os.path.splitext(in_path)[0]) + "_压缩.mp4")
        else:
            out_path = os.path.splitext(in_path)[0] + "_压缩.mp4"
        ff = os.path.join(SCRIPT_DIR, "ffmpeg.exe")
        if not os.path.exists(ff):
            ff = "ffmpeg"
        fp = os.path.join(SCRIPT_DIR, "ffprobe.exe")
        if not os.path.exists(fp):
            fp = "ffprobe"

        # 一次 ffprobe：时长 / 视频 pix_fmt / 音频编码与码率
        duration = None
        pix_fmt = ""
        v_br = 0          # 源视频码率（bps），用于压缩前预检
        a_codec, a_br = "", 0
        try:
            r = subprocess.run([fp, "-hide_banner", "-v", "error",
                                "-show_entries", "stream=codec_type,codec_name,pix_fmt,bit_rate",
                                "-show_entries", "format=duration",
                                "-of", "json", in_path],
                               capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=15, creationflags=NO_WINDOW | 0x00004000)
            if r.returncode == 0:
                info = json.loads(r.stdout)
                try:
                    duration = float(info["format"].get("duration") or 0) or None
                except (TypeError, ValueError):
                    duration = None
                try:
                    v_br = int(info["format"].get("bit_rate") or 0)
                except (TypeError, ValueError):
                    v_br = 0
                for s in info.get("streams", []):
                    if s.get("codec_type") == "video":
                        if not pix_fmt:
                            pix_fmt = s.get("pix_fmt", "") or ""
                        try:
                            sv = int(s.get("bit_rate") or 0)
                        except (TypeError, ValueError):
                            sv = 0
                        v_br = max(v_br, sv)
                    elif s.get("codec_type") == "audio":
                        a_codec = s.get("codec_name", "") or ""
                        try:
                            a_br = int(s.get("bit_rate") or 0)
                        except (TypeError, ValueError):
                            a_br = 0
        except Exception:
            pass
        if duration is None:
            duration = _probe_duration(in_path, log_cb)

        def _run(vargs):
            cmd = [ff, "-hide_banner", "-y", "-i", in_path,
                   "-map", "0:v:0", "-map", "0:a?"] + list(vargs)
            if a_codec in ("aac", "mp3", "ac3", "eac3") and 0 < a_br <= 192000:
                cmd += ["-c:a", "copy"]            # 低码率音频原样复制，零损失
            else:
                cmd += ["-c:a", "aac", "-b:a", "192k"]
            cmd += ["-progress", "pipe:1", "-movflags", "+faststart", out_path]
            # 必须用二进制 + bufsize=0 + readline：text 模式会缓冲整段进度输出，
            # 导致进度回调全部积压到进程结束才触发（表现为"1% 卡很久，突然完成"）
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    bufsize=0,
                                    creationflags=NO_WINDOW | 0x00004000)
            if proc_holder is not None:
                proc_holder["proc"] = proc
            for raw in iter(proc.stdout.readline, b""):
                line = raw.decode("utf-8", "replace").strip()
                if line.startswith("out_time_us="):
                    try:
                        us = float(line.split("=", 1)[1])
                        if duration and progress_cb:
                            progress_cb(min(1.0, us / (duration * 1000000.0)))
                    except (ValueError, ZeroDivisionError):
                        pass
            proc.wait()
            return proc.returncode

        # 压缩前预检：源码率已很低（≈VP9/AV1 高度压缩，CRF 重压必然更大）→ 直接跳过，不浪费编码时间
        if v_br and v_br <= 2000 * 1000:
            log_cb(f"源码率仅 {v_br // 1000}kbps（已高度压缩），压缩预计无法减小体积，跳过并保留原文件")
            return True, None
        vargs = ["-c:v", m["codec"]] + list(m.get("params", []))
        # NVENC：按源视频码率的 50% 设目标码率，保证有实际压缩效果
        if m["codec"] == "hevc_nvenc":
            src_br = 0
            try:
                r = subprocess.run([ff, "-i", in_path], capture_output=True, text=True,
                                   timeout=10, errors="replace",
                                   creationflags=NO_WINDOW | 0x00004000)
                mm = re.search(r"bitrate:\s*(\d+)\s*kb/s", r.stderr or "")
                if mm:
                    src_br = int(mm.group(1)) * 1000
            except Exception:
                pass
            target = max(int(src_br * 0.5 / 1000), 600) if src_br > 0 else 2500
            vargs = ["-c:v", "hevc_nvenc", "-preset", "p5", "-tune", "hq",
                     "-rc", "vbr", "-b:v", f"{target}k",
                     "-maxrate", f"{int(target * 1.3)}k", "-bufsize", f"{int(target * 2)}k",
                     "-cq", "27", "-spatial-aq", "1"]
        # 10bit 色深：软件 x265 按 10bit 编码；NVENC 不支持则自动改软件 x265
        if any(x in pix_fmt for x in ("10le", "12le", "p010", "p012")):
            if m["codec"] == "libx265":
                vargs += ["-pix_fmt", "yuv420p10le"]
            else:
                log_cb("检测到 10bit 源视频，NVENC 不支持，自动改用软件 x265")
                vargs = ["-c:v", "libx265", "-crf", "24", "-preset", "medium", "-pix_fmt", "yuv420p10le"]
        log_cb(f"开始压缩：{os.path.basename(in_path)} → {os.path.basename(out_path)}（{mode_name}）")
        rc = _run(vargs)
        # 硬件编码失败时自动降级为软件 x265 重试
        if rc != 0 and m["codec"] == "hevc_nvenc":
            log_cb("硬件编码失败，自动改用软件 x265 重试...")
            vargs = ["-c:v", "libx265", "-crf", "24", "-preset", "medium"]
            rc = _run(vargs)
        if rc != 0 or not os.path.exists(out_path):
            log_cb(f"压缩失败（返回码 {rc}）")
            return False, None
        in_sz = os.path.getsize(in_path)
        out_sz = os.path.getsize(out_path)
        if out_sz > in_sz:
            # 压后反而更大（如 VP9/AV1 低码率源）：放弃输出，保留原文件，标记"已跳过"
            try:
                os.remove(out_path)
            except OSError:
                pass
            log_cb(f"压缩结果比原文件更大（{_fmt_size(in_sz)}→{_fmt_size(out_sz)}），"
                   f"该视频已高度压缩，放弃输出并保留原文件")
            return True, None
        log_cb(f"压缩完成：{out_path}（{_fmt_size(in_sz)}→{_fmt_size(out_sz)}）")
        return True, out_path
    except Exception as e:
        log_cb(f"压缩异常：{e}")
        return False, None
def _safe_compress_video(path, mode, log, progress_cb=None, out_dir=None, proc_holder=None):
    """压缩包装：任何异常都不让 worker 线程崩溃，返回 (False, None)"""
    try:
        return compress_video(path, mode, log, progress_cb, out_dir, proc_holder)
    except Exception as e:
        try:
            log(f"压缩异常：{e}")
        except Exception:
            pass
        return False, None

class CompressQueue:
    def __init__(self, log_cb, on_event=None, max_workers=1):
        self.log = log_cb
        self.on_event = on_event
        self.busy = False
        self.out_dir = None      # 压缩输出目录（None=与源文件同目录；设置页可改）
        self.tasks = []          # 压缩任务记录（压缩页展示；列表顺序即压缩优先级）
        self._seq = 0
        self.paused = True       # 手动开始：add 只排队，点「开始压缩」才启动 worker
        self.max_workers = max(1, int(max_workers or 1))
        self._lock = threading.Lock()
        self._workers = []
        self._start_workers()

    def _start_workers(self):
        """确保 max_workers 个 worker 线程在跑"""
        for _ in range(self.max_workers - len(self._workers)):
            t = threading.Thread(target=self._worker, daemon=True)
            t.start()
            self._workers.append(t)

    def start(self):
        """开始压缩：已停止的任务恢复为排队（从头重压），唤醒 worker 处理排队任务"""
        revived = []
        with self._lock:
            for t in self.tasks:
                if t["state"] == "stopped":
                    t["state"] = "queued"
                    t["progress"] = 0.0
                    t["out"] = None
                    t["ok"] = False
                    revived.append(t)
        for t in revived:
            if self.on_event:
                self.on_event(("cqueued", t))
        self.paused = False
        self._start_workers()
    def restart(self, rec):
        """重新压缩单个已停止任务：只恢复该任务并立即启动（不影响其他 stopped 任务）"""
        with self._lock:
            if rec.get("state") != "stopped":
                return
            # 重新压缩的任务移到队尾（排在现有排队任务之后）
            if rec in self.tasks:
                self.tasks.remove(rec)
                self.tasks.append(rec)
            rec["state"] = "queued"
            rec["progress"] = 0.0
            rec["eta"] = None
            rec["out"] = None
            rec["ok"] = False
        if self.on_event:
            self.on_event(("cqueued", rec))
        self.paused = False
        self._start_workers()

    def add(self, path, mode, ui_ref=None, autostart=False):
        self._seq += 1
        rec = {"id": self._seq, "path": path, "mode": mode, "ui_ref": ui_ref,
               "state": "queued", "progress": 0.0, "eta": None, "_eta_ema": None, "out": None, "ok": False,
               "row": None, "skip": False, "autostart": autostart}
        with self._lock:
            self.tasks.append(rec)
        if self.on_event:
            self.on_event(("cqueued", rec))
        if autostart:
            # 下载面板来的任务：只要有空闲压缩线程（正在压的 < 并发上限）就立即开始
            with self._lock:
                running = sum(1 for t in self.tasks if t["state"] == "compressing")
            if running < self.max_workers:
                self.start()
            self.on_event(("cqueued", rec))

    def remove(self, rec):
        """删除排队/完成/失败的任务；压缩中的返回 False"""
        with self._lock:
            if rec.get("state") in ("queued", "done", "failed", "stopped", "skipped"):
                rec["skip"] = True
                try:
                    self.tasks.remove(rec)
                except ValueError:
                    pass
                return True
        return False

    def move(self, from_idx, to_idx):
        """拖动调整优先级（未压缩行）"""
        with self._lock:
            if 0 <= from_idx < len(self.tasks) and 0 <= to_idx < len(self.tasks):
                r = self.tasks.pop(from_idx)
                self.tasks.insert(to_idx, r)
                return True
        return False

    def stop(self, rec):
        """停止压缩中的任务：标记 stopped（worker 不会覆盖成 failed）、杀 ffmpeg 进程树、删除不完整输出。"""
        if rec.get("state") != "compressing":
            return False
        rec["state"] = "stopped"
        ph = rec.get("_ph") or {}
        p = ph.get("proc")
        if p is not None:
            _kill_proc_tree(p)
        # 删除可能已生成的不完整输出（taskkill 后文件可能短暂锁定，重试几次）
        cands = set()
        try:
            d = self.out_dir or os.path.dirname(rec["path"]) or "."
            stem = os.path.splitext(os.path.basename(rec["path"]))[0]
            cands.add(os.path.join(d, f"{stem}_压缩.mp4"))
        except Exception:
            pass
        out = rec.get("out")
        if out:
            cands.add(out)
        for c in cands:
            for _ in range(3):
                try:
                    if os.path.exists(c):
                        os.remove(c)
                    break
                except Exception:
                    time.sleep(0.2)
        return True

    def _worker(self):
        while True:
            if self.paused:
                time.sleep(0.3)
                continue
            with self._lock:
                active = sum(1 for t in self.tasks if t["state"] == "compressing")
                rec = None
                if active < self.max_workers:
                    rec = next((t for t in self.tasks
                                if t["state"] == "queued" and not t.get("skip")), None)
                    if rec is not None:
                        rec["state"] = "compressing"
                        rec["progress"] = 0.0
            if rec is None:
                time.sleep(0.3)
                continue
            if rec is None:
                time.sleep(0.3)
                continue
            self.busy = True
            if rec.get("ui_ref"):
                try:
                    rec["ui_ref"].show_compress(0.0)
                except Exception:
                    pass
            if self.on_event:
                self.on_event(("cstarted", rec))
            rec["_t0"] = time.monotonic()

            def prog(p):
                # compress_video 回调 0~1 → 统一存 0~100（UI 按 0~100 渲染百分比与底色宽度）
                now = time.monotonic()
                cur = min(100.0, p * 100.0)
                prog._samples.append((now, cur))
                rec["progress"] = cur
                res = _estimate_eta(prog._samples, now, cur, rec.get("_eta_ema"))
                if res is None:
                    rec["eta"] = None
                    rec["_eta_ema"] = None
                else:
                    rec["eta"], rec["_eta_ema"] = res
                if self.on_event:
                    self.on_event(("cprogress", rec))
            prog._samples = []

            rec["_ph"] = {}
            ok, out = _safe_compress_video(rec["path"], rec["mode"], self.log, prog, self.out_dir, rec["_ph"])
            if rec.get("state") != "stopped":
                if ok and out:
                    rec["state"] = "done"
                elif ok:      # (True, None) = 压缩无收益，已放弃输出
                    rec["state"] = "skipped"
                else:
                    rec["state"] = "failed"
            if ok and out:
                rec["out"] = out
            rec["ok"] = ok
            if rec.get("ui_ref"):
                try:
                    rec["ui_ref"].show_compress(None)
                except Exception:
                    pass
            rec["elapsed"] = time.monotonic() - rec.get("_t0", time.monotonic())
            if self.on_event:
                self.on_event(("cdone", rec))
# ---------- GUI ----------
import tkinter as tk
# 内置 tkinterdnd2（vendor 目录自包含，任何 Python 环境都能用文件拖放，无需 pip 安装）
try:
    _VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
    if os.path.isdir(_VENDOR):
        sys.path.insert(0, _VENDOR)
    from tkinterdnd2 import TkinterDnD, DND_FILES
    _HAVE_DND = True
except Exception:
    _HAVE_DND = False
from tkinter import ttk, messagebox, filedialog

_URL_RE = r"https?://[A-Za-z0-9\-._~:/?#@!$&'*+,;=%]+"

def _extract_url(text):
    """从混杂文本（分享文案+表情+链接）中提取 URL。
    优先处理 Markdown 链接 [标题](url) → 取 ]( 后的真实目标；否则取第一个 http(s) 链接。"""
    if not text:
        return ""
    m = re.search(r"\]\(" + _URL_RE, text)
    if m:
        return m.group(0)[2:].rstrip(")]")
    m = re.search(_URL_RE, text)
    return m.group(0).rstrip(")]") if m else ""
def _os_open(path):
    """用系统默认程序打开文件（跨平台）"""
    try:
        if os.name == "nt":
            os.startfile(path)
        else:
            subprocess.run(["open", path])
    except Exception:
        pass

def _os_reveal(path):
    """打开目标位置：目录 → 直接打开；文件 → Explorer 定位选中（失败兜底打开父目录）；
    路径不存在 → 逐级向上找最近存在的父目录打开。"""
    d = os.path.dirname(path) or "."
    try:
        if os.name == "nt":
            if os.path.isdir(path):
                os.startfile(path)                  # 目录：直接打开（最可靠）
            elif os.path.exists(path):
                try:
                    _reveal_select(path)            # 文件：原生 API 定位选中
                except Exception:
                    os.startfile(d)                 # 定位失败兜底：打开父目录
            else:
                while d and not os.path.isdir(d):
                    d2 = os.path.dirname(d)
                    if d2 == d:
                        break
                    d = d2
                if d:
                    os.startfile(d)
        else:
            if os.path.exists(path):
                subprocess.run(["open", "-R", path])
            else:
                subprocess.run(["open", d])
    except Exception:
        pass


def _reveal_select(path):
    """Explorer 原生 API：打开文件夹并选中文件（ctypes 调 shell32）"""
    import ctypes
    from ctypes import wintypes
    ole32 = ctypes.windll.ole32
    shell32 = ctypes.windll.shell32
    try:
        ole32.CoInitializeEx(None, 2)
    except Exception:
        pass
    try:
        def parse(p):
            pidl = ctypes.c_void_p()
            attrs = wintypes.DWORD(0)
            r = shell32.SHParseDisplayName(ctypes.c_wchar_p(p), None,
                                           ctypes.byref(pidl), 0, ctypes.byref(attrs))
            if r != 0:
                raise OSError("SHParseDisplayName: %#x" % r)
            return pidl
        folder_pidl = parse(os.path.dirname(path))
        item_pidl = parse(path)
        try:
            arr = (ctypes.c_void_p * 1)(item_pidl.value)
            shell32.SHOpenFolderAndSelectItems(folder_pidl, 1, arr, 0)
        finally:
            ole32.CoTaskMemFree(item_pidl)
            ole32.CoTaskMemFree(folder_pidl)
    except Exception:
        pass
    finally:
        try:
            ole32.CoUninitialize()
        except Exception:
            pass


class TaskRow:
    """下载池中的一行任务"""
    def __init__(self, parent, task, app):
        self.task = task
        self.app = app
        self.frame = ttk.Frame(parent)
        self.frame.pack(fill="x", padx=4, pady=2)
        self.name = ttk.Label(self.frame, text=task.title, width=38, anchor="w")
        self.name.pack(side="left")
        self.name.bind("<Double-1>", self._on_name_double)
        self.name.bind("<Button-3>", self._on_name_right)
        self.bar = tk.Canvas(self.frame, width=130, height=18, highlightthickness=0)
        self.bar.pack(side="left", padx=4)
        self.pct = ttk.Label(self.frame, text="0%", width=11)
        self.pct.pack(side="left")
        self.state_lbl = ttk.Label(self.frame, text="排队", width=12)
        self.speed_lbl = ttk.Label(self.frame, text="", width=9, anchor="center")
        self.pause_btn = ttk.Button(self.frame, text="暂停", width=5, command=self._on_pause)
        self.resume_btn = ttk.Button(self.frame, text="继续", width=5, command=self._on_resume)
        self.resume_btn.config(state="disabled")
        self.mode_cb = ttk.Combobox(self.frame, state="readonly", width=15,
                                    values=["不压缩"] + list(COMPRESS_MODES.keys()))
        self.mode_cb.current(0 if not task.mode else list(COMPRESS_MODES.keys()).index(task.mode) + 1)
        self.mode_cb.bind("<<ComboboxSelected>>", self._on_mode)
        self._bar_mode = "determinate"
        self.del_btn = ttk.Button(self.frame, text="删除", width=5, command=self._on_delete)
        # 右侧组从右往左 pack（先 pack 的最靠右）→ 状态+速度+按钮+模式+删除整体右对齐、随面板拉伸自适应、不叠加
        self.del_btn.pack(side="right", padx=2)
        self.mode_cb.pack(side="right", padx=2)
        self.resume_btn.pack(side="right", padx=2)
        self.pause_btn.pack(side="right", padx=2)
        self.speed_lbl.pack(side="right")
        self.state_lbl.pack(side="right")

    def _name_path(self):
        return os.path.join(self.task.out_dir, self.task.title)

    def _on_name_double(self, _e):
        """双击：已下载完成的视频直接打开；未完成无反应"""
        if self.task.state == "done":
            p = self._name_path()
            if os.path.exists(p):
                _os_open(p)
            else:
                _os_reveal(p)

    def _on_name_right(self, e):
        """右键：已完成的打开或打开所在文件夹；未完成的打开所在文件夹（定位 part 文件）"""
        m = tk.Menu(self.frame, tearoff=0)
        p = self._name_path()
        if self.task.state == "done" and os.path.exists(p):
            m.add_command(label="打开", command=lambda: _os_open(p))
            m.add_command(label="打开所在文件夹", command=lambda: _os_reveal(p))
        else:
            tp = getattr(self.task, "tmpdir", None)
            part = None
            if tp and os.path.isdir(tp):
                for f in os.listdir(tp):
                    if f.endswith(".part"):
                        part = os.path.join(tp, f)
                        break
            m.add_command(label="打开所在文件夹",
                          command=lambda: _os_reveal(part or tp or os.path.dirname(p)))
        try:
            m.tk_popup(e.x_root, e.y_root)
        finally:
            m.grab_release()


    def _on_pause(self):
        self.task.pause()
    def _on_resume(self):
        if self.task.state == "failed":
            self.task.retry()
        else:
            self.task.resume()
    def _on_delete(self):
        st = self.task.state
        if st in ("downloading", "paused"):
            if not messagebox.askyesno("删除任务",
                    "该任务仍在下载/暂停中，删除会中断并丢弃未完成的文件。确定删除？",
                    parent=self.app.root):
                return
        elif st == "done" and self.task.out_path and os.path.exists(self.task.out_path):
            if messagebox.askyesno("删除任务",
                    f"是否同时删除已下载的文件？\n\n{os.path.basename(self.task.out_path)}\n\n是 = 连文件一起删除\n否 = 仅从列表移除",
                    parent=self.app.root):
                try:
                    os.remove(self.task.out_path)
                    self.app.log(f"已删除文件：{os.path.basename(self.task.out_path)}")
                except OSError as e:
                    self.app.log(f"删除文件失败：{e}")
        self.task.pool.remove(self.task)
        self.app.log(f"已删除任务：{self.task.title}")
    def _on_mode(self, _e=None):
        v = self.mode_cb.get()
        self.task.mode = None if v == "不压缩" else v

    def _show_merge_tip(self):
        """行位置气泡：正在合并音轨，请稍后（3.5 秒自动消失）"""
        try:
            tip = tk.Toplevel(self.app.root)
            tip.overrideredirect(True)
            x = self.frame.winfo_rootx()
            y = self.frame.winfo_rooty() - 26
            tip.geometry(f"+{x}+{y}")
            tk.Label(tip, text="正在合并音轨，请稍后", bg="#fff8dc", fg="#333",
                     font=("Microsoft YaHei", 10), padx=12, pady=6).pack()
            tip.after(3500, tip.destroy)
        except Exception:
            pass

    def _draw_bar(self):
        """自绘进度条：trough + 蓝色进度 + 居中百分比（文字直接画在条上，无底色不遮挡进度）"""
        W, H = 130, 18
        if self.task.state == "downloading" and not self.task.total_known:
            p = 0.0   # 总大小未知：空条
        else:
            p = min(max(self.task.progress, 0), 100)
        c = self.bar
        c.delete("all")
        c.create_rectangle(0, 0, W, H, fill="#E8E8E8", outline="")
        if p > 0:
            fill = "#E8B800" if self.task.state == "failed" else "#4A90D9"   # 下载失败：黄色
            c.create_rectangle(0, 0, max(1, int(W * p / 100)), H, fill=fill, outline="")
        c.create_text(W / 2, H / 2, text=f"{p:.0f}%", fill="#111111", font=("Segoe UI", 8))

    def refresh(self):
        s = self.task.state
        self.name["text"] = self.task.title
        # 合并音轨提示：已下载字节数超过探测总大小（YouTube 类音视频分离，正在下音频流/合并）
        if (s == "downloading" and self.task.total_known
                and self.task.dl_bytes > self.task._total_bytes
                and not self.task._merge_tip_shown):
            self.task._merge_tip_shown = True
            self._show_merge_tip()
        self._draw_bar()
        if s == "downloading" and self.task.total_known:
            self.pct["text"] = f"{_fmt_sz(self.task.dl_bytes)}/{_fmt_sz(self.task._total_bytes)}"
        elif s == "downloading":
            mb = self.task.dl_bytes / 1048576
            self.pct["text"] = f"已下 {mb:.0f}MB" if mb >= 1 else f"已下 {int(self.task.dl_bytes)}B"
        else:
            self.pct["text"] = f"{self.task.progress:.0f}%"
        if s == "waiting":
            self.state_lbl["text"] = "排队"
            self.pause_btn.config(state="disabled")
            self.resume_btn.config(state="disabled", text="继续")
        elif s == "downloading":
            self.state_lbl["text"] = "下载中"
            self.speed_lbl["text"] = _fmt_speed(getattr(self.task, "speed", "") or "")
            self.pause_btn.config(state="normal")
            self.resume_btn.config(state="disabled", text="继续")
        elif s == "paused":
            self.state_lbl["text"] = "已暂停"
            self.speed_lbl["text"] = ""
            self.pause_btn.config(state="disabled")
            self.resume_btn.config(state="normal", text="继续")
        elif s == "done":
            self.state_lbl["text"] = "完成"
            self.speed_lbl["text"] = ""
            self.pause_btn.config(state="disabled")
            self.resume_btn.config(state="disabled", text="继续")
            self._grey(True)
        elif s == "failed":
            self.state_lbl["text"] = "失败"
            self.speed_lbl["text"] = ""
            self.pause_btn.config(state="disabled")
            self.resume_btn.config(state="normal", text="重新下载")
            self._grey(True)
            self.resume_btn.config(state="normal")

    def show_compress(self, pct):
        if pct is None:
            self.state_lbl["text"] = "完成"
            return
        self.state_lbl["text"] = f"压缩中 {pct:.0f}%"

    def _grey(self, grey):
        st = "disabled" if grey else "normal"
        for w in (self.name, self.bar, self.pct, self.state_lbl, self.pause_btn, self.resume_btn, self.mode_cb):
            try:
                w.config(state=st)
            except Exception:
                pass

def _estimate_eta(samples, now, cur_p, prev_ema=None):
    """滑动窗口估算剩余秒数：samples=[(单调时间, 0~100进度)] 按时间升序；
    窗口=最近 15 秒（时间为主）或 30 点上限；窗口内瞬时速度再叠 EMA 指数平滑
    （alpha=0.4），压平 x265 画面复杂度引起的速度剧烈波动，ETA 更稳定、单调递减；
    prev_ema 为上一次的平滑速度（0~100%/秒），None 则直接用瞬时速度"""
    while (len(samples) > 30 or now - samples[0][0] > 15.0) and len(samples) > 2:
        samples.pop(0)
    if len(samples) < 2:
        return None
    t0, p0 = samples[0]
    dt = now - t0
    dp = cur_p - p0
    if dt < 3.0 or dp < 0.2:      # 采样不足或进展太少，不估（阈值 0.2%：慢速大文件也能在几十秒内开始显示）
        return None
    inst = dp / dt                # 窗口瞬时速度 %/秒（15s 平均，本身已较稳）
    ema = inst if prev_ema is None else 0.4 * inst + 0.6 * prev_ema
    return max(0.0, (100.0 - cur_p) / ema), ema

def _fmt_eta(secs):
    """预计剩余时间显示：-- / 约N秒 / 约N分 / 约N时M分"""
    if not secs:
        return "--"
    s = int(secs)
    if s < 60:
        return f"约{s}秒"
    if s < 3600:
        return f"约{s // 60}分"
    h, m = divmod(s, 3600)
    return f"约{h}时{m // 60}分"

def _fmt_elapsed(secs):
    """压缩执行时长显示：45秒 / 5分30秒 / 1时23分"""
    if not secs:
        return ""
    s = int(secs)
    if s < 60:
        return f"{s}秒"
    if s < 3600:
        m, r = divmod(s, 60)
        return f"{m}分{r}秒"
    h, r = divmod(s, 3600)
    return f"{h}时{r // 60}分"

def _fmt_size(n):
    """字节数 → 人类可读（GB/MB/KB/B）"""
    if n is None or n <= 0:
        return ""
    if n >= 1024 ** 3:
        return f"{n / 1024 ** 3:.2f}GB"
    if n >= 1024 ** 2:
        return f"{n / 1024 ** 2:.1f}MB"
    if n >= 1024:
        return f"{n / 1024:.0f}KB"
    return f"{n}B"

ROW_BG = "#F0F0F0"          # 压缩行默认底色
ROW_BG_ACTIVE = "#D9E9F8"   # 压缩中行底色（30% 透明度淡蓝效果）

class CompressRow:
    """压缩页中的一行压缩任务（未压缩的可拖动调整优先级）"""
    def __init__(self, parent, rec, app):
        self.rec = rec
        self.app = app
        self.frame = tk.Canvas(parent, height=30, bg=ROW_BG, bd=0, highlightthickness=0)
        self.frame.pack(fill="x", padx=4, pady=2)
        self._cv = self.frame
        self._cv.bind("<Configure>", self._sync_cv)   # 行尺寸变化：布局右侧组 + 重绘
        # 文字直接画在 canvas 上（随进度底色走，不用灰底 Label 遮挡进度色）
        self._txt_name = self._cv.create_text(6, 15, anchor="w",
                                              text=os.path.basename(rec["path"]), fill="#1f1f1f")
        self._txt_size = self._cv.create_text(336, 15, anchor="w", text="", fill="#1f1f1f")
        self._txt_pct = self._cv.create_text(0, 15, anchor="e", text="", fill="#1f1f1f")
        self._txt_eta = self._cv.create_text(0, 15, anchor="e", text="", fill="#606060")
        self._txt_state = self._cv.create_text(0, 15, anchor="e", text="排队", fill="#1f1f1f")
        # 右侧控件：嵌入 canvas（按钮/下拉自带底色，位于行右侧；进度 100% 只到删除按钮右缘）
        self.stop_btn = ttk.Button(self.frame, text="终止", width=4, command=self._on_stop)
        self.restart_btn = ttk.Button(self.frame, text="重新压缩", width=7, command=self._on_restart)
        self.del_btn = ttk.Button(self.frame, text="−", width=2, command=self._on_delete)
        self.mode_cb = ttk.Combobox(self.frame, state="readonly", width=16,
                                    values=list(COMPRESS_MODES.keys()))
        try:
            self.mode_cb.current(list(COMPRESS_MODES.keys()).index(rec["mode"]))
        except ValueError:
            self.mode_cb.current(0)
        self.mode_cb.bind("<<ComboboxSelected>>", self._on_mode)
        self._win_stop = self._cv.create_window(0, 15, window=self.stop_btn, anchor="e")
        self._win_restart = self._cv.create_window(0, 15, window=self.restart_btn, anchor="e")
        self._win_del = self._cv.create_window(0, 15, window=self.del_btn, anchor="e")
        self._win_mode = self._cv.create_window(0, 15, window=self.mode_cb, anchor="e")
        self._stop_shown = False
        self._restart_shown = False
        self._cv.itemconfigure(self._win_stop, state="hidden")   # 默认隐藏；压缩中显示
        # 行本身也注册文件拖放：拖到任一行上都能把文件排入队尾（容器级注册会被行控件挡住）
        if _HAVE_DND:
            try:
                self.frame.drop_target_register(DND_FILES)
                self.frame.dnd_bind("<<Drop>>", self.app._on_drop_files)
            except Exception:
                pass
        # 拖动（命中整行）
        # 拖拽重排已移除（2026-09-28）：压缩队列不再支持手动拖拽调序
        # 文件名：双击打开视频；右键打开/打开所在文件夹（执行态仅打开文件夹）
        self._cv.bind("<Double-1>", self._on_dbl)
        self._cv.bind("<Button-3>", self._on_rclick)

    def _hit_name(self, e):
        """事件坐标是否落在文件名文字上"""
        try:
            bb = self._cv.bbox(self._txt_name)
            if not bb:
                return False
            return bb[0] <= e.x <= bb[2] and bb[1] <= e.y <= bb[3]
        except Exception:
            return False

    def _final_path(self):
        """双击/右键打开的目标：done 且输出存在 → 输出文件；否则原文件"""
        r = self.rec
        if r.get("state") == "done":
            out = r.get("out")
            if out and os.path.exists(out):
                return out
        p = r.get("path")
        return p if p and os.path.exists(p) else None

    def _on_dbl(self, e):
        """双击文件名：结束态打开视频文件；执行态无动作"""
        try:
            if not self._hit_name(e):
                return
            if self.rec.get("state") == "compressing":
                return
            t = self._final_path()
            if t:
                _os_open(t)
        except Exception:
            pass

    def _on_rclick(self, e):
        """右键文件名：结束态=打开文件(压缩输出)/打开输出目录；压缩中/排队=仅打开输出目录"""
        m = None
        try:
            if not self._hit_name(e):
                return
            r = self.rec
            st = r.get("state")
            out = r.get("out")                                   # 压缩输出文件路径
            out_dir = self.app.cqueue.out_dir or os.path.dirname(r["path"]) or "."
            m = tk.Menu(self.frame, tearoff=0)
            if st in ("done", "stopped", "failed"):
                if out and os.path.exists(out):
                    m.add_command(label="打开文件", command=lambda: _os_open(out))
                    m.add_command(label="打开输出目录", command=lambda: _os_reveal(out))
                else:
                    # 输出不存在（终止/失败无产物）：仅打开输出目录本身
                    m.add_command(label="打开输出目录", command=lambda: _os_reveal(out_dir))
            else:
                # 压缩中 / 排队：仅打开输出目录
                m.add_command(label="打开输出目录", command=lambda: _os_reveal(out_dir))
            if m.index("end") is not None:
                m.tk_popup(e.x_root, e.y_root)
        except Exception:
            pass
        finally:
            if m is not None:
                try:
                    m.grab_release()
                except Exception:
                    pass
    def _sync_cv(self, _e=None):
        """行尺寸变化：同步 canvas 高度 → 重新布局右侧组 → 重绘进度"""
        try:
            h = self.frame.winfo_height()
            if h > 4 and abs(h - int(self._cv.cget("height"))) > 2:
                self._cv.config(height=h)
        except Exception:
            pass
        self._layout()
        try:
            self._cv.update_idletasks()
        except Exception:
            pass
        self._paint_cv()

    def _layout(self):
        """右侧组从右往左：模式下拉、删除、终止(显示时)、状态文字、百分比文字"""
        try:
            W = self._cv.winfo_width()
            if W <= 20:
                return
            y = 15
            x = W - 6
            # 用请求宽度而非实际宽度：新行首帧控件未布局时 winfo_width 可能=1，导致删除按钮与下拉重叠
            self._cv.coords(self._win_mode, x, y); x -= self.mode_cb.winfo_reqwidth() + 6
            self._cv.coords(self._win_del, x, y); x -= self.del_btn.winfo_reqwidth() + 6
            if self._restart_shown:
                self._cv.coords(self._win_restart, x, y); x -= self.restart_btn.winfo_reqwidth() + 6
            if self._stop_shown:
                self._cv.coords(self._win_stop, x, y); x -= self.stop_btn.winfo_reqwidth() + 6
            self._cv.coords(self._txt_state, x - 6, y)
            bb = self._cv.bbox(self._txt_state)
            if bb:
                x -= (bb[2] - bb[0]) + 12
            self._cv.coords(self._txt_eta, x, y)
            bb = self._cv.bbox(self._txt_eta)
            if bb:
                x -= (bb[2] - bb[0]) + 12
            self._cv.coords(self._txt_pct, x, y)
        except Exception:
            pass

    def _paint_cv(self):
        """画视觉进度：灰底铺满整行 + 淡蓝从左到右填充（100% 覆盖到按钮组左缘，不覆盖按钮）"""
        s = self.rec.get("state")
        try:
            h = self.frame.winfo_height()
            if h > 4:
                self._cv.config(height=h)
        except Exception:
            h = 60
        self._cv.delete("bg")
        if s != "compressing":
            return
        try:
            # 100% = 淡蓝矩形覆盖到右侧按钮组左缘（压缩中=终止按钮左缘），不覆盖任何按钮
            right = self.stop_btn.winfo_x() if self._stop_shown else self.del_btn.winfo_x()
        except Exception:
            right = 0
        if right <= 0:
            right = max(self._cv.winfo_width(), 200)
        p = min(max((self.rec.get("progress") or 0) / 100.0, 0), 1.0)
        self._cv.create_rectangle(0, 0, right, h, fill=ROW_BG, outline="", tags="bg")
        if p > 0:
            self._cv.create_rectangle(0, 0, max(1, int(right * p)), h, fill=ROW_BG_ACTIVE, outline="", tags="bg")
        self._cv.tag_lower("bg")   # 背景矩形垫到最底层，避免盖住文字/控件（此前压缩开始后文件名被盖成空白）

    def _draw_bar(self):
        """自绘进度条：trough + 蓝色进度 + 居中百分比（文字直接画在条上，无底色不遮挡进度）"""
        W, H = 130, 18
        if self.task.state == "downloading" and not self.task.total_known:
            p = 0.0   # 总大小未知：空条
        else:
            p = min(max(self.task.progress, 0), 100)
        c = self.bar
        c.delete("all")
        c.create_rectangle(0, 0, W, H, fill="#E8E8E8", outline="")
        if p > 0:
            c.create_rectangle(0, 0, max(1, int(W * p / 100)), H, fill="#4A90D9", outline="")
        c.create_text(W / 2, H / 2, text=f"{p:.0f}%", fill="#111111", font=("Segoe UI", 8))

    def refresh(self):
        r = self.rec
        s = r["state"]
        self._cv.itemconfig(self._txt_name, text=os.path.basename(r["path"]))
        try:
            in_size = os.path.getsize(r["path"])
        except Exception:
            in_size = 0
        if s == "done" and r.get("out") and os.path.exists(r["out"]):
            try:
                out_size = os.path.getsize(r["out"])
            except Exception:
                out_size = 0
            if in_size > 0 and out_size > 0:
                size_txt = f"{_fmt_size(in_size)} → {_fmt_size(out_size)} ({out_size / in_size * 100:.0f}%)"
            else:
                size_txt = f"{_fmt_size(in_size)} → {_fmt_size(out_size)}"
            el = _fmt_elapsed(r.get("elapsed"))
            if el:
                size_txt += f" · {el}"
        else:
            size_txt = _fmt_size(in_size)
        self._cv.itemconfig(self._txt_size, text=size_txt)
        self._cv.itemconfig(self._txt_pct,
                            text=f"{r['progress']:.0f}%" if s == "compressing" else "")
        self._cv.itemconfig(self._txt_eta,
                            text=_fmt_eta(r.get("eta")) if s == "compressing" else "")
        self._cv.itemconfig(self._txt_state,
                            text={"queued": "排队", "compressing": "压缩中", "done": "完成",
                                  "failed": "失败", "stopped": "已停止", "skipped": "收益小已终止"}.get(s, s))
        # 终止按钮：压缩中显示，其余隐藏；模式/删除状态
        if s == "compressing":
            if not self._stop_shown:
                self._stop_shown = True
                self._cv.itemconfigure(self._win_stop, state="normal")
            self.mode_cb.config(state="disabled")
            self.del_btn.config(state="disabled")
        else:
            if self._stop_shown:
                self._stop_shown = False
                self._cv.itemconfigure(self._win_stop, state="hidden")
            if s == "stopped":
                if not self._restart_shown:
                    self._restart_shown = True
                    self._cv.itemconfigure(self._win_restart, state="normal")
            else:
                # 非终止态每次刷新显式隐藏（不依赖初始状态，避免残留可见）
                if self._restart_shown:
                    self._restart_shown = False
                self._cv.itemconfigure(self._win_restart, state="hidden")
            if s in ("done", "skipped"):
                self.mode_cb.config(state="disabled")
                self.del_btn.config(state="normal")
            else:
                self.mode_cb.config(state="readonly")
                self.del_btn.config(state="normal")
        self._layout()
        try:
            self._cv.update_idletasks()   # create_window 移动后刷新 winfo 坐标，right 才能对齐
        except Exception:
            pass
        self._paint_cv()

    def _confirm_stop(self):
        """停止/删除执行态任务共用的警告弹窗"""
        return messagebox.askyesno("停止压缩",
                "停止后无法从断点继续压缩，需要重新添加该视频再从头压缩。\n确定停止吗？",
                parent=self.app.root)

    def _on_stop(self):
        r = self.rec
        if r["state"] != "compressing":
            return
        if not self._confirm_stop():
            return
        self.app.cqueue.stop(r)
        self.refresh()

    def _on_mode(self, _e=None):
        self.rec["mode"] = self.mode_cb.get()

    def _on_restart(self):
        """重新压缩：单个已停止任务从头重压"""
        self.app.cqueue.restart(self.rec)

    def _on_delete(self):
        r = self.rec
        if r["state"] == "compressing":
            # 执行态：与停止按钮共用警告弹窗，确认后终止并移出列表（未完成输出已由 stop 删除）
            if not self._confirm_stop():
                return
            self.app.cqueue.stop(r)
            self.app.cqueue.remove(r)
            self.frame.destroy()
            self.app.log(f"已终止并从压缩队列移除：{os.path.basename(r['path'])}")
            return
        # 结束态/排队：只移出列表，不删除任何文件
        if self.app.cqueue.remove(r):
            self.frame.destroy()
            self.app.log(f"已从压缩队列移除：{os.path.basename(r['path'])}")
            return
        if self.app.cqueue.remove(r):
            self.frame.destroy()
            self.app.log(f"已从压缩队列移除：{os.path.basename(r['path'])}")
class App:
    def __init__(self, root):
        self.root = root
        root.title("eazyVid 视频下载压缩工具")
        root.geometry("980x820")
        self._cleanup_stale_tmpdirs()
        self.q = queue.Queue()
        self.sniffer = None
        # 退出清理：防止 pythonw 进程残留（下载/嗅探线程阻止退出）
        self.root.protocol("WM_DELETE_WINDOW", self._on_exit)

        self.current_info = None

        self.formats = []
        self.captured = []
        self.cap_meta = {}
        self.hls_formats = []
        self.hls_urls = []
        self._hover_row = None
        self._probe_seq = 0   # 探测任务版本号：再次点击即作废上一轮
        self._dl_btn = None
        self.log_visible = False
        self.pool = DownloadPool(lambda ev: self.q.put(("ui", ev)), self.log)
        self.cqueue = CompressQueue(self.log, self._ui_event)
        self._load_compress_settings()
        self._build_ui()
        self._start_capture_server()
        root.after(100, self._poll_queue)

    def _on_exit(self):
        """退出清理：任务进行中 → 确认弹窗 + 杀进程树（下载 yt-dlp / 压缩 ffmpeg）；关闭嗅探 Chrome。"""
        # 1) 统计进行中任务（下载中 / 压缩中）
        dl = [t for t in self.pool.tasks
              if t.state == "downloading" and getattr(t, "proc", None) is not None and t.proc.poll() is None]
        cp = [r for r in self.cqueue.tasks if r["state"] == "compressing"]
        if dl or cp:
            if not messagebox.askyesno(
                    "任务进行中",
                    f"当前有 {len(dl) + len(cp)} 个任务正在进行（下载 {len(dl)} 个、压缩 {len(cp)} 个）。\n"
                    "退出会中断这些任务，未完成任务的文件将被删除：压缩的中间输出、下载的临时缓存都会被清除（源文件保留）。\n确定要退出吗？",
                    parent=self.root):
                return
        # 2) 杀下载进程树（yt-dlp 可能带 ffmpeg 合并子进程），并清理下载缓存（.part 临时目录）
        for t in dl:
            _kill_proc_tree(t.proc)
            try:
                td = getattr(t, "tmpdir", None)
                if td and os.path.isdir(td):
                    shutil.rmtree(td, ignore_errors=True)
            except Exception:
                pass
        # 3) 杀压缩进程树（ffmpeg），并删除压缩到一半的不完整输出（同"终止"语义）
        for r in cp:
            ph = r.get("_ph") or {}
            p = ph.get("proc")
            if p is not None:
                _kill_proc_tree(p)
            try:
                d = self.cqueue.out_dir or os.path.dirname(r["path"]) or "."
                stem = os.path.splitext(os.path.basename(r["path"]))[0]
                cands = [os.path.join(d, f"{stem}_压缩.mp4"), r.get("out")]
                for cand in cands:
                    if not cand:
                        continue
                    for _ in range(3):
                        try:
                            if os.path.exists(cand):
                                os.remove(cand)
                            break
                        except Exception:
                            time.sleep(0.2)
            except Exception:
                pass
        # 4) 关闭嗅探播放 Chrome 并强制退出，防止 pythonw 进程残留
        try:
            sn = getattr(self, "sniffer", None)
            if sn is not None:
                try:
                    sn.stop()
                except Exception:
                    pass
                proc = getattr(sn, "proc", None)
                if proc is not None and proc.poll() is None:
                    try:
                        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                                       capture_output=True, timeout=5)
                    except Exception:
                        pass
        except Exception:
            pass
        try:
            self.log("===== 程序退出（已清理任务进程）=====")
        except Exception:
            pass
        try:
            os.remove(os.path.join(SCRIPT_DIR, "eazyvid.lock"))
        except OSError:
            pass
        os._exit(0)

    def _load_dl_dir(self):
        """读取下载目录（设置页配置；默认=程序目录/downloaded；不存在则创建）"""
        default = os.path.join(SCRIPT_DIR, "downloaded")
        try:
            os.makedirs(default, exist_ok=True)
        except OSError:
            pass
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as _f:
                _d = json.load(_f).get("download_dir", "")
            if _d and os.path.isdir(_d):
                return _d
        except Exception:
            pass
        return default

    def _save_dl_dir(self, *_):
        """保存当前下载目录到配置（目录变化即写入；仅保存存在的目录）"""
        try:
            _d = self.dl_dir_var.get().strip()
            if _d and os.path.isdir(_d):
                try:
                    with open(SETTINGS_FILE, "r", encoding="utf-8") as _f:
                        _cfg = json.load(_f)
                except Exception:
                    _cfg = {}
                _cfg["download_dir"] = _d
                with open(SETTINGS_FILE, "w", encoding="utf-8") as _f:
                    json.dump(_cfg, _f, ensure_ascii=False)
        except Exception:
            pass

    def _load_compress_settings(self):
        """读取压缩输出设置（same/custom + 目录）"""
        self._compress_mode = "same"
        self._compress_dir = ""
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as _f:
                _cfg = json.load(_f)
            self._compress_dir = _cfg.get("compress_dir", "")
            self._max_workers = max(1, int(_cfg.get("max_workers", 1) or 1))
            self.cqueue.max_workers = self._max_workers
            self.cqueue._start_workers()
            self._compress_mode = _cfg.get("compress_mode", "same")
            self._compress_dir = _cfg.get("compress_dir", "")
        except Exception:
            pass
        if self._compress_mode == "custom" and self._compress_dir and os.path.isdir(self._compress_dir):
            self.cqueue.out_dir = self._compress_dir
        else:
            if self._compress_mode == "custom":
                self._compress_mode = "same"
                self._compress_dir = ""
            self.cqueue.out_dir = None

    def _save_compress_settings(self):
        """保存压缩输出设置"""
        try:
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as _f:
                    _cfg = json.load(_f)
            except Exception:
                _cfg = {}
            _cfg["compress_mode"] = self._compress_mode
            _cfg["compress_dir"] = self._compress_dir
            _cfg["max_workers"] = getattr(self, "_max_workers", 1)
            with open(SETTINGS_FILE, "w", encoding="utf-8") as _f:
                json.dump(_cfg, _f, ensure_ascii=False)
        except Exception:
            pass

    def _cleanup_stale_tmpdirs(self):
        """启动时清理历史残留的下载临时目录（仅超过 10 分钟、且非当前进程的）"""
        try:
            cur = os.getpid()
            cutoff = time.time() - 600
            bases = {SCRIPT_DIR, os.path.join(os.path.expanduser("~"), "Downloads"),
                     r"D:\Documents\Downloads"}
            for base in bases:
                if not os.path.isdir(base):
                    continue
                for d in os.listdir(base):
                    if not d.startswith(".eazyvid_"):
                        continue
                    p = os.path.join(base, d)
                    try:
                        if os.path.isdir(p) and os.path.getmtime(p) < cutoff \
                                and f"_{cur}" not in d:
                            shutil.rmtree(p, ignore_errors=True)
                    except Exception:
                        pass
        except Exception:
            pass

    def _build_ui(self):
        pad = {"padx": 8, "pady": 4}

        # ---- 顶部固定：标题 + 功能选项卡 ----
        self._topbar = ttk.Frame(self.root)
        self._topbar.pack(fill="x", **pad)
        ttk.Label(self._topbar, text="eazyVid", font=("", 12, "bold")).pack(side="left", padx=4)
        self._tab_dl = ttk.Button(self._topbar, text="● 视频下载", width=12, command=lambda: self._show_page("dl"))
        self._tab_dl.pack(side="left", padx=6)
        self._tab_cp = ttk.Button(self._topbar, text="○ 视频压缩", width=12, command=lambda: self._show_page("cp"))
        self._tab_cp.pack(side="left", padx=6)
        self._gear_btn = ttk.Button(self._topbar, text="⚙", width=3, command=self._open_settings)
        self._gear_btn.pack(side="left", padx=2)

        # ---- 中部内容区（tab 切换）----
        self._content = ttk.Frame(self.root)
        self._content.pack(fill="both", expand=True)
        self._dl_page = ttk.Frame(self._content)
        self._cp_page = ttk.Frame(self._content)

        # ===== 下载页 =====
        # 下载目录（由设置页配置；默认=程序目录/downloaded）
        self.dl_dir_var = tk.StringVar(value=self._load_dl_dir())
        self.dl_dir_var.trace_add("write", self._save_dl_dir)
        top = ttk.Frame(self._dl_page)
        top.pack(fill="x", **pad)
        ttk.Label(top, text="视频页 URL:").pack(side="left")
        self.url_var = tk.StringVar()
        self.url_entry = ttk.Entry(top, textvariable=self.url_var, width=64)
        self.url_entry.pack(side="left", fill="x", expand=True, padx=4)
        self._make_rightclick_menu(self.url_entry)
        # 粘贴时自动提取 URL（分享文本+链接混杂，如抖音/微博分享文案）
        self.url_entry.bind("<Control-v>", self._paste_url_extract)
        self.url_entry.bind("<<Paste>>", self._paste_url_extract)
        self.url_entry.bind("<Return>", lambda _e: self.on_probe())   # 粘贴完直接回车探测
        ttk.Button(top, text="粘贴", command=lambda: self._paste_url_extract()).pack(side="left", padx=2)
        ttk.Button(top, text="探测格式", command=self.on_probe).pack(side="left", padx=2)
        self._probe_bar = ttk.Progressbar(top, mode="indeterminate", length=120)
        self._probe_bar.pack_forget()

        frm = ttk.LabelFrame(self._dl_page, text="格式列表（鼠标移到行上点「下载」；⚠=AV1/VP9 部分播放器不支持）")
        frm.pack(fill="both", expand=True, **pad)
        cols = ("res", "fid", "codec", "size")
        self.fmt_tree = ttk.Treeview(frm, columns=cols, show="headings", height=9)
        for k, (t, w) in {"res": ("分辨率", 76), "fid": ("格式ID", 56), "codec": ("编码", 170),
                          "size": ("大小", 66)}.items():
            self.fmt_tree.heading(k, text=t)
            self.fmt_tree.column(k, width=w, anchor="w")
        self.fmt_tree.pack(fill="both", expand=True)
        self.fmt_tree.bind("<Motion>", self._on_tree_motion)
        self.fmt_tree.bind("<Leave>", lambda e: self._hide_dl_btn())
        self.fmt_tree.bind("<Button-1>", self._on_tree_click)
        self.fmt_tree.bind("<Double-1>", self._on_tree_double)
        self._dl_btn = ttk.Button(self.fmt_tree, text="⬇ 下载", width=8)
        self._dl_btn.place_forget()

        pf = ttk.LabelFrame(self._dl_page, text="下载池（并行下载，可暂停/恢复；每行可选压缩模式）")
        pf.pack(fill="both", expand=True, **pad)
        self._pool_canvas = tk.Canvas(pf, height=190)
        sb = ttk.Scrollbar(pf, orient="vertical", command=self._pool_canvas.yview)
        self._pool_inner = ttk.Frame(self._pool_canvas)
        self._pool_win = self._pool_canvas.create_window((0, 0), window=self._pool_inner, anchor="nw")
        self._pool_inner.bind("<Configure>", lambda e: self._pool_canvas.configure(scrollregion=self._pool_canvas.bbox("all")))
        self._pool_canvas.bind("<Configure>", lambda e: self._pool_canvas.itemconfigure(self._pool_win, width=e.width))
        self._pool_canvas.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        # ===== 压缩页 =====
        cptop = ttk.Frame(self._cp_page)
        cptop.pack(fill="x", **pad)
        ttk.Label(cptop, text="压缩队列").pack(side="left")
        ttk.Button(cptop, text="添加视频…", command=self._pick_compress_files).pack(side="left", padx=6)
        ttk.Button(cptop, text="添加文件夹…", command=self._pick_compress_dir).pack(side="left", padx=6)
        self.compress_mode_var = tk.StringVar(value="x265 默认(推荐)")
        ttk.Combobox(cptop, textvariable=self.compress_mode_var, state="readonly",
                     values=list(COMPRESS_MODES.keys()), width=16).pack(side="left", padx=6)
        ttk.Button(cptop, text="开始压缩", command=self._cq_start).pack(side="left", padx=6)
        ttk.Label(cptop, text="（下载完成的按原选择，手动添加的用此默认模式）", foreground="#888").pack(side="left", padx=6)
        cpf = ttk.LabelFrame(self._cp_page, text="压缩任务")
        cpf.pack(fill="both", expand=True, **pad)
        self._cp_canvas = tk.Canvas(cpf, height=300)
        sb2 = ttk.Scrollbar(cpf, orient="vertical", command=self._cp_canvas.yview)
        self._cp_inner = ttk.Frame(self._cp_canvas)
        if _HAVE_DND:
            try:
                self._cp_canvas.drop_target_register(DND_FILES)
                self._cp_canvas.dnd_bind("<<Drop>>", self._on_drop_files)
                self._cp_inner.drop_target_register(DND_FILES)
                self._cp_inner.dnd_bind("<<Drop>>", self._on_drop_files)
            except Exception:
                pass
        self._cp_win = self._cp_canvas.create_window((0, 0), window=self._cp_inner, anchor="nw")
        self._cp_inner.bind("<Configure>", lambda e: self._cp_canvas.configure(scrollregion=self._cp_canvas.bbox("all")))
        self._cp_canvas.bind("<Configure>", lambda e: self._cp_canvas.itemconfigure(self._cp_win, width=e.width))
        self._cp_canvas.pack(side="left", fill="both", expand=True)
        sb2.pack(side="right", fill="y")
        ttk.Label(self._cp_page,
                  text="模式说明：x265 默认≈体积减半画质不变；高画质最接近原片；小体积最省空间；NVENC 用显卡编码最快。",
                  foreground="#666").pack(anchor="w", padx=8)

        # 默认显示下载页
        self._show_page("dl")

        # ---- 底部固定：日志 ----
        self._bottom_bar = ttk.Frame(self.root)
        self._bottom_bar.pack(fill="x", **pad)
        self._log_btn = ttk.Button(self._bottom_bar, text="▸ 日志（调试）", command=self._toggle_log)
        self._log_btn.pack(anchor="w")
        self.log_text = tk.Text(self._bottom_bar, height=7, state="disabled", wrap="word")
        self.logfile = os.path.join(SCRIPT_DIR, "eazyvid.log")
        try:
            with open(self.logfile, "a", encoding="utf-8") as _lf:
                _lf.write(f"\n===== 启动 {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n")
        except Exception:
            pass
        self.log("就绪：粘贴视频地址 → 解析；失败会引导你播放视频页。")

    def _show_page(self, name):
        """切换下载页/压缩页（top bar 与 bottom 不动）"""
        for w in (self._dl_page, self._cp_page):
            w.pack_forget()
        if name == "cp":
            self._cp_page.pack(fill="both", expand=True)
            self._tab_dl.config(text="○ 视频下载")
            self._tab_cp.config(text="● 视频压缩")
        else:
            self._dl_page.pack(fill="both", expand=True)
            self._tab_dl.config(text="● 视频下载")
            self._tab_cp.config(text="○ 视频压缩")

    def _center_window(self, win, w, h):
        """弹窗对齐到主面板中心"""
        try:
            self.root.update_idletasks()
            rx, ry = self.root.winfo_rootx(), self.root.winfo_rooty()
            rw, rh = self.root.winfo_width(), self.root.winfo_height()
            x = rx + (rw - w) // 2
            y = ry + (rh - h) // 2
            win.geometry(f"{w}x{h}+{x}+{y}")
        except Exception:
            win.geometry(f"{w}x{h}")

    def _open_settings(self):
        """设置弹窗：下载目录 + 压缩输出目录（后续功能在此逐项增加）"""
        win = tk.Toplevel(self.root)
        win.title("设置")
        self._center_window(win, 560, 260)
        win.transient(self.root)
        win.grab_set()
        wp = {"padx": 8, "pady": 5}

        ttk.Label(win, text="视频下载目录:").grid(row=0, column=0, sticky="w", **wp)
        dl_var = tk.StringVar(value=self.dl_dir_var.get())
        ttk.Entry(win, textvariable=dl_var, width=44).grid(row=0, column=1, sticky="we", **wp)
        ttk.Button(win, text="浏览…", width=6,
                   command=lambda: self._settings_pick_dir(dl_var)).grid(row=0, column=2, **wp)

        ttk.Separator(win).grid(row=1, column=0, columnspan=3, sticky="we", pady=6)

        ttk.Label(win, text="压缩输出目录:").grid(row=2, column=0, sticky="w", **wp)
        cmode = tk.StringVar(value=self._compress_mode)
        cdir_var = tk.StringVar(value=self._compress_dir)
        ttk.Radiobutton(win, text="与源文件同目录（默认）", value="same", variable=cmode).grid(row=2, column=1, sticky="w", **wp)
        ttk.Radiobutton(win, text="指定目录", value="custom", variable=cmode).grid(row=3, column=1, sticky="w", **wp)
        cdir_entry = ttk.Entry(win, textvariable=cdir_var, width=44)
        cdir_entry.grid(row=4, column=1, sticky="we", **wp)
        ttk.Button(win, text="浏览…", width=6,
                   command=lambda: self._settings_pick_dir(cdir_var, cmode)).grid(row=4, column=2, **wp)

        def on_mode_change(*_):
            st = "normal" if cmode.get() == "custom" else "disabled"
            cdir_entry.config(state=st)
        cmode.trace_add("write", on_mode_change)
        on_mode_change()

        def ok():
            d = dl_var.get().strip()
            if not d:
                messagebox.showwarning("提示", "下载目录不能为空", parent=win)
                return
            if not os.path.isdir(d):
                try:
                    os.makedirs(d, exist_ok=True)
                except OSError:
                    messagebox.showwarning("提示", f"无法创建目录：{d}", parent=win)
                    return
            self.dl_dir_var.set(d)
            self._compress_mode = cmode.get()
            self._compress_dir = cdir_var.get().strip()
            if self._compress_mode == "custom" and not (self._compress_dir and os.path.isdir(self._compress_dir)):
                messagebox.showwarning("提示", "指定目录无效（不存在或未选择），已改为与源文件同目录", parent=win)
                self._compress_mode = "same"
                self._compress_dir = ""
            self._max_workers = max(1, int(workers_var.get() or 1))
            self.cqueue.max_workers = self._max_workers
            self.cqueue._start_workers()
            self._save_compress_settings()
            self.cqueue.out_dir = self._compress_dir if self._compress_mode == "custom" else None
            win.destroy()
            tail = "与源文件同目录" if self._compress_mode == "same" else self._compress_dir
            self.log(f"设置已保存：下载目录 {d}；压缩输出 {tail}")

        ttk.Separator(win).grid(row=5, column=0, columnspan=3, sticky="we", pady=6)
        ttk.Label(win, text="同时压缩数:").grid(row=6, column=0, sticky="w", **wp)
        workers_var = tk.StringVar(value=str(getattr(self, "_max_workers", 1)))
        workers_entry = ttk.Spinbox(win, textvariable=workers_var, width=8,
                                    from_=1, to=16, increment=1)
        workers_entry.grid(row=6, column=1, sticky="w", **wp)
        workers_entry.configure(validate="key",
                                validatecommand=(win.register(lambda p: p == "" or p.isdigit()), "%P"))
        ttk.Label(win, text="（建议 1~4，过大会占满 CPU/磁盘）", foreground="#888").grid(row=6, column=2, sticky="w", **wp)
        btns = ttk.Frame(win)
        btns = ttk.Frame(win)
        btns.grid(row=7, column=1, columnspan=2, sticky="e", pady=10)
        ttk.Button(btns, text="确定", width=8, command=ok).pack(side="left", padx=4)
        ttk.Button(btns, text="取消", width=8, command=win.destroy).pack(side="left", padx=4)
        win.columnconfigure(1, weight=1)
        win.resizable(False, False)

    def _settings_pick_dir(self, var, mode_var=None):
        d = filedialog.askdirectory(initialdir=var.get() or SCRIPT_DIR, parent=self.root)
        if d:
            var.set(d)
            if mode_var is not None:
                mode_var.set("custom")   # 浏览选中目录即视为"指定目录"

    def _cq_start(self):
        """开始压缩：唤醒队列处理排队任务（手动模式，点此才真正开始压）"""
        self.cqueue.start()
        n = sum(1 for t in self.cqueue.tasks if t["state"] == "queued")
        self.log(f"开始压缩：队列 {n} 个任务，并发 {self.cqueue.max_workers}")

    def _reorder_compress_rows(self):
        """压缩行排序：结束态(done/stopped/skipped/failed)最上 → 压缩中 → 排队；
        各组内保持原有相对顺序（稳定排序）"""
        with self.cqueue._lock:
            def grp(t):
                s = t["state"]
                if s in ("done", "stopped", "skipped", "failed"):
                    return 0
                if s == "compressing":
                    return 1
                return 2
            self.cqueue.tasks.sort(key=grp)

    def _relayout_compress_rows(self):
        """按 tasks 顺序用 place 手动布局压缩行（每行 pitch 34px）"""
        try:
            ROW_H, PITCH = 30, 34
            y = 2
            for t in self.cqueue.tasks:
                r = t.get("row")
                if r is None:
                    continue
                try:
                    r.frame.place(x=0, y=y, relwidth=1.0, height=ROW_H)
                except Exception:
                    pass
                y += PITCH
            n = sum(1 for t in self.cqueue.tasks if t.get("row") is not None)
            total = max(2 + n * PITCH, 30)
            self._cp_inner.configure(height=total)
            try:
                self._cp_canvas.configure(scrollregion=self._cp_canvas.bbox("all"))
            except Exception:
                pass
            self._cp_canvas.update_idletasks()
        except Exception:
            pass

    def _on_drop_files(self, event):
        """文件拖入压缩列表：解析 DND_FILES 路径（含空格路径用花括号包裹）→ 过滤视频 → 排队尾"""
        data = event.data or ""
        paths = []
        for m in re.finditer(r"\{([^}]*)\}", data):
            paths.append(m.group(1))
        rest = re.sub(r"\{[^}]*\}", "", data)
        for part in rest.split():
            if part.strip():
                paths.append(part.strip())
        exts = (".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv", ".webm", ".ts", ".m4v",
                ".mpg", ".mpeg", ".3gp", ".m2ts", ".vob")
        added = 0
        for path in paths:
            if os.path.isfile(path) and path.lower().endswith(exts):
                self.cqueue.add(path, self.compress_mode_var.get())
                added += 1
        if added:
            self.log(f"已拖入 {added} 个文件到压缩队列")

    def _pick_compress_files(self):
        files = filedialog.askopenfilenames(
            title="选择要压缩的视频",
            filetypes=[("视频文件", "*.mp4 *.mkv *.avi *.mov *.flv *.wmv *.webm *.ts *.m4v"), ("所有文件", "*.*")],
            parent=self.root)
        n = 0
        for f in files:
            self.cqueue.add(f, self.compress_mode_var.get())
            n += 1
        if n:
            self.log(f"已添加 {n} 个文件到压缩队列")
    def _pick_compress_dir(self):
        """选择文件夹：递归扫描（目录穿透）所有视频文件加入压缩队列"""
        d = filedialog.askdirectory(
            title="选择要压缩的视频文件夹（含子目录）",
            initialdir=self.cqueue.out_dir or os.path.join(SCRIPT_DIR, "downloaded")
            if os.path.isdir(os.path.join(SCRIPT_DIR, "downloaded")) else SCRIPT_DIR,
            parent=self.root)
        if not d:
            return
        exts = (".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv", ".webm", ".ts", ".m4v",
                ".mpg", ".mpeg", ".3gp", ".m2ts", ".vob")
        found = []
        for _root, _dirs, files in os.walk(d):
            for fn in files:
                if fn.lower().endswith(exts):
                    found.append(os.path.join(_root, fn))
        if not found:
            messagebox.showinfo("添加文件夹", "该目录下没有找到视频文件（含子目录）", parent=self.root)
            return
        if not messagebox.askyesno(
                "添加文件夹", f"找到 {len(found)} 个视频文件（含子目录）\n加入压缩队列？",
                parent=self.root):
            return
        existing = {t["path"].lower() for t in self.cqueue.tasks}
        dup, added = 0, 0
        for f in found:
            if f.lower() in existing:
                dup += 1
                continue
            self.cqueue.add(f, self.compress_mode_var.get())
            existing.add(f.lower())
            added += 1
        self.log(f"添加文件夹：找到 {len(found)} 个视频，新入队 {added}，已在队列 {dup} 个（含子目录）")

    def _paste_url_extract(self, event=None):
        """粘贴时自动提取 URL：从分享文本里抓出第一个链接填入输入框"""
        w = getattr(event, "widget", None) if event else getattr(self, "url_entry", None)
        if w is None:
            w = self.url_entry
        try:
            clip = w.clipboard_get()
        except Exception:
            return "break" if event else None
        url = _extract_url(clip) or clip
        w.delete(0, "end")
        w.insert(0, url)
        if event:
            return "break"

    def _make_rightclick_menu(self, widget):
        """右键直接粘贴（tkinter 默认没有右键粘贴；同样走 URL 自动提取）"""
        def paste(e):
            self._paste_url_extract(e)
        widget.bind("<Button-3>", paste)
    def _pick_dir(self):
        d = filedialog.askdirectory(initialdir=self.dl_dir_var.get() or SCRIPT_DIR)
        if d:
            self.dl_dir_var.set(d)

    def _ensure_new_download(self, url, fmt_arg):
        """同 URL 同格式已在池中 → 提示；已下载完成 → 询问是否重新下载"""
        for t in self.pool.tasks:
            if t.url == url and t.fmt_arg == fmt_arg:
                if t.state in ("downloading", "paused", "waiting"):
                    messagebox.showinfo("已在下载池",
                        "该视频（此清晰度/格式）已在下载池中（下载中/排队/暂停），无需重复添加。",
                        parent=self.root)
                    return False
                if t.state == "done":
                    return messagebox.askyesno("已下载过",
                        "该视频（此清晰度/格式）此前已下载完成。\n是否重新下载？",
                        parent=self.root)
        return True

    # ---------- 日志与队列 ----------
    def log(self, msg):
        self.q.put(("log", msg))

    def _show_log(self, msg):
        self.log_text.config(state="normal")
        self.log_text.insert("end", msg + "\n")
        try:
            lines = int(self.log_text.index("end-1c").split(".")[0])
            if lines > 500:
                self.log_text.delete("1.0", f"{lines - 300}.0")
        except Exception:
            pass
        self.log_text.see("end")
        self.log_text.config(state="disabled")
        try:
            with open(self.logfile, "a", encoding="utf-8") as _lf:
                _lf.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
        except Exception:
            pass

    def _toggle_log(self):
        if self.log_visible:
            self.log_text.pack_forget()
            self._log_btn.config(text="▸ 日志（调试）")
            self.log_visible = False
        else:
            self.log_text.pack(fill="both", expand=True, padx=8, pady=4)
            self._log_btn.config(text="▾ 日志（调试）")
            self.log_visible = True

    def _poll_queue(self):
        n = 0
        try:
            while n < 200:
                item = self.q.get_nowait()
                n += 1
                kind = item[0]
                if kind == "log":
                    self._show_log(item[1])
                elif kind == "formats":
                    self._probe_bar.stop()
                    self._probe_bar.pack_forget()
                    self._show_formats(item[1])
                elif kind == "probe_fail":
                    self._probe_bar.stop()
                    self._probe_bar.pack_forget()
                    self._probe_failed(item[1])
                elif kind == "capture":
                    self._on_capture_url(item[1])
                elif kind == "hls_formats":
                    _, url, ph, fmts = item
                    self._show_hls_formats(url, ph, fmts)
                elif kind == "hls_fail":
                    _, ph, err = item
                    try:
                        self.fmt_tree.delete(ph)
                    except Exception:
                        pass
                    self.log(f"HLS 清晰度解析失败：{err[-200:]}")
                elif kind == "cap_info":
                    _, url, iid, size, res = item
                    try:
                        self.cap_meta[url] = {"size": size, "res": res}
                        vals = list(self.fmt_tree.item(iid).get("values") or [])
                        if vals:
                            if res:
                                vals[0] = res
                            vals[3] = format_size(size) if size else "未知大小"
                            self.fmt_tree.item(iid, values=vals)
                    except Exception:
                        pass
                elif kind == "sniff_timeout":
                    messagebox.showinfo("未捕获到视频",
                        "这一分钟内没有嗅探到视频文件。\n常见原因：播放器加载过快，视频流请求早于嗅探连接。\n请在播放窗口按 F5 刷新页面（重新触发视频流请求），\n然后重新点「探测格式」。", parent=self.root)
                elif kind == "ui":
                    self._ui_event(item[1])
                elif kind in ("added", "progress", "paused"):
                    self._ui_event((kind, item[1]))
                elif kind == "done":
                    self._ui_event(("done", item[1]))
                elif kind in ("cqueued", "cstarted", "cprogress", "cdone"):
                    rec = item[1]
                    if rec.get("row") is None:
                        try:
                            rec["row"] = CompressRow(self._cp_inner, rec, self)
                        except Exception:
                            pass
                    if rec.get("row"):
                        try:
                            rec["row"].refresh()
                        except Exception:
                            pass
                    if kind in ("cqueued", "cstarted", "cdone"):
                        self._reorder_compress_rows()
                        self._relayout_compress_rows()
                    if kind == "cdone":
                        tail = f" → {os.path.basename(rec['out'])}" if rec.get("ok") and rec.get("out") else ""
                        self.log(f"压缩{'成功' if rec.get('ok') else '失败'}：{os.path.basename(rec['path'])}{tail}")
        except queue.Empty:
            pass
        self.root.after(100, self._poll_queue)

    # ---------- 探测与嗅探 ----------
    def on_probe(self):
        url = self.url_var.get().strip()
        if not url:
            messagebox.showwarning("提示", "请先粘贴视频页 URL", parent=self.root)
            return
        # 再次点击：作废上一轮任务（杀旧探测进程、停止嗅探会话），以本次为准
        self._probe_seq += 1
        self._halt_probes()
        sn = getattr(self, "sniffer", None)
        if sn is not None:
            try:
                sn.stop()
            except Exception:
                pass
        # 新地址：清空上一轮列表与捕获，避免新旧结果混在一起
        self.formats = []
        self.captured = []
        self.current_info = None
        self._hover_row = None
        self._hide_dl_btn()
        self.fmt_tree.delete(*self.fmt_tree.get_children())
        self.log(f"正在探测：{url}")
        self._probe_bar.pack(side="left", padx=4)
        self._probe_bar.start(15)
        threading.Thread(target=self._probe_worker, args=(url, self._probe_seq), daemon=True).start()

    def _probe_worker(self, url, seq):
        info, err = probe_url(url)
        if seq != self._probe_seq:
            return  # 已被新一轮探测取代，丢弃
        # Fresh cookies：跳过缓存强制重取实时 cookie 重试一次（嗅探窗口访问过 → CDP 拿到新 cookie）
        if not info and err and "cookie" in err.lower():
            self.log("探测需要新鲜 cookie，已用实时 cookie 重试…")
            info, err = probe_url(url, force_cookie=True)
            if seq != self._probe_seq:
                return
        if info:
            fmts = extract_formats(info)
            if fmts:
                self.q.put(("formats", fmts))
                return
        fmts2, err2 = probe_formats_f(url)
        if seq != self._probe_seq:
            return
        if fmts2:
            self.log("探测 -J 失败，已回退 -F 格式表成功")
            self.q.put(("formats", fmts2))
            return
        self.q.put(("probe_fail", (url, err2 or err or "未找到格式")))

    def _probe_failed(self, payload):
        url, err = payload
        self.log(f"探测失败：{err}")
        win = tk.Toplevel(self.root)
        win.title("需要你播放一次")
        self._center_window(win, 480, 210)
        win.transient(self.root)
        tk.Label(win, text="视频文件藏得比较深，需要你在我们的窗口\n再点击一次播放。",
                 font=("Microsoft YaHei", 13), pady=12).pack()
        tk.Label(win, text="需要登录的网站请先在播放窗口登录一次（登录状态会保留，以后免登录）。",
                 fg="#666").pack()
        btns = tk.Frame(win)
        btns.pack(pady=10)
        tk.Button(btns, text="打开播放窗口", width=14,
                  command=lambda: self._start_auto_sniff(url, win)).pack(side="left", padx=6)
        tk.Button(btns, text="取消", width=10, command=win.destroy).pack(side="left", padx=6)

    def _start_auto_sniff(self, url, win):
        try:
            win.destroy()
        except Exception:
            pass
        self.log(f"嗅探：打开播放窗口 {url}")
        global _SNIFFER
        self.sniffer = Sniffer(self.log, self._on_sniff_event, self.root)
        _SNIFFER = self.sniffer
        err = self.sniffer.start(url)
        if err:
            messagebox.showerror("错误", err, parent=self.root)

    def _on_sniff_event(self, kind, payload):
        if kind == "captured":
            self.q.put(("capture", payload))
        elif kind == "timeout":
            self.q.put(("sniff_timeout",))

    def _on_capture_url(self, url):
        # HLS 分片（.ts/.m4s/seg-N…）：不逐个入列，避免列表爆炸/后台忙死。
        # 宿主 m3u8 通常会被网络层一并捕获（video src 即清单）；分片只做兜底反推。
        if self._is_hls_segment(url):
            self._merge_hls_segment(url)
            return
        # Range 字节流分片（URL 带 bytes=0-5019 的渐进式拉流）：还原完整视频 URL，片段不单独入列
        norm = self._normalize_range_url(url)
        if norm:
            url = norm
        key = self._capture_key(url)
        if any(self._capture_key(u) == key for u, in self.captured):
            return
        self.captured.append((url,))
        try:
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(url).query)
        except Exception:
            q = {}
        mime = q.get("mime", [""])[0]
        itag = q.get("itag", [""])[0]
        itag_label = ITAG_LABELS.get(int(itag)) if itag.isdigit() else None
        if itag_label:
            res_label, codec_label = itag_label
        elif mime.startswith("audio/"):
            res_label, codec_label = "音频流", (mime.split("/")[1] or "音频")
        elif mime.startswith("video/"):
            res_label, codec_label = "视频流", (mime.split("/")[1] or "视频")
        elif ".m3u8" in url:
            res_label, codec_label = "视频流(HLS)", "HLS"
            self._hls_seq = getattr(self, "_hls_seq", 0) + 1
            ph = f"hls_ph_{self._hls_seq}"
            self.fmt_tree.insert("", 0, iid=ph, values=(res_label, "捕获", codec_label, "解析中…"))
            threading.Thread(target=self._probe_hls, args=(url, ph, self._probe_seq), daemon=True).start()
            return
        elif ".mpd" in url:
            res_label, codec_label = "视频流(DASH)", "DASH"
        elif ".mp4" in url:
            res_label, codec_label = "视频流", "mp4"
        elif "video/webm" in mime:
            res_label, codec_label = "视频流", "webm"
        else:
            res_label, codec_label = "视频流?", "未知"
        iid = self.fmt_tree.insert("", 0, values=(
            res_label, "捕获", codec_label, "解析中…"))
        sn = getattr(self, "sniffer", None) or _SNIFFER
        if not (sn and sn.page_tip("已捕获视频流，请回主窗口下载")):
            self._show_tooltip("已捕获视频文件，请回到主窗口点「下载」")
        if ".m3u8" not in url and ".mpd" not in url and "音频" not in res_label:
            threading.Thread(target=self._probe_capture, args=(url, iid), daemon=True).start()
        if "音频" in res_label:
            self.log(f"嗅探捕获音频流：{url}")
        else:
            self.log(f"嗅探捕获视频流 {res_label}：{url}")

    def _capture_key(self, url):
        # 同一视频流的不同变体（bytes/expires/sig/ct 及网络参数变化）归并为一条：
        # 用主机+路径+稳定参数（mid/id/type/subId 等）作为身份标识。
        try:
            from urllib.parse import urlparse, parse_qs
            p = urlparse(url)
            q = parse_qs(p.query)
            stable = []
            for k in sorted(q.keys()):
                if k in ("bytes", "expires", "sig", "ct", "ch", "ms", "srcIp", "srcAg", "pr", "urls", "clientType", "cmd"):
                    continue
                stable.append("{0}={1}".format(k, q[k][0]))
            return p.scheme + "://" + p.netloc + p.path + "?" + "&".join(stable)
        except Exception:
            return url

    @staticmethod
    def _normalize_range_url(url):
        # 带 bytes= 的渐进式 Range 拉流（OK.ru 等）：bytes 只是字节区间参数，
        # 去掉后即完整视频 URL。通用：任何带 bytes= 的视频流请求都适用。
        try:
            from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
            p = urlparse(url)
            q = parse_qs(p.query)
            if "bytes" not in q:
                return None
            q.pop("bytes", None)
            return urlunparse((p.scheme, p.netloc, p.path, p.params, urlencode(q, doseq=True), p.fragment))
        except Exception:
            return None

    @staticmethod
    def _is_hls_segment(url):
        try:
            path = urllib.parse.urlparse(url).path.lower()
        except Exception:
            return False
        if ".m3u8" in path:
            return False
        if re.search(r'\.(ts|m4s|aac|m4a)(\?|$)', path):
            return True
        if re.search(r'(seg|chunk|media|part)[-_]?\d+(\.|/|$)', path):
            return True
        return False

    def _merge_hls_segment(self, url):
        try:
            p = urllib.parse.urlparse(url)
        except Exception:
            return
        key = p.path.rsplit('/', 1)[0]
        tried = getattr(self, "_hls_tried", None)
        if tried is None:
            tried = self._hls_tried = set()
        if key in tried:
            return
        tried.add(key)
        threading.Thread(target=self._infer_hls_playlist, args=(url,), daemon=True).start()

    def _infer_hls_playlist(self, url):
        try:
            p = urllib.parse.urlparse(url)
        except Exception:
            return
        base = p.path.rsplit('/', 1)[0] + '/'
        for name in ("index.m3u8", "master.m3u8", "playlist.m3u8"):
            cand = "{0}://{1}{2}{3}".format(p.scheme, p.netloc, base, name)
            if p.query:
                cand += "?" + p.query
            if any(u == cand for u, in self.captured):
                return
            if self._head_size(cand):
                self.log("嗅探：HLS 分片归并 → 宿主清单 " + cand)
                self.q.put(("capture", cand))
                return
        self.log("嗅探：忽略 HLS 分片（未找到宿主清单）" + url[:80])

    def _probe_capture(self, url, iid):
        """捕获流后台探测（并行）：URL 猜分辨率立即显示 → HEAD 拿大小 → -J 后台补精确。
        三路并行，列表先出 ~清晰度，随后补大小，最后补精确宽高；每行都有信息。"""
        m = re.search(r"(?:^|[/_.-])(\d{3,4})p(?=[/_.-]|$)", url, re.I)
        h = int(m.group(1)) if m else 0
        if h:
            self.q.put(("cap_info", url, iid, None, f"~{h}p"))
        threading.Thread(target=self._probe_j, args=(url, iid, h), daemon=True).start()
        size = self._head_size(url)
        if size:
            self.q.put(("cap_info", url, iid, size, f"~{h}p" if h else ""))
            self.log(f"探测 {url[-60:]}：HEAD 大小 {format_size(size)}")
        else:
            self.log(f"探测 {url[-60:]}：HEAD 失败（无大小），等 yt-dlp -J 兜底")

    def _probe_j(self, url, iid, h):
        # -J 下载探测限流：最多 2 个并发，避免多档并行 yt-dlp 下载探测拖慢系统
        with threading.Semaphore(2):
            try:
                self._probe_j_impl(url, iid, h)
            except Exception:
                pass

    def _probe_j_impl(self, url, iid, h):
        """yt-dlp -J 后台补精确分辨率/大小（不覆盖 HEAD 已拿到的大小）"""
        try:
            args = [YTDLP, "--ffmpeg-location", FFMPEG, "--no-playlist", "-J", "--no-warnings"]
            args += cookie_args()
            ref = self._sniff_referer()
            if ref and "googlevideo.com" not in url:
                args += ["--referer", ref]
            args.append(url)
            procs = getattr(self, "_probe_procs", None)
            if procs is None:
                procs = self._probe_procs = set()
            proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    encoding="utf-8", errors="replace",
                                    creationflags=NO_WINDOW | 0x00004000)
            procs.add(proc)
            try:
                try:
                    out, _ = proc.communicate(timeout=60)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    out, _ = proc.communicate()
            finally:
                procs.discard(proc)
            rc = proc.returncode
            if rc == 0:
                info = json.loads(out)
                size2 = info.get("filesize") or info.get("filesize_approx")
                h2 = info.get("height") or 0
                w2 = info.get("width") or 0
                if size2 or h2:
                    old = self.cap_meta.get(url) or {}
                    self.q.put(("cap_info", url, iid, size2 or old.get("size"),
                                (f"{w2}x{h2}" if h2 else (f"~{h}p" if h else ""))))
                    self.log(f"探测 {url[-60:]}：-J 精确 {w2}x{h2} / {format_size(size2) if size2 else '无大小'}")
            else:
                err = (out or "").strip().splitlines() or [""]
                self.log(f"探测 {url[-60:]}：-J 失败 rc={rc}（{err[-1][:120]}）")
        except Exception as e:
            self.log(f"探测 {url[-60:]}：-J 异常 {e}")

    def _halt_probes(self):
        # 下载开始：停掉所有后台 -J 探测（避免探测悄悄下载文件头与正式下载抢带宽/磁盘）
        procs = getattr(self, "_probe_procs", None)
        if procs:
            for p in list(procs):
                try:
                    p.kill()
                except Exception:
                    pass
            procs.clear()
        self.log("下载开始，已停止后台探测")

    def _probe_done_res(self, path):
        # 下载完成后 ffprobe 分辨率/编码，写日志（不压缩也能知道清晰度）
        try:
            if not os.path.exists(path):
                return
            r = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=20, creationflags=NO_WINDOW | 0x00004000)
            m = re.search(r"(\d{2,4})x(\d{2,4})", r.stderr or "")
            if m:
                self.log(f"下载文件分辨率：{m.group(1)}x{m.group(2)}（{os.path.basename(path)}）")
            else:
                self.log(f"下载文件信息：{os.path.basename(path)}（分辨率未知）")
        except Exception as e:
            self.log(f"下载文件探测失败：{e}")

    def _head_size(self, url):
        """HEAD 拿 Content-Length；被拦则 GET Range: bytes=0-0 从 Content-Range 取总大小"""
        try:
            import urllib.request
            ref = self._sniff_referer() or ""
            import ssl
            ctx = ssl._create_unverified_context()
            ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            for method, headers, is_range in (
                ("HEAD", {"User-Agent": ua, "Referer": ref}, False),
                ("GET", {"User-Agent": ua, "Referer": ref, "Range": "bytes=0-0"}, True),
            ):
                try:
                    req = urllib.request.Request(url, method=method, headers=headers)
                    with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
                        if is_range:
                            cr = r.headers.get("Content-Range") or ""
                            m = re.search(r"/\s*(\d+)\s*$", cr)
                            if m:
                                return int(m.group(1))
                        else:
                            cl = r.headers.get("Content-Length")
                            if cl:
                                return int(cl)
                except Exception:
                    continue
        except Exception:
            pass
        return None

    def _probe_hls(self, url, ph, seq=None):
        try:
            args = [YTDLP, "--ffmpeg-location", FFMPEG, "--no-playlist", "-J", "--no-warnings"]
            args += cookie_args()
            ref = self._sniff_referer()
            if ref and "googlevideo.com" not in url:
                args += ["--referer", ref]
            args.append(url)
            r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=90, creationflags=NO_WINDOW | 0x00004000)
            if seq is not None and seq != self._probe_seq:
                return  # 已被新一轮探测取代，丢弃
            if r.returncode != 0:
                self.q.put(("hls_fail", ph, (r.stderr or r.stdout or "")[-300:]))
                return
            info = json.loads(r.stdout)
            self.q.put(("hls_formats", url, ph, extract_formats(info)))
        except Exception as e:
            if seq is not None and seq != self._probe_seq:
                return
            self.q.put(("hls_fail", ph, str(e)))

    def _show_hls_formats(self, url, ph, fmts):
        try:
            self.fmt_tree.delete(ph)
        except Exception:
            pass
        if not fmts:
            self.log("HLS 流未解析出清晰度，将按默认最高清晰度下载")
            return
        self.hls_formats.append(fmts)
        self.hls_urls.append(url)
        base = len(self.hls_formats) - 1
        for i, f in enumerate(fmts, 1):
            v, a = f["vcodec"], f["acodec"]
            if v != "none" and a != "none":
                codec = f"{v.split('.')[0]}+{a.split('.')[0]}"
            elif v != "none":
                codec = v.split(".")[0] + "（自动合音轨）"
            else:
                codec = a.split(".")[0] + "（纯音频）"
            warn = "⚠" if ("av1" in v or "vp9" in v or "vp08" in v or "vp09" in v) else "✓"
            self.fmt_tree.insert("", 0, iid=f"hls_{base}_{i}", values=(
                f["res"] or "", f["id"], f"{codec} {warn}", fmt_size(f["size"])))
        self.log(f"HLS 嗅探展开 {len(fmts)} 个清晰度，可直接点选")

    def _sniff_referer(self):
        try:
            u = self.sniffer.start_url
            return u if u and u != "about:blank" else None
        except Exception:
            return None

    def _show_tooltip(self, msg):
        try:
            tip = tk.Toplevel(self.root)
            tip.overrideredirect(True)
            x = self.root.winfo_x() + 60
            y = self.root.winfo_y() + 60
            tip.geometry(f"+{x}+{y}")
            tk.Label(tip, text=msg, bg="#fff8dc", fg="#333",
                     font=("Microsoft YaHei", 11), padx=14, pady=8).pack()
            tip.after(3500, tip.destroy)
        except Exception:
            pass

    # ---------- 格式列表交互 ----------
    def _show_formats(self, fmts):
        self.formats = fmts
        self.fmt_tree.delete(*self.fmt_tree.get_children())
        for i, f in enumerate(fmts, 1):
            v, a = f["vcodec"], f["acodec"]
            if v != "none" and a != "none":
                codec = f"{v.split('.')[0]}+{a.split('.')[0]}"
            elif v != "none":
                codec = v.split(".")[0] + "（自动合音轨）"
            else:
                codec = a.split(".")[0] + "（纯音频）"
            warn = "⚠" if ("av1" in v or "vp9" in v or "vp08" in v or "vp09" in v) else "✓"
            self.fmt_tree.insert("", "end", iid=str(i), values=(
                f["res"] or "", f["id"], f"{codec} {warn}", fmt_size(f["size"])))
        self.log(f"探测成功：{len(fmts)} 个格式")

    def _mouse_on_dl_btn(self, e):
        """鼠标当前是否落在下载按钮上（防止事件冒泡把按钮点走/藏掉）"""
        try:
            return self._dl_btn.winfo_containing(e.x_root, e.y_root) is self._dl_btn
        except Exception:
            return False

    def _on_tree_click(self, e):
        if not self._mouse_on_dl_btn(e):
            self._hide_dl_btn()

    def _on_tree_double(self, e):
        row = self.fmt_tree.identify_row(e.y)
        if row:
            self._download_fmt_row(row)

    def _on_tree_motion(self, e):
        if self._mouse_on_dl_btn(e):
            return
        row = self.fmt_tree.identify_row(e.y)
        if not row:
            self._hide_dl_btn()
            self._hover_row = None
            return
        if row == self._hover_row:
            return
        self._hover_row = row
        bbox = self.fmt_tree.bbox(row)
        if bbox:
            _, y, _, h = bbox
            cb = self.fmt_tree.bbox(row, "codec")
            bw = 82
            if cb:
                x = cb[0] + cb[2] - bw
            else:
                x = max(0, bbox[2] - bw)
            self._dl_btn.place(x=x, y=y, width=bw, height=max(18, h))
            self._dl_btn.config(command=lambda r=row: self._download_fmt_row(r))

    def _hide_dl_btn(self):
        self._dl_btn.place_forget()

    def _download_fmt_row(self, row):
        self._hide_dl_btn()
        self._halt_probes()
        if not row:
            return
        try:
            idx = int(row) - 1
            fmt = self.formats[idx]
        except (ValueError, IndexError):
            if row.startswith("hls_"):
                try:
                    _, bi, i = row.split("_")
                    fmts = self.hls_formats[int(bi)]
                    fmt = fmts[int(i) - 1]
                    url = self.hls_urls[int(bi)]
                except Exception:
                    return
                fsz = fmt.get("size") or fmt.get("filesize") or fmt.get("filesize_approx")
                if not self._ensure_new_download(url, fmt_arg_for(fmt)):
                    return
                self.pool.add(url, fmt_arg_for(fmt), self.dl_dir_var.get(), None,
                              f"{fmt['res'] or fmt['id']} · {fmt['id']}", True,
                              referer=self._sniff_referer(), size=fsz)
                self.log(f"加入下载池：{fmt['res'] or fmt['id']}（HLS 格式 {fmt['id']}）")
                return
            url = self._capture_url_for_row(row)
            if not url:
                return
            vals = self.fmt_tree.item(row).get("values") or []
            is_audio = bool(vals and "音频" in str(vals[0]))
            name = (str(vals[0]) + " · 捕获") if vals and vals[0] else f"捕获流 {len(self.captured)}"
            meta = self.cap_meta.get(url) or {}
            if not self._ensure_new_download(url, None):
                return
            self.pool.add(url, None, self.dl_dir_var.get(), None,
                          name, True, referer=self._sniff_referer(),
                          size=meta.get("size"))
            if not is_audio:
                self.log("提示：该流是纯视频流（YouTube 分片视频通常无声音），如需声音请再下载对应音频流后合并")
            return
        url = self.url_var.get().strip()
        if not url:
            messagebox.showwarning("提示", "URL 为空", parent=self.root)
            return
        info = getattr(self, "current_info", None) or {}
        t = (info.get("title") or "").strip() or f"{fmt['res'] or fmt['id']} · {fmt['id']}"
        ext = fmt.get("ext") or "mp4"
        fsz = fmt.get("size") or fmt.get("filesize") or fmt.get("filesize_approx")
        if not self._ensure_new_download(url, fmt_arg_for(fmt)):
            return
        self.pool.add(url, fmt_arg_for(fmt), self.dl_dir_var.get(), None,
                      f"{t}.{ext}", True,
                      referer=url if not url.startswith("about:") else None,
                      size=fsz)
        self.log(f"加入下载池：{fmt['res'] or fmt['id']}（格式 {fmt['id']}）")

    def _capture_url_for_row(self, row):
        try:
            i = self.fmt_tree.index(row)
        except Exception:
            return None
        if 0 <= i < len(self.captured):
            return self.captured[len(self.captured) - 1 - i][0]
        return None

    # ---------- 下载池 UI ----------
    def _ui_event(self, event):
        kind, payload = event
        try:
            self._ui_event_impl(event)
        except Exception as e:
            self.log(f"界面刷新错误[{kind}]：{e}")

    def _ui_event_impl(self, event):
        kind, payload = event
        if kind == "added":
            task = payload
            row = TaskRow(self._pool_inner, task, self)
            task.ui = row
            row.refresh()
        elif kind == "progress":
            if payload.ui:
                payload.ui.refresh()
        elif kind == "paused":
            if payload.ui:
                payload.ui.refresh()
        elif kind == "done":
            task = payload
            if task.ui:
                task.ui.refresh()
            if task.state == "done" and task.out_path:
                threading.Thread(target=self._probe_done_res, args=(task.out_path,), daemon=True).start()
                if task.mode:
                    self.cqueue.add(task.out_path, task.mode, task.ui, autostart=True)
                    self.log(f"下载完成，加入压缩队列：{os.path.basename(task.out_path)}（{task.mode}）")
                else:
                    self.log(f"下载完成：{os.path.basename(task.out_path)}（未压缩，可到压缩页手动转）")
        elif kind in ("cqueued", "cstarted", "cprogress", "cdone"):
            rec = payload
            if rec.get("row") is None:
                try:
                    rec["row"] = CompressRow(self._cp_inner, rec, self)
                except Exception:
                    pass
            if rec.get("row"):
                try:
                    rec["row"].refresh()
                except Exception:
                    pass
            if kind in ("cqueued", "cstarted", "cdone"):
                self._reorder_compress_rows()
                self._relayout_compress_rows()
            if kind == "cdone":
                if rec.get("state") == "stopped":
                    self.log(f"压缩已停止：{os.path.basename(rec['path'])}")
                else:
                    tail = f" → {os.path.basename(rec['out'])}" if rec.get("ok") and rec.get("out") else ""
                    self.log(f"压缩{'成功' if rec.get('ok') else '失败'}：{os.path.basename(rec['path'])}{tail}")

    # ---------- 服务 ----------
    def _start_capture_server(self):
        CaptureHandler.APP = self
        try:
            httpd = HTTPServer(("127.0.0.1", CAPTURE_PORT), CaptureHandler)
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            self.log(f"本地接收服务已启动（端口 {CAPTURE_PORT}）")
        except OSError as e:
            self.log(f"本地接收服务启动失败：{e}")

def _pid_alive(pid):
    """跨平台进程存活检查"""
    if os.name == "nt":
        try:
            r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                               capture_output=True, text=True, timeout=5,
                               creationflags=NO_WINDOW | 0x00004000)
            return str(pid) in r.stdout
        except Exception:
            return True
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False

def _acquire_single_instance(lock_path):
    """防多开：锁文件 + PID 存活检查；返回 True=本实例拿到锁"""
    if os.path.exists(lock_path):
        try:
            with open(lock_path, "r", encoding="utf-8") as _f:
                old_pid = int(_f.read().strip() or "0")
        except (ValueError, OSError):
            old_pid = 0
        if old_pid and _pid_alive(old_pid):
            return False
    try:
        with open(lock_path, "w", encoding="utf-8") as _f:
            _f.write(str(os.getpid()))
        return True
    except OSError:
        return True  # 锁写失败不阻塞启动

def _apply_window_icon(win):
    """给主窗口/任务栏设置 eazyVid 图标；ICO 缺失或设置失败时静默跳过。"""
    try:
        ico = os.path.join(SCRIPT_DIR, "ICO", "eazyVid.ico")
        if os.path.exists(ico):
            win.iconbitmap(ico)
    except Exception:
        pass

def main():
    lock_path = os.path.join(SCRIPT_DIR, "eazyvid.lock")
    if not _acquire_single_instance(lock_path):
        try:
            _r = tk.Tk()
            _r.withdraw()
            messagebox.showerror("eazyVid 已在运行",
                                 "检测到 eazyVid 已在运行中。\n请先关闭现有实例，再启动新的。", parent=_r)
            _r.destroy()
        except Exception:
            pass
        sys.exit(0)
    root = TkinterDnD.Tk() if _HAVE_DND else tk.Tk()
    _apply_window_icon(root)
    App(root)
    root.mainloop()

if __name__ == "__main__":
    main()

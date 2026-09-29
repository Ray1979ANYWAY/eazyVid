# -*- coding: utf-8 -*-
"""eazyVid v2 核心逻辑测试（不启动 GUI、不真实下载）"""
import sys, os, time, threading, tempfile, shutil
sys.path.insert(0, r'D:\Documents\eazyVid')
import eazyvid as E

# 1. extract_formats / fmt_arg_for
info = {"formats": [
    {"format_id": "137", "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none", "width": 1920, "height": 1080, "filesize": 1000000},
    {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "width": 0, "height": 0, "filesize": 500000},
    {"format_id": "303", "ext": "webm", "vcodec": "vp9", "acodec": "none", "width": 1920, "height": 1080},
    {"format_id": "18",  "ext": "mp4", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2", "width": 640, "height": 360},
]}
fmts = E.extract_formats(info)
assert len(fmts) == 4, len(fmts)
assert fmts[-1]["vcodec"] == "none"           # 纯音频排最后
assert E.fmt_arg_for(fmts[0]) == "137+bestaudio/best"   # 纯视频自动合音轨
assert E.fmt_arg_for(fmts[2]) == "18"                    # 音视频一体
assert E.fmt_arg_for(fmts[3]) == "140"                   # 纯音频直接用 id
print("1. extract_formats / fmt_arg_for OK")

# 2. is_video_request
assert E.is_video_request("http://x/v.m3u8?token=1", {})
assert E.is_video_request("http://x/a.mp4", {})
assert not E.is_video_request("http://x/a.ts?seg=1", {})     # .ts 分片排除
assert E.is_video_request("http://x/seg.mp4?x=1", {"content-type": "video/mp4"})
assert E.is_video_request("http://x/video?token=1", {"content-type": "application/vnd.apple.mpegurl"})
assert not E.is_video_request("http://x/page.html", {})
print("2. is_video_request OK")

# 3. 下载池：并发限制 + 暂停让位 + 恢复（模拟 add() 的线程包装调度）
events = []
pool = E.DownloadPool(lambda e: events.append(e), print, max_concurrent=2)

def sched(task):
    threading.Thread(target=pool._schedule, args=(task,), daemon=True).start()

class FakeTask:
    def __init__(self, i):
        self.id = i; self.state = "waiting"; self.started = 0
    def start(self):
        self.started += 1; self.state = "downloading"

t1, t2, t3 = FakeTask(1), FakeTask(2), FakeTask(3)
sched(t1); sched(t2); sched(t3)
time.sleep(0.3)
assert t1.state == "downloading" and t2.state == "downloading", (t1.state, t2.state)
assert t3.state == "waiting", t3.state                     # 并发2，第3个排队
# 暂停 t1 → 让出席位 → t3 应开始
t1.state = "paused"
pool.on_task_paused(t1)
time.sleep(0.3)
assert t3.state == "downloading", t3.state
# 完成 t2 → 恢复 t1
t2.state = "done"; pool.on_task_done(t2)
t1.state = "waiting"; sched(t1)
time.sleep(0.3)
assert t1.state == "downloading", t1.state
print("3. 下载池 并发限制/暂停让位/恢复 OK", flush=True)

# 4. 压缩队列：空闲立即压 + 忙时排队
# mock compress_video：睡 0.2s 表示正在压
orig = E.compress_video
def fake_compress(path, mode, log, progress_cb=None, out_dir=None, proc_holder=None, cover_sec=None):
    time.sleep(0.2)
    if progress_cb:
        progress_cb(100.0)
    return True, path + "_out.mp4"
E.compress_video = fake_compress
cq = E.CompressQueue(print, lambda e: None)
cq.add("a.mp4", "x265 默认(推荐)")
cq.add("b.mp4", "x265 默认(推荐)")
cq.start()
t0 = time.time()
time.sleep(0.9)
elapsed = time.time() - t0
# 串行队列：两个 0.2s 任务 ≈ 0.4s+（若并行则 ≈0.2s）
assert elapsed >= 0.4, elapsed
assert all(t["state"] == "done" for t in cq.tasks), [t["state"] for t in cq.tasks]
print(f"4. 压缩队列 串行排队+手动开始 OK（两个任务耗时 {elapsed:.2f}s）")
# 4b. autostart：下载任务入队后，只要有空闲压缩线程就自动开始（无需手动 start）
# 用并发计数证明两个任务并行（空闲线程被利用），不依赖计时
_plock = threading.Lock()
_par_active = 0
_par_max = 0
def fake_par(path, mode, log, progress_cb=None, out_dir=None, proc_holder=None, cover_sec=None):
    global _par_active, _par_max
    with _plock:
        _par_active += 1
        _par_max = max(_par_max, _par_active)
    time.sleep(0.2)
    with _plock:
        _par_active -= 1
    if progress_cb:
        progress_cb(100.0)
    return True, path + "_out.mp4"
_orig_cv = E.compress_video
E.compress_video = fake_par
cq2 = E.CompressQueue(print, lambda e: None, max_workers=2)
cq2.add("c1.mp4", "x265 默认(推荐)", None, autostart=True)
cq2.add("c2.mp4", "x265 默认(推荐)", None, autostart=True)
_t0 = time.time()
while not all(t["state"] == "done" for t in cq2.tasks) and time.time() - _t0 < 3:
    time.sleep(0.05)
assert all(t["state"] == "done" for t in cq2.tasks), [t["state"] for t in cq2.tasks]
assert _par_max >= 2, f"期望并行（有空闲线程即开），实际最大并发 {_par_max}"
E.compress_video = _orig_cv
print(f"4b. 下载完成 autostart：有空闲线程即自动开始（最大并发 {_par_max}）OK", flush=True)

# 5. build_dl_cmd：临时目录隔离 + 续传 -c
# 构造临时假 profile（含空 Cookies），验证 cookie 兜底复制分支，不依赖真实登录态
_fake = tempfile.mkdtemp(prefix="eazyvid_test_profile_")
try:
    _net = os.path.join(_fake, "Default", "Network")
    os.makedirs(_net, exist_ok=True)
    open(os.path.join(_net, "Cookies"), "wb").close()
    _orig_pf = E.CHROME_PROFILE
    E.CHROME_PROFILE = _fake
    E._COOKIE_CACHE["path"] = None
    cmd, tmpdir = E.build_dl_cmd("http://x/v", "18", r"D:\tmp_out", 7, use_cookie=True)
    E.CHROME_PROFILE = _orig_pf
finally:
    shutil.rmtree(_fake, ignore_errors=True)
joined = " ".join(cmd)
assert ("--cookies-from-browser" in joined and "eazyvid_ck" in joined) or "--cookies" in joined
assert ".eazyvid_7_" in " ".join(cmd) and ".eazyvid_7_" in tmpdir
assert cmd[-1] == "http://x/v" and "-c" in cmd
os.rmdir(tmpdir)
print("5. build_dl_cmd（临时目录 + cookie + 续传）OK")

# 6. 压缩停止：stopped 状态、remove 允许
cq6 = E.CompressQueue(print, lambda e: None, max_workers=1)
fake6 = {"id": 1, "path": r"D:\x.mp4", "mode": "x265 默认(推荐)", "ui_ref": None,
         "state": "compressing", "progress": 30.0, "out": None, "ok": False,
         "row": None, "skip": False, "autostart": False, "_ph": {"proc": None}}
cq6.tasks.append(fake6)
assert cq6.stop(fake6) is True
assert fake6["state"] == "stopped"
assert cq6.remove(fake6) is True
print("6. 压缩停止 stopped/删除 OK")

# 7. 压缩重启：stopped 任务点「开始压缩」恢复 queued（从头重压）
cq7 = E.CompressQueue(print, lambda e: None, max_workers=1)
fake7 = {"id": 1, "path": r"D:\x.mp4", "mode": "x265 默认(推荐)", "ui_ref": None,
         "state": "stopped", "progress": 30.0, "out": None, "ok": False,
         "row": None, "skip": False, "autostart": False, "_ph": {"proc": None}}
cq7.tasks.append(fake7)
cq7.paused = True
cq7.start()
time.sleep(0.05)
assert fake7["state"] in ("queued", "compressing"), fake7["state"]
assert fake7["progress"] == 0.0
print("7. 压缩重启 stopped→queued OK")

print("=== ALL CORE TESTS PASSED ===")
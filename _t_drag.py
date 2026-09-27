# -*- coding: utf-8 -*-
import sys, os, tempfile, types
sys.path.insert(0, r"D:\Documents\eazyVid")
sys.path.insert(0, os.path.join(r"D:\Documents\eazyVid", "vendor"))
import eazyvid as E
import tkinter as tk

# 真实文件路径（添加任务用）
td = tempfile.mkdtemp(prefix="ev_t_")
f1 = os.path.join(td, "a.mp4"); open(f1, "wb").write(b"\x00" * 100)
f2 = os.path.join(td, "b.mp4"); open(f2, "wb").write(b"\x00" * 100)

root = tk.Tk(); root.withdraw()
app = E.App(root)
app._show_page("cp")
app.cqueue.add(f1, "x265 默认(推荐)")
app.cqueue.add(f2, "x265 默认(推荐)")

rows = [t["row"] for t in app.cqueue.tasks]
assert len(rows) == 2, rows
r1 = rows[0]
# 场景：r1 设为 compressing（模拟正在压缩）
app.cqueue.tasks[0]["state"] = "compressing"
r1.refresh()

# 模拟：压缩中行上"单击"（ButtonPress → ButtonRelease）
from types import SimpleNamespace
press = SimpleNamespace(y=10, y_root=0)
r1._drag_start(press)
rel = SimpleNamespace(y=10, y_root=0)
r1._drag_end(rel)

# 断言：行还在布局中（winfo_ismapped / winfo_y 正常）
print("行1 ismapped:", r1.frame.winfo_ismapped(), "y:", r1.frame.winfo_y())
assert r1.frame.winfo_ismapped(), "压缩中行被点击后消失（bug 复现）"

# 再验证 queued 行的单击（非拖拽）也不消失
r2 = rows[1]
app.cqueue.tasks[1]["state"] = "queued"
r2.refresh()
r2._drag_start(SimpleNamespace(y=5, y_root=0))
r2._drag_end(SimpleNamespace(y=5, y_root=0))
print("行2 ismapped:", r2.frame.winfo_ismapped())
assert r2.frame.winfo_ismapped(), "queued 行被单击后消失"

root.destroy()
import shutil; shutil.rmtree(td, ignore_errors=True)
print("DRAG_CLICK_REG_OK")

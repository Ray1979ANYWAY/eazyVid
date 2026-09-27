# -*- coding: utf-8 -*-
"""eazyVid v2 GUI 冒烟测试：构建窗口、弹窗、捕获提示、下载池行"""
import sys, os
sys.path.insert(0, r'D:\Documents\eazyVid')
import tkinter as tk
import eazyvid as E

root = tk.Tk()
app = E.App(root)
root.update()

# 关键控件存在
for name in ("url_var", "fmt_tree", "pool", "cqueue", "_dl_btn", "_log_btn"):
    assert getattr(app, name) is not None, name
assert app._pool_inner is not None and app._pool_canvas is not None
print("1. UI 构建 OK", flush=True)

# 探测失败 → 弹提示窗
app._probe_failed(("http://x/video", "测试错误"))
root.update()
tops = [w for w in root.winfo_children() if isinstance(w, tk.Toplevel)]
assert tops, "未弹出提示窗"
assert "藏得比较深" in "".join(w.cget("text") or "" for w in tops[0].winfo_children() if isinstance(w, tk.Label))
print("2. 探测失败提示窗 OK", flush=True)

# 嗅探捕获 → 格式列表追加 + tooltip
app._on_capture_url("http://cdn/video.m3u8?token=1")
root.update()
assert len(app.captured) == 1, app.captured
items = app.fmt_tree.get_children()
assert items, "捕获行未加入格式列表"
assert len(app.fmt_tree.item(items[0], "values")) == 4, app.fmt_tree.item(items[0], "values")
print("3. 嗅探捕获入列表 + tooltip OK", flush=True)

# 下载池行组件（不触发真实下载）
t = E.DownloadTask("http://x/v", "18", r'D:\Documents\eazyVid', None, "测试任务", app.pool, 99)
row = E.TaskRow(app._pool_inner, t, app)
t.ui = row
row.refresh()
root.update()
assert t.ui is not None
assert "排队" in row.state_lbl.cget("text")
# 模拟下载中进度（total_known → 紧凑格式 已下/总）
t.state = "downloading"; t.progress = 42.5; t.size_str = "10.0MiB"; t.total_known = True
t.dl_bytes = 24117248; t._total_bytes = 84934656
row.refresh(); root.update()
assert "/" in row.pct.cget("text") and "M" in row.pct.cget("text")
assert str(row.pause_btn.cget("state")) == "normal"
# 模拟暂停
t.state = "paused"; row.refresh(); root.update()
assert str(row.resume_btn.cget("state")) == "normal"
# 模拟完成变灰
t.state = "done"; t.progress = 100; row.refresh(); root.update()
assert str(row.pause_btn.cget("state")) == "disabled"
assert str(row.mode_cb.cget("state")) == "disabled"
print("4. 下载池行 排队/进度/暂停/完成变灰 OK", flush=True)

# 压缩下拉菜单值
vals = row.mode_cb.cget("values")
assert vals[0] == "不压缩" and "x265 默认(推荐)" in vals and "NVENC 硬件加速" in vals, vals
print("5. 压缩下拉菜单 OK", flush=True)

# 日志抽屉
app._toggle_log(); root.update()
assert app.log_visible is True
assert app.log_text.winfo_manager() == "pack"
app._toggle_log(); root.update()
assert app.log_visible is False
print("6. 日志抽屉 OK", flush=True)

# 7. 压缩任务行：cqueued 事件 → 压缩页出现一行（回归：事件必须经 _ui_event_impl 创建行）
import tempfile
_fake = os.path.join(tempfile.gettempdir(), "eazyvid_smoke_c.mp4")
open(_fake, "w").close()
app.cqueue.add(_fake, "x265 默认(推荐)")
root.update()
_crows = app._cp_inner.winfo_children()
assert _crows, "压缩任务行未创建（cqueued 事件未处理）"
assert len(_crows) == 1, len(_crows)
print("7. 压缩任务行 cqueued → 压缩页显示 OK", flush=True)
os.remove(_fake)

# 8. 压缩行：压缩中 → 停止按钮显示 + 淡蓝底色 + 无进度条；stopped → 按钮隐藏可删
_fake2 = os.path.join(tempfile.gettempdir(), "eazyvid_smoke_d.mp4")
open(_fake2, "w").close()
app.cqueue.add(_fake2, "x265 默认(推荐)")
root.update()
_rec = app.cqueue.tasks[-1]
_row2 = _rec.get("row")
assert _row2 is not None
assert not hasattr(_row2, "bar"), "进度条应已移除"
_rec["state"] = "compressing"; _rec["progress"] = 42.0
_row2.refresh(); root.update()
assert _row2._cv.itemcget(_row2._win_stop, "state") == "normal", "压缩中停止按钮未显示"
assert str(_row2.del_btn.cget("state")) == "disabled"
assert str(_row2.mode_cb.cget("state")) == "disabled"
assert len(_row2._cv.find_withtag("bg")) == 2, "压缩中 canvas 应有灰底+淡蓝填充两矩形(背景层)"
assert "42%" in _row2._cv.itemcget(_row2._txt_pct, "text")
_rec["state"] = "stopped"
_row2.refresh(); root.update()
assert _row2._cv.itemcget(_row2._win_stop, "state") == "hidden", "stopped 停止按钮应隐藏"
assert str(_row2.del_btn.cget("state")) == "normal"
assert len(_row2._cv.find_withtag("bg")) == 0, "stopped 背景层应清空(文字/控件保留)"
os.remove(_fake2)
print("8. 压缩行 停止按钮/淡蓝底色/无进度条 OK", flush=True)

# 9. 压缩行信息：queued 显示原大小；done 显示 原→后(压缩比)；删除按钮为减号
_fake3 = os.path.join(tempfile.gettempdir(), "eazyvid_smoke_e.mp4")
with open(_fake3, "wb") as f:
    f.write(b"\x00" * (3 * 1024 * 1024))
app.cqueue.add(_fake3, "x265 默认(推荐)")
root.update()
_r3 = app.cqueue.tasks[-1]
_row3 = _r3.get("row")
assert _row3 is not None
assert _row3.del_btn.cget("text") == "−", "删除按钮应为减号"
assert "3.0MB" in _row3._cv.itemcget(_row3._txt_size, "text"), _row3._cv.itemcget(_row3._txt_size, "text")
_fake4 = os.path.join(tempfile.gettempdir(), "eazyvid_smoke_f.mp4")
with open(_fake4, "wb") as f:
    f.write(b"\x00" * (1024 * 1024))
_r3["state"] = "done"; _r3["out"] = _fake4
_row3.refresh(); root.update()
_txt = _row3._cv.itemcget(_row3._txt_size, "text")
assert "3.0MB" in _txt and "1.0MB" in _txt and "33%" in _txt, _txt
assert _row3._cv.itemcget(_row3._txt_pct, "text") == "", "done 行百分比应为空"
assert str(_row3.mode_cb.cget("state")) == "disabled"
os.remove(_fake3); os.remove(_fake4)
print("9. 压缩行信息 大小/压缩比/减号 OK", flush=True)

root.after(200, root.destroy)
root.mainloop()
print("=== GUI SMOKE PASSED ===", flush=True)
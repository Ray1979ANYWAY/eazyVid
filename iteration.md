# eazyVid 项目迭代记录（iteration.md）

> **2026-09-26 改名**：项目由 **ECOgrab** 正式更名为 **eazyVid**（本地文件夹 `D:\Documents\eazyVid`、GitHub 仓库 `Ray1979ANYWAY/eazyVid`、主程序 `eazyvid.py`、日志 `eazyvid.log`、嗅探 profile `.eazyvid_profile`、cookie 临时前缀 `eazyvid_ck_*`/`eazyvid_cookies_*`、下载临时目录 `.eazyvid_*`）。
> 改名原因：ECOgrab 无法从名字看出与视频下载/压缩相关；easyVDO 撞车泰语视频教育站（easyvdo.com）+ 大陆集团 VDO 汽车品牌；标准拼写 easyVid 撞车活跃 AI 视频平台（easyvid.app）与 EasyVid Video Converter；最终选定 **eazyVid**——eazy→easy 联想、vid→video 联想 100%，非标准拼写恰好避开全部撞名。**本日志此条之前的条目保留"ECOgrab"原名，如实反映当时历史。**

> 记录从项目建立到当前的全部思路过程与工作过程，供后续迭代回溯。

---

## 项目概述

**目标**：一个本地视频下载+压缩 GUI 工具。解决两个核心痛点：
1. 很多网站把视频封装起来，yt-dlp 直接探测不到，传统做法要用户去 F12 Network 手动找真实地址——体验差；
2. 下载的视频太大，需要无感衔接压缩。

**核心设计原则（用户明确偏好）**：
- 不让普通用户去 F12 手动找地址——程序打开时就能自动嗅探；
- 不装浏览器扩展（"又像 fewtype 一样，本地一个、Chrome 一个"，两套常驻，否决）；
- 不让用户重新登录（独立浏览器窗口没有登录态，太麻烦）；
- 本地程序做所有重活（探测/下载/压缩/管理），浏览器侧只保留最小入口。

**架构状态：未定型**（截至 2026-09-25）。下载/压缩 GUI 已可用；用户还在用 LosslessCut 做视频后期（剪切/合并/封面），不断发现新工具需求。整体架构（单一工具箱 GUI vs 保留独立小工具集）待用户想清楚后确定——新需求先记入本文件，不急于设计进现有 GUI。

**项目位置**：`D:\Documents\ECOgrab\`（用户切换的独立项目目录，含 yt-dlp/ffmpeg/ffprobe 工具集）

---

## 阶段一：需求澄清与方案确认

- **用户需求（原始）**：基于现有 download.bat 做 UI——粘贴 URL → 能探测则数字/鼠标选格式分辨率 → 探测不到则提示去网页刷新嗅探真实地址 → 点击下载后可选择是否排期压缩。
- **用户关键升级**：不要用户专业地 F12 找地址——"它刷新的时候，我们直接能够在程序打开的情况下嗅探到地址"。
- **方案调研结论**：
  - 系统代理抓包：HTTPS 必须装自签 CA 证书，有安全顾虑，否决；
  - CDP（Chrome DevTools Protocol）监听浏览器网络：独立调试窗口 + websocket-client，无需证书/代理，选定；
  - 用户确认完整流程（4 步）：
    1. 粘贴 URL → 探测成功列格式点选下载 / 失败提示打开嗅探窗口；
    2. 嗅探窗口正常播放 → 程序实时列捕获的视频流；
    3. 点选地址下载，下载开始可见体积，可直接勾选压缩、选压缩方式；
    4. 未勾选压缩 → 下载完弹窗询问；已勾选 → 下载完直接走压缩。

## 阶段二：首次实现（v1）

**环境确认**：Python310（pip 26.2.1）、tkinter OK、websocket-client 1.9.0 已装、ECOgrab 目录工具齐全。

**实现 `ecograb.py`（tkinter 桌面 GUI，单文件）**：
- 探测模块：`yt-dlp -J` → 解析 formats（分辨率/编码/大小），纯视频流自动 `id+bestaudio` 合并（避免无声视频）；
- 嗅探模块（CDP）：自动启动独立 Chrome（`--remote-debugging-port=9222` + 独立 profile）→ 新建标签页 → `Network.enable` 监听 → 按扩展名 + content-type 过滤视频流（m3u8/mp4/webm/mpd 等，排除 .ts 分片防刷屏）；
- 下载模块：yt-dlp `-f` 指定格式 + `--merge-output-format mp4`，实时解析进度与体积；
- 压缩模块：内嵌 ffmpeg（4 模式：x265 CRF24 默认 / CRF20 高画质 / CRF27 小体积 / NVENC 硬件加速），`-progress pipe:1` 解析百分比，音频 copy，输出 `_压缩.mp4`；
- 下载完自动衔接压缩（勾选）或弹窗询问（未勾选）。

**测试（全部通过）**：
- 逻辑单测：格式解析、音轨自动合并、视频流识别过滤；
- CDP 嗅探链路集成测试：本地起假 m3u8 视频站 → 嗅探窗口成功捕获地址；
- GUI 冒烟：窗口构建、元素齐全。

**交付**：`ecograb.py` + `ecograb.bat`（pythonw 无控制台启动）。

## 阶段三：嗅探体验迭代——"不要重新登录"

**用户反馈**：嗅探会打开新的 Chrome，用户已登录的网站（视频站/YouTube）在新窗口要重新登录，太麻烦；希望在自己浏览器里 F5 就捕获。

**排查过程**：
- 方案 A（重启用户浏览器带调试端口）：Chrome 153 起禁止"默认登录资料开调试端口"（安全收紧），**不可行**；
- 方案 B（浏览器扩展）：已实现（manifest v3 + background.js），但**用户否决**——"不能再装扩展了，又像 fewtype 一样，本地一个、Chrome 一个"；
- 方案 C（书签小工具 bookmarklet）：**选定**。零扩展、零权限、无常驻，收藏栏一个按钮，视频页点一下 → 播放/F5 → 捕获。

**书签方案实现**：
- 本地接收服务：`127.0.0.1:8899/capture`（POST 视频地址，带 CORS 头）；
- `安装书签.html`：拖拽按钮到收藏栏即可（不用复制代码）；
- 书签原理：注入脚本轮询 `performance.getEntriesByType('resource')` 60 秒，匹配视频扩展名 → POST 到本地程序；
- 下载增加「用浏览器Cookie下载(Chrome)」选项（`--cookies-from-browser chrome`）：嗅探窗口没登录也能用登录态下载；
- 保留「开始嗅探」作兜底。

**测试（通过）**：模拟书签 POST → 捕获通道 PASS；GUI 冒烟 OK。

## 阶段四：真实场景实测与问题修复

**用户实测 Reddit 页面未捕获** → 用 CDP 实测该页面：
- 结论：**未登录的独立 profile 打开 Reddit 直接被反爬拦截**（"You've been blocked by network security"），只加载空壳页面，无视频请求——CDP 测试环境无法复现用户已登录页面；
- 判断书签未捕获的候选原因：视频未播放（Reddit 懒加载）/ YouTube 嵌入（googlevideo 地址无扩展名）/ 书签未装好。

**书签升级**：
- 支持 googlevideo/videoplayback（YouTube 无扩展名视频流）；
- 监听结束 alert 汇报"捕获到 N 个视频地址"（0 则提示确认已播放/刷新）。

**窗口问题修复**：
- 用户报告"点探测格式跳出新窗口"——实为 pythonw 无窗口运行时，yt-dlp/ffmpeg 子进程被 Windows 开了黑色命令行窗口；
- 修复：所有子进程调用（探测/下载/压缩/ffprobe）加 `CREATE_NO_WINDOW`，全程无感。

**用户截图确认**：嗅探窗口显示 Reddit blocked 页——确认嗅探窗口方案对反爬站点天然受限，书签（用户已登录浏览器）是正确主路径。

---

## 当前状态与待办

**文件清单**：
- `ecograb.py` — 主程序（GUI + 探测 + CDP 嗅探 + 下载 + 压缩 + 8899 接收服务）
- `ecograb.bat` — 启动器（pythonw 无控制台）
- `安装书签.html` — 书签安装页（拖到收藏栏）
- `download.py` / `compress.py` / `yt-dlp.exe` / `ffmpeg.exe` / `ffprobe.exe` — 原有工具集

**用户待实测**（工具本身已就绪）：
1. ECOgrab 直接「探测格式」这个 Reddit URL（yt-dlp 有 Reddit 解析器，可能直接成功，无需嗅探）；
2. 若探测失败：日常 Chrome（已登录）→ 先播放视频 → 点「ECOgrab 捕获」书签 → 回程序捕获列表下载。

**已知边界（如实记录）**：
- 书签只认带 `.m3u8/.mp4/.webm/.mpd` 等特征或 googlevideo 的视频地址；
- 不带任何特征的动态流地址（极少）书签抓不到，需 CDP 兜底；
- CDP 独立窗口对反爬站点（如 Reddit）会被拦截，仅作最后兜底；
- 压缩依赖本地 ffmpeg，浏览器侧不可能替代（这是保持"纯本地"架构的根本原因）。

## 阶段六：下载页交互与 UI 定稿（架构未定，待实现）

**核心体验目标（用户反复强调）**：用户不需要分辨"探测 vs 嗅探"、不需要 F12、不需要书签、不需要点多余按钮。

**探测失败自动嗅探流程（定稿）**：
1. 粘贴 URL → 点「探测」；
2. 成功 → 格式列表；
3. 失败 → 弹提示窗"视频文件藏得比较深，需要你在我们的窗口再点击一次播放"；
4. 用户确认 → 提示窗变为播放窗口（程序自己的 Chrome，CDP 监听，自动打开该 URL）；
5. 需要登录的网站用户自行登录（profile 持久化，以后免登录）；很多网站无需登录；
6. 用户点击播放 → 嗅探到视频文件 → 弹 tooltip"回到主窗口下载"；
7. 一分钟无动作 → 提示再点一次探测。

**下载池（定稿）**：
- 上半区格式列表：显示分辨率/格式，保留 AV1/VP9 ⚠ 兼容性提示；**鼠标悬停行 → 该行出现「下载」按钮**；
- 下载池每任务一行：文件名/进度/**压缩下拉菜单**（不压缩/x265默认/x265高画质/x265小体积/NVENC）；
- 多任务**并行下载**吃满带宽；可**暂停/恢复**（yt-dlp -c 断点续传）以实现优先级调整；
- 下载完成行**变灰**（下载环节结束），压缩交给压缩页面：选过模式的自动入压缩队列（空闲立即压/忙则排队）；选"不压缩"的可去压缩页手动转；
- 日志保留作 debug，做成**抽屉式**（可折叠，如 fewtype 风格），最终版去掉。

**待确认细节**：压缩页面 UI 逻辑（用户晚点定）；格式列表是否合并音视频自动处理（沿用 v1 逻辑）。

### 阶段六实现（v2，2026-09-26）

**已完成重构 `ecograb.py` → v2**（v1 备份为 `ecograb_v1.py`）：
- **自动嗅探**：探测失败 → 弹提示窗"视频文件藏得比较深，需要你在我们的窗口再点击一次播放" → 确认后启动程序自己的 Chrome（CDP）并自动打开该 URL → 60 秒无捕获自动提示"再点一次探测"；
- **捕获通知**：嗅探到视频 → 格式列表区顶部追加"嗅探·类型"行 + 3.5 秒 tooltip"已捕获视频文件，请回到主窗口点「下载」"；
- **格式列表**：探测结果按 分辨率/格式ID/编码/大小/来源 列展示，保留 ⚠（AV1/VP9）提示；**鼠标悬停行 → 行尾浮出「⬇下载」按钮**（tkinter 浮动控件实现）；
- **下载池**：每任务一行（名称/进度条/百分比/状态/暂停/继续/压缩下拉）；**并行 3 个吃满带宽**（Semaphore 调度）；暂停=终止 yt-dlp 进程（-c 保留 .part），恢复=重跑续传；每任务独立临时目录 `.ecograb_<id>` 隔离并发文件，完成后移出；**完成变灰**（控件全 disabled）；
- **压缩队列**：下载完成且选了压缩模式 → 自动入队（单 worker 串行：空闲立即压/忙排队），行内状态显示"压缩中 x%"；
- **日志抽屉**：可折叠（▸/▾），保留作 debug；
- 保留：`用浏览器Cookie下载` 全局勾选、8899 书签通道（备用）。

**测试（全部通过）**：
- 语法 py_compile OK；核心逻辑单测 5 组 PASS（格式解析/嗅探过滤/下载池并发-暂停让位-恢复/压缩队列串行排队/命令构造）；
- GUI 冒烟 6 组 PASS（UI 构建/失败提示窗/捕获入列表+tooltip/行组件状态流转/压缩下拉/日志抽屉）；
- 待用户实测：真实 URL 探测、真实嗅探、多任务并行下载、暂停/恢复续传、下载完自动压缩衔接。

**测试脚本**：`test_v2.py`（核心逻辑）、`smoke_v2.py`（GUI 冒烟），保留可回归。

## 关键经验备忘

- **pythonw + subprocess**：子进程必须 `CREATE_NO_WINDOW`，否则弹命令行窗口；
- **Chrome 新版**：默认 profile 不能开调试端口，独立 profile 又无登录态且易被反爬拦截——所以"嗅探用户已登录页面"只能靠页面内脚本（书签）转交地址；
- **bookmarklet 局限**：`performance` 只记录已加载资源、只按 URL 判断（拿不到响应头），YouTube 等无扩展名流需特征匹配；
- **架构结论**：压缩/探测/下载全是本地强项、浏览器侧做不到，故"本地程序 + 浏览器最小入口"是唯一平衡点；纯扩展不可行（沙箱无法调本地 exe）。

### 阶段七：YouTube 探测修复（2026-09-26）
**现象**：真实 YouTube 视频探测失败；嗅探窗口登录后播放 60 秒无捕获；download.bat 同样失败。
**诊断（逐层排除）**：
1. yt-dlp 报 "No supported JavaScript runtime" → YouTube 新版提取需要 JS runtime（deno）
2. 显式 --js-runtimes deno 后警告消失，但仍 "This video is unavailable"
3. 换 tv/android_vr 客户端 → 依旧 "Sign in to confirm you're not a bot" → **节点 IP 被 YouTube 风控**（数据中心/共享 IP 未登录必拦）
4. `--cookies-from-browser chrome` 报 "Could not copy Chrome cookie database"（issue 7271：Chrome 运行中锁库 + 新版加密）
**修复**：
1. 下载 deno 2.9.7 → `D:\Documents\ECOgrab\deno.exe`（.gitignore 排除，不推送）
2. 全局配置 `%APPDATA%\yt-dlp\config`：`--js-runtimes deno:D:/Documents/ECOgrab/deno.exe`（**注意：config 文件里反斜杠会被 yt-dlp 吃掉，必须用正斜杠**）→ 所有 yt-dlp 调用自动生效
3. **cookie 通道**：ECOgrab 嗅探浏览器 `.chrome_profile` 登录 YouTube 后，`--cookies-from-browser chrome:<profile路径>` 可绕过 bot 风控（实测 ytsearch1 完整列出 144p-1080p）
4. 代码集成：`ecograb.py` 新增 `cookie_args()`（探测/下载自动带）；`download.py` 同步
5. `is_video_request` 补 googlevideo/videoplayback 特征兜底（YouTube 无扩展名流）
**验证**：download.py 探测 ytsearch1:hello 成功（全格式列表）；test_v2.py 5 组全 PASS（断言同步更新）
**遗留**：IP 被风控时未登录仍可能拦截 → 换干净节点（日/新/住宅 IP）；嗅探窗口登录态需保持；用户主 Chrome 的 cookie 通道（7271）未解，靠 .chrome_profile 绕开


## 阶段八：下载/性能/稳定性调试（2026-09-26 下午）

### 坑 1：删除任务后 yt-dlp 还在下载（孤儿进程）
**现象**：删除下载中任务后流速仍有 1~2MB/s；"暂停后过一会儿失败"。
**根因**：yt-dlp.exe 是 pyinstaller onefile 双进程架构（bootloader 父进程 + 真正下载的子进程）。`terminate()` 只杀父进程，子进程变孤儿继续下载；`.part` 被占用导致 rmtree 也失败。
**修复**：`_kill_proc_tree()` 用 `taskkill /PID /T /F` 杀整个进程树（删除/暂停都走它），杀完 wait 回收再删 tmpdir。实测系统里曾有 2 个孤儿 yt-dlp 进程，已清。
**洞见**：Windows 上 terminate() 对打包型 exe 不可靠，杀进程一律杀树。

### 坑 2：GUI 卡顿（下载后随机卡、删了还占 CPU）——两次误判
**误判 A**：怀疑下载完自动压缩（ffmpeg）吃 CPU——**用户实测没选压缩、CPU<40%，排除**。
**误判 B**：怀疑 cookie CDP 同步阻塞——只解决"点下载那一瞬间"，下载后仍卡。
**真凶（多因素叠加）**：嗅探 Chrome（普通优先级）一直开着 + yt-dlp 子进程普通优先级抢 UI + 孤儿进程残留。
**为什么脚本不卡**：download.py 无 GUI 主线程（没有"界面卡"概念）、无嗅探 Chrome；yt-dlp 下载本身是网络/IO 型，CPU 很低。GUI 卡 = 界面线程被普通优先级子进程抢占 + 多余 Chrome 进程。
**修复**：所有子进程统一 `BELOW_NORMAL_PRIORITY_CLASS`（0x4000）：嗅探 Chrome、yt-dlp 下载、探测/-J、预探测、HLS 解析、HEAD、压缩 ffmpeg。
**洞见**：GUI 应用里凡是有可能长期运行的子进程（下载/解码/压缩）一律降优先级；用户侧再配合下载目录加 Defender 排除 + 用完关嗅探窗。

### 坑 3：下载进度从 50% 起跳
**根因**：临时目录 `.ecograb_{task_id}` 的 task_id 是进程内递增序号，**重启后从 1 重置** → 新任务复用旧残留目录（上次中断的 .part 500MB）→ yt-dlp `-c` 续传 → 从 50% 开始。
**修复**：tmpdir 加进程号 `.ecograb_{task_id}_{pid}`；启动时清理超过 10 分钟的 `.ecograb_*` 残留（排除当前 pid）。

### 坑 4：清晰度遍历"碰运气"（mat6tube）
**现象**：有时 4 档全抓到，有时丢档。
**根因**：`setCurrentQuality` 首档（240，低→高顺序第一个）调用时机太早（播放器刚就绪）抛异常，而 `idx+1` 在 try 之前 → 档位被永久跳过（3/4 次丢 240）。
**修复**：失败重试同档最多 2 次，成功才推进。实测 13:28 稳定 240→360→480→720 全抓。
**洞见**：JW Player `getQualityLevels()` 返回顺序 = 高→低；`setCurrentQuality(0)`（最高档）因 JW 视其为"当前档位"不触发重新拉流（UI 标记 720 active，实际 CDP 拉 480 = 带宽自适应）——**切换必须低→高**，最高档最后请求必拉流。

### 坑 5：cookie CDP 同步阻塞主线程
**现象**：点下载卡一阵、最小化恢复黑屏（主线程无法重绘）。
**根因**：`cookie_args()` 的 CDP `Network.getAllCookies` 同步等 Chrome 响应 1~2s，在 DownloadTask.start（主线程）调用。
**修复**：`_COOKIE_CACHE` 缓存 120s——探测/预探测的后台线程已取过，下载启动直接命中。
**洞见**：一切可能阻塞主线程的外部调用（CDP/网络）要么后台化，要么缓存。

### 坑 6：tooltip 位置
主窗口 tooltip 对"回主窗口下载"的提醒无意义 → 改为 CDP `Runtime.evaluate` 注入播放页 DOM（右上角浮动条，6 秒自动消失），注入失败才兜底主窗口。

### 坑 7：测试断言鲁棒性
嗅探 Chrome 正开着锁 `.chrome_profile` 时，测试环境的 cookie 副本复制会失败 → cookie 断言改为容忍 CDP 或副本任一路径。

### 其它
- 提示窗口（"视频文件藏得比较深"）定位到主窗口正中间。
- git push 曾失败（schannel SSL/TLS，exit 128）：本地 commit 全部安全，网络恢复后补推。


### 验证（用户实测 2026-09-26 下午）
- 统一 BELOW_NORMAL + taskkill 杀进程树后：**界面不再卡顿**（"对，没那么卡了"）——坑 1/坑 2 闭环。
- 累积 commit（进程树修复、全子进程降优先级、iteration.md 阶段八）已推送 GitHub（eb1c693..8709e89）。
- 遗留观察：网络不稳定期 git push 会 SSL/RPC 中断，本地 commit 安全，恢复后补推即可。

## 2026-09-26 OK.ru 嗅探根因闭环（站点墙，非嗅探 bug）

### 证据链（16:03 会话，42 秒）
- 播放轮询（每 3 秒 Runtime.evaluate 查 video 元素）：**全程 nov，video 从未存在**
- Network：**无一条 m3u8/.ts/.mp4/分片**，只有 videoPreview 封面图（ct=image/webp，video=False 判定正确）
- type=36/37 是同一视频多张预览图轮换——用户看到的"播放"= 封面轮换 + 播放器 UI（进度条可拖但无数据流）
- 对照：本地 HLS 测试（hls_site）22 个 m3u8/ts 事件全捕获 → 嗅探器捕获能力无问题

### 根因
OK.ru 游客会话（无 cookie 同意/未登录）**不初始化播放器**：无 video 标签、无视频流请求（bu 实测：点击视频区域弹 cookie 同意框 + 登录引导）。嗅探窗口 .eazyvid_profile 是全新游客态 → 永远抓不到。

### 洞见
1. **"视频在动"≠ 视频在播**：封面轮换/UI 交互会造成假象。诊断必须查 video 元素本身（currentTime 前进）+ Network 请求双证据，不能靠用户观察。
2. **先连后导航是正确架构**（连接 CDP + Network.enable 后再 Page.navigate）——确保页面加载期所有媒体请求在监听内，自动加载快的站点也能捕获。
3. **站点墙的处理**：播放窗口登录一次（登录态入 profile）；或 m3u8 直链粘贴下载兜底。
4. **诊断工具沉淀**：嗅探VIDEO 播放轮询（Runtime.evaluate）+ DBG content-type 判定日志——后续站点问题直接复用。

### 待办
- DBG 日志 + 播放轮询为诊断代码，OK.ru 登录验证成功后移除/收敛
- 播放窗口的登录引导可以更明显（弹窗明确提示"站点若弹 cookie/登录框请先处理"）
---

## 2026-09-27 设置弹窗（第一批）

**需求**：齿轮 ⚙ 打开设置弹窗，逐项加入设置；下载面板"下载到"行去掉；默认下载目录改为安装根目录 downloaded；压缩输出目录支持"同目录/指定"两选项，默认同目录。

**实现**：
1. **设置弹窗 `_open_settings`**（Toplevel 模态）：视频下载目录（Entry+浏览）、压缩输出目录（Radiobutton 同目录/指定 + Entry+浏览，指定时才可编辑）、确定/取消。确定时：校验目录（不存在自动创建）→ 保存全部 → 更新 `cqueue.out_dir` → 关闭并记日志。
2. **下载面板**：删除"下载到:"行（drow 整块），`dl_dir_var` 改在下载页顶部创建（值从 `_load_dl_dir()` 初始化，trace 保存仍保留）。
3. **默认下载目录**：`_load_dl_dir` 默认 `SCRIPT_DIR/downloaded`（不存在自动创建）；`_save_dl_dir` 改为读全量配置再更新 `download_dir`（不再覆盖其他设置键）。
4. **压缩输出目录**：`compress_video` 加 `out_dir` 参数（None=同目录；指定则 makedirs + 输出到该目录，文件名保持 `<原名>_压缩.mp4`）；`CompressQueue` 加 `out_dir` 属性，worker 每次压缩读取；设置持久化到 `eazyvid_settings.json`（`compress_mode`/`compress_dir` 键，默认 same/""）。两条入队路径（下载完成自动入队 + 手动添加）统一生效。
5. **顺带加固**：新增 `_safe_compress_video` 包装（压缩异常不再让 worker 线程崩溃、队列卡死）；`compress_video` 恢复完整实现并加 `_probe_duration`（ffmpeg -i 解析总时长 → 进度百分比 `out_time_us / duration`）。

**教训**：PowerShell 多行 here-string 在部分场景换行不一致导致 `Contains` 失配 → 高风险替换改用行号定位；`self.tasks = []` 多类共用 → 必须限定 class 范围内定位；数组字面量不允许尾随逗号。

**验证**：py_compile ✓ / test_v2 ALL PASS / smoke GUI SMOKE PASSED / downloaded 目录已自动创建。

### 2026-09-27 设置记忆与兜底（补充）
- 两个目录均"记住上一次"（持久化 `eazyvid_settings.json`）；**第一次开启/无历史**：下载目录=程序目录 `downloaded`（自动创建），压缩输出=与源文件同目录（same）。
- **失效兜底**：加载时若压缩模式为"指定"但目录为空或不存在 → 自动回退"同目录"；保存时同样校验，指定目录无效则弹提示并回退 same，避免保存 custom+"" 坏状态。下载目录失效同理回退 downloaded。
- 验证：无历史→same/downloaded ✓；失效指定→回退 same ✓；有效指定→记住并应用 out_dir ✓；回归全绿。

### 2026-09-27 所有弹窗主面板中心对齐
- 新增 `App._center_window(win, w, h)`：以主面板 `winfo_rootx/y + width/height` 计算中心，弹窗 `geometry(f"{w}x{h}+{x}+{y}")` 对齐（支持副屏负坐标）。
- 应用范围：**设置弹窗**（560x260）、**"需要你播放一次"提醒窗**（480x210，原内联居中逻辑收敛到统一方法）、**嗅探播放 Chrome 窗口**（Sniffer 增加 root 引用，启动加 `--window-position` 按主面板中心定位 960x720 假设尺寸）。
- **系统 messagebox**：全部补 `parent=self.root`（Windows 下系统弹窗自动居中于父窗口）——共补 5 处（未捕获到视频/未粘贴 URL/嗅探启动错误/URL 为空等）。
- 验证：py_compile ✓ / test_v2 ✓ / smoke ✓ / 所有 messagebox 均带 parent。

### 2026-09-27 压缩面板"添加文件夹"
- 压缩页"添加视频…"旁新增"添加文件夹…"（`_pick_compress_dir`）：`askdirectory` → **`os.walk` 递归扫描（目录穿透）**所有视频扩展名（mp4/mkv/avi/mov/flv/wmv/webm/ts/m4v/mpg/mpeg/3gp/m2ts/vob）→ 找到数量确认（askyesno）→ 逐个入队（默认 x265）。
- **去重**：已在队列中的文件（按路径小写）跳过，日志报告 找到/新入队/已在队列 三个数。
- 初始目录：优先上次压缩输出目录，否则 downloaded。
- 验证：py_compile ✓ / test_v2 ✓ / smoke ✓。
- 教训：又出现 PowerShell 数组范围替换吞方法体（`$lines[0..($i-1)] + block + $lines[($j-1)..]` 中 $i 为 def 行导致 body 范围被跳过）——恢复 body 后修正为在方法结束后插入。

### 2026-09-27 下载池行交互（双击/右键）
- 下载池**文件名**标签新增交互：**双击**——任务已完成（done）且有文件 → 系统默认播放器打开；未完成无反应。**右键**——弹出菜单：已完成的「打开」+ 始终可用的「打开所在文件夹」；未完成只有「打开所在文件夹」。
- 辅助函数 `_os_open`/`_os_reveal`（跨平台）：Windows 用 `os.startfile`/`explorer /select,`（打开所在文件夹并选中文件）；macOS 用 `open`/`open -R`。
- 未完成/文件不存在时"打开所在文件夹"回退为打开下载目录本身。
- 验证：py_compile ✓ / test_v2 ✓ / smoke ✓。

### 2026-09-27 下载池文件名交互（双击/右键）
- **已下载完成**：双击文件名 → 系统默认播放器打开；右键菜单 →「打开」/「打开所在文件夹」（explorer /select 选中成品）。
- **未下载完**：双击无反应；右键 →「打开所在文件夹」——定位到实际下载临时目录（`task.tmpdir`）并**选中 .part 文件**（无 part 则打开目录），不再只是打开 out_dir 父目录。
- 复用已有 `_os_open`（跨平台 os.startfile/open）与 `_os_reveal`（存在则 /select 选中、否则打开目录）。
- 验证：py_compile ✓ / test_v2 ✓ / smoke ✓。

### 2026-09-27 探测任务防重入（重复点击作废上一轮）
- 新增 `self._probe_seq` 版本号：每次点「探测格式」`seq += 1`，同时 **`_halt_probes()` 杀掉上一轮后台 yt-dlp 探测进程** + **`sniffer.stop()` 停止嗅探会话**（播放窗口保留、由用户自行关闭）。
- `_probe_worker(url, seq)` / `_probe_hls(url, ph, seq)`：每步完成（-J/-F 探测、HLS 展开、probe_fail）都检查 `seq != self._probe_seq` → 直接丢弃，避免旧结果覆盖新任务。
- 验证：py_compile ✓ / test_v2 ✓ / smoke ✓ / 作废、杀进程、停嗅探、结果丢弃均确认。

### 2026-09-27 粘贴自动提取 URL
- URL 输入框拦截 Ctrl+V / <<Paste>> / 右键粘贴 → 从混杂分享文本（抖音/微博文案+表情+链接）正则提取第一个 URL 填入，清空原有内容。
- 正则：`https?://[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+`（遇到中文/空格/表情即停；尾部 `#` 清理）。
- 提取不到 URL（普通文本）→ 原样粘贴，不破坏。
- 验证：5 组提取用例全过（抖音/YouTube/带参+中文/纯URL/无URL）+ py_compile ✓ + test_v2 ✓ + smoke ✓。

### 2026-09-27 粘贴提取修复 Markdown 链接
- 用户从豆包/聊天记录复制的是 `[URL](URL)` Markdown 格式 → 原正则把 `](` 吞进 URL（结果 `.../](https://...)`）。
- 修复：优先匹配 `](` + URL（Markdown 真实目标）→ 取其后链接；URL 字符集移除 `()`（防吞 Markdown 括号）。普通分享文本仍取第一个 URL。
- 7 组用例全过（Markdown双URL/Markdown标题/抖音/B站/带参+中文/纯URL/无URL）+ 编译 ✓ + test_v2 ✓ + smoke ✓。

### 2026-09-27 抖音 cookie 新鲜度：探测自动用实时 cookie 重试
- 现象：抖音短链直探报 `Fresh cookies needed`（访客 cookie 过期即可触发）；嗅探窗口访问过页面后 cookie 变新，第三次直探直接成功。
- 修复：`cookie_args(force=False)` 加 force 参数（跳过 120s 缓存强制重取：优先嗅探 Chrome CDP 实时 cookie，兜底复制 profile）；`probe_url`/`probe_formats_f` 加 force_cookie；`_probe_worker` 在 -J 报 cookie 错误时自动 `probe_url(force_cookie=True)` 重试一次。
- 踩坑：行号替换两次越界（cookie_args 注释写进 return 行、_probe_worker 跳过 fmts 分支、fmts2 重复），均现场修复；编译 ✓ / test_v2 ✓ / smoke ✓ / 结构断言全过。


### 2026-09-27 压缩面板：任务队列（置顶/拖动优先级/行内模式）+ 并发数设置
- 需求：① 压缩任务一文件一行、压缩中永远最上、未压缩可拖动调优先级、设置里可设同时压缩进程数；② 顶栏加默认压缩模式下拉 + 开始压缩按钮；添加文件夹的任务用默认模式（下载面板拉来的保持用户已选）；任务行最右模式下拉（未压缩前可改）。
- CompressQueue 重写：paused=True（手动开始）、max_workers、_lock、_workers、_start_workers()、start()、add 只排队、remove 仅 queued/done/failed、move(from,to) 移动优先级；新事件 ("cstarted", rec)。
- _worker 并发上限：锁内数 compressing 数 < max_workers 才取任务（设置调小后多余 worker 不再并行抢）。
- 设置弹窗：新增「同时压缩数」输入框（validate=key + isdigit，只接受阿拉伯数字），ok() 保存 max_workers 并应用；_load/_save_compress_settings 读写 max_workers 键。
- 压缩页顶栏：默认模式 Combobox（手动添加用此模式）+「开始压缩」按钮（_cq_start → cqueue.start()）。
- CompressRow：模式下拉移到最右（done 禁用 / compressing 模式+删除都禁用 / queued+failed 可改）；按住行拖到目标行松开 → move + 重排，压缩中行固定锁顶（dst=max(dst, active)）。
- App 新方法 _reorder_compress_active_top（压缩中提到最前、其余保序）+ _relayout_compress_rows（按 tasks 顺序 repack）；_poll_queue 事件分支 cqueued/cstarted/cprogress/cdone 触发刷新与重排。
- 踩坑记录：
  1. PowerShell 单引号数组里 `\` 转义会直接解析失败（`\'`）→ 改用 here-string @'...'@ 承载 Python 代码块，稳定通过。
  2. _poll_queue 分支替换时把 `except queue.Empty:` 吞掉 → py_compile 报 L2153 SyntaxError；恢复文件头污染（$j=null 切片 $lines[0..-1] 把 main()/except 插到文件头）+ 补回 except 后编译通过。
  3. cptop 块替换用 $s+6 跳过原第 7 行 → cpf 定义被吞（smoke 报 cpf NameError），补回。
  4. 事件块替换跳过 except 行后 pass 裸挂 + self.root.after 出 try（同样 L2153 报错）→ 修复后编译 ✓。
  5. test_v2 旧 API：`cq.q.empty()` / 空闲立即压 → 改手动 start（cq.start()）+ all(done) 断言；worker 唤醒延迟 0.3s 吃掉 0.55s 计时 → sleep 放宽 0.9s。
- 回归：test_v2 ALL CORE TESTS PASSED ✓ / smoke_v2 GUI SMOKE PASSED ✓ / py_compile ✓。


### 2026-09-27 压缩队列：下载完成的任务自动开始（有线程空着就开）
- 需求修正：不是"队列空闲才自动开始"，而是"只要有空闲压缩线程（正在压的 < 并发上限）就直接开始"——用户设置了 5 线程、当前只压 2 个时，新下载任务也能直接开压。
- CompressQueue.add() 加 autostart 参数（rec 记录 "autostart" 标记）；入队后 running（compressing 数）< max_workers → self.start()（打开闸门，worker 自动取 queued 继续压）。
- 下载完成自动入队处改为 add(..., autostart=True)。
- 手动添加（添加视频/文件夹）不带 autostart → 仍按原逻辑：队列从未开始时需点「开始压缩」。
- 测试 4b 重写：用并发计数器（fake_par 记录最大同时压缩数）验证 max_workers=2 下两个 autostart 任务并行（最大并发 2），不依赖计时（首版计时写错：sleep 时长恒等于 elapsed，已弃）。
- 回归：test_v2 ALL CORE TESTS PASSED ✓（4b 最大并发 2）/ smoke_v2 ✓ / py_compile ✓。


### 2026-09-27 修复：压缩报 `压缩异常：'vc'`（添加视频压不了）
- 用户反馈"添加不了视频"：日志定位真相——添加成功（已入队），但点开始压缩后 `[17:37:51] 压缩异常：'vc'`，任务失败。
- 根因：eazyvid.py 的 COMPRESS_MODES 结构是 {codec, params, desc}，而 compress_video 却按 {vc, crf, preset, tag, ac} 取值 → m["vc"] 抛 KeyError。GUI 里压缩函数自始就是坏的；脚本版 compress.py 正常（此前压缩全靠脚本）。
- 修复：重写 eazyvid.py 的 compress_video，与 compress.py 逻辑对齐：
  - `-map 0:v:0 -map 0:a?`（只取视频流+可选音频流）
  - 低码率音频（aac/mp3/ac3/eac3 ≤192k）原样复制零损失，否则转 AAC 192k
  - NVENC 按源视频码率 50% 设目标码率（保证有实际压缩效果）
  - 10bit 色深检测（pix_fmt 含 10le/12le/p010/p012）：x265 加 yuv420p10le；NVENC 自动改软件 x265
  - NVENC 编码失败自动降级软件 x265 重试
  - 一次 ffprobe 取 duration/pix_fmt/音频编码码率（_probe_duration 兜底）
- 验证：ffmpeg 生成 3 秒测试视频 → x265 压缩成功（进度回调 0→100%）/ NVENC 模式压缩成功；test_v2 ALL PASSED / smoke_v2 PASSED / py_compile ✓；测试文件已清理。


### 2026-09-27 修复：添加视频后压缩任务列表不显示（事件处理缺失）
- 现象：新版修复 'vc' 后，日志显示"已添加 1 个文件到压缩队列"，但压缩页任务列表空。
- 根因：CompressQueue 的 on_event 绑的是 self._ui_event（L1681），压缩事件 ("cqueued"/"cstarted"/"cprogress"/"cdone") 直接走 _ui_event_impl；而 _ui_event_impl 只有下载池分支（added/progress/paused/done），没有压缩分支 → cqueued 被静默丢弃，行永不创建。_poll_queue 里的压缩分支是死代码（压缩事件根本不进 self.q）。
- 修复：_ui_event_impl 增加 cqueued/cstarted/cprogress/cdone 分支（创建/刷新 CompressRow、cqueued/cstarted/cdone 时 _reorder+_relayout、cdone 打日志），与 _poll_queue 分支逻辑一致。
- 补测试：smoke_v2 新增测试 7——cqueue.add 后 root.update()，断言 _cp_inner 出现 1 个压缩任务行（回归保护此事件路径）。
- 回归：smoke_v2 7 项全过（含新增）/ test_v2 ALL CORE TESTS PASSED / py_compile ✓。


### 2026-09-27 退出清理：任务进行中 → 警告弹窗 + 杀进程树
- 需求：开始任务后关闭程序，ffmpeg 不被中断。有任务进行（下载/压缩）时退出应清零所有进行中进程，并给警告弹窗。
- 实现：
  - compress_video 增加 proc_holder 参数（dict）；_run 里 Popen 后立即 `proc_holder["proc"] = proc`（ffmpeg 进程可追溯）；_safe_compress_video 透传；CompressQueue._worker 调用时传 `rec["_ph"]` 容器。
  - _on_exit 重写：① 统计进行中任务（下载中 proc 存活 + 压缩中 rec）；有则 messagebox.askyesno 确认（显示下载/压缩数量），取消则 return 不退出；② 逐一对下载任务 _kill_proc_tree(yt-dlp，taskkill /T /F 连 ffmpeg 合并子进程一起杀)；③ 对压缩中任务取 rec["_ph"]["proc"] _kill_proc_tree(ffmpeg)；④ 原有嗅探 Chrome 清理 + 删 lock + os._exit。
  - 下载任务的 proc 早已在 DownloadTask.proc 上（暂停/退出共用 _kill_proc_tree）。
- 踩坑：proc_holder 记录行第一次插错位置（匹配到 DownloadTask 的 yt-dlp Popen，L860）导致缩进语法错误；第二次插入 Popen 多行参数中间（L1176）破坏参数列表。正确做法：Popen 是 `proc = subprocess.Popen(cmd, ...多行...creationflags=NO_WINDOW | 0x00004000)` 多行调用，记录行必须插在 creationflags 行之后。用 `^            proc = subprocess.Popen\(cmd`（12 空格缩进）定位 compress 的 Popen 而非下载的。
- 验证：60s testsrc2 真实视频压缩中 0.8s 检查 rec proc 已记录且在跑（poll=None）；_kill_proc_tree 后 ffmpeg 结束（poll=1）。test_v2 的 fake_compress/fake_par 补 proc_holder 参数（_safe 现在传 6 参）→ ALL CORE TESTS PASSED / smoke_v2 PASSED。


### 2026-09-27 压缩行改造：停止按钮 + 百分比进度 + 淡蓝底色
- 需求：压缩中的任务行要有停止按钮（弹窗警告不能从断点继续压缩）；压缩中的行不要进度条，只要百分比；视觉进度用行底色变化（30% 透明度淡蓝）。
- 实现：
  - CompressRow：移除 ttk.Progressbar；name/pct/state_lbl 从 ttk.Label 换 tk.Label（可设 bg）；frame 换 tk.Frame；布局改 grid（停止按钮 grid_remove 隐藏/恢复不重排）；压缩中行底色 = ROW_BG_ACTIVE #D9E9F8（30% 淡蓝效果），其余 = ROW_BG #F0F0F0。
  - 停止按钮：仅 compressing 显示；点击 → askyesno("停止后无法从断点继续压缩，需要重新添加该视频再从头压缩") → cqueue.stop(rec)。
  - CompressQueue.stop(rec)：仅 compressing 可停；标记 state="stopped"；_kill_proc_tree(rec["_ph"]["proc"]) 杀 ffmpeg；删除可能已生成的不完整输出（out_dir/原名_压缩.mp4）。
  - _worker：压缩返回后 `if rec.get("state") != "stopped"` 才置 done/failed（用户停止不被覆盖）；stopped 不占压缩线程（active 只统计 compressing）。
  - remove 支持 stopped（可删）；refresh 状态映射加 stopped=已停止；cdone 日志 stopped 时打"压缩已停止"。
- 回归：test_v2 测试 6（stop→stopped→remove 允许）+ smoke 测试 8（压缩中停止按钮 grid 显示/淡蓝底色/无进度条；stopped 按钮隐藏可删）全绿。


### 2026-09-27 压缩行信息布局：大小/压缩比/终止/减号
- 需求：完成行显示 原大小+压缩后大小+压缩比；进行中行显示 原大小+执行进度%+模式灰+终止按钮+减号删除；未开始行显示 原大小+模式可选+减号删除。
- 实现：
  - CompressRow 布局改 grid 7 列：文件名 | size_lbl(大小信息) | pct(百分比) | state_lbl(状态) | 终止按钮(压缩中显) | 减号删除(−) | 模式下拉。
  - 新增模块函数 _fmt_size（GB/MB/KB/B）；refresh 里 os.path.getsize 取原文件大小；done 且 out 存在 → "原 → 压缩后 (压缩比%)"；其余 → 只显示原大小。
  - pct 仅 compressing 显示百分比，其余空；state_lbl 显示 排队/压缩中/完成/失败/已停止。
  - stop_btn 文案"停止"→"终止"；del_btn 文案"删除"→"−"（减号，width=2）。
  - 状态与按钮联动保持：compressing 模式/删除禁用 + 终止显示；done 模式灰删除可用；queued/failed/stopped 模式可选删除可用。
- 踩坑：行号替换时把新 refresh 一起删掉（Select-String 匹配到第 2 个 refresh 实际是新方法），重新插入修复；编译通过但运行时缺 refresh 会崩，靠 Grep 结构校验兜住。
- 回归：smoke 测试 9（queued 原大小 3.0MB / done 3.0MB→1.0MB(33%) / 减号文本 / done 百分比空 / done 模式灰）通过；test_v2 + smoke 全绿。


### 2026-09-27 视觉进度改填充式 + 终止后重压修复
- 需求：底色进度 = 灰底 + 淡蓝按百分比从左往右填充（50% 时淡蓝到行中间，100% 正好到删除按钮右边缘）；终止后点开始压缩应从头重压，且终止时删除残留的部分输出文件。
- 实现：
  - CompressRow 加垫底 Canvas（place 铺满 frame，grid 控件在其上；canvas 也绑拖动事件）：压缩中画灰底矩形 + 淡蓝矩形宽 = del_btn 右边缘 x * progress；非压缩清空 canvas。去掉"整行变淡蓝"逻辑（label bg 固定灰）。
  - CompressQueue.start()：把 stopped 任务恢复为 queued（progress 归零、out/ok 清空），发 cqueued 事件刷新行，再起 worker——终止后点「开始压缩」从头重压。
  - stop() 删除残留强化：候选输出 = 精确路径（out_dir/原名_压缩.mp4）+ rec["out"]，逐候选重试 3 次（taskkill 后文件短暂锁定则等 0.2s）。
- 踩坑：tk.Canvas.lower() 是 item 方法（需 tagOrId 参数），无参调用报 wrong # args → 删掉（canvas 先 place 自然垫底）；插入 canvas 时光标匹配 `frame.pack(fill="x"...` 撞到 TaskRow（下载池行也有 frame.pack）→ 改为按 `tk.Frame(parent, bg=ROW_BG)` 精确定位 CompressRow。
- 回归：test_v2 测试 7（start 后 stopped→queued、progress 归零）+ 真实验证 STOP_DELETE_OK（stop 后残留 _压缩.mp4 被删）+ smoke 8 断言改 canvas 矩形（压缩中 2 个、stopped 0 个）全绿。


### 2026-09-27 整行底色进度 + 右侧控件组对齐
- 问题：进度底色只占行中间一条（canvas 固定 28px 高 < 行高），上下露出 frame 灰 = "上下两条杠"；且 100% 蓝条不到删除按钮（right 在布局未稳定时取值）。
- 修复：
  - canvas 高度实时同步：frame 绑 <Configure> → _sync_cv 同步 height 并重绘；绘制逻辑抽成 _paint_cv（灰底矩形铺满整行 + 淡蓝 = del_btn 右缘 * progress/100），refresh 和 Configure 都调它——布局稳定后 right 才准确。
  - 进度归一化 bug：progress 是 0-100 百分制，之前 min(max(p,0),1) 把 50% 直接 clamp 成 100%；改为 p/100.0。
  - 布局右对齐：grid 加伸缩列（column 2 weight=1），pct/state_lbl/终止/del/mode_cb 移到 column 3-7 → 任务状态、删除按钮、压缩模式下拉整体贴面板右边。
- 验证（GUI 实测）：行高=canvas 高（27px，铺满）；100% 蓝右缘 519 = del_btn 右缘 519（精确）；50% 蓝右缘 259≈260；mode_cb 右缘 658 ≈ 行宽 660（贴右）。test_v2/smoke_v2 全绿。


### 2026-09-27 压缩行 canvas 单层化（整行底色） + 进度实时回调
- 问题三连：①字段(Label)灰底盖住进度色 → "整个底色都变色"做不到；②canvas place 不撑 frame 请求尺寸 → 行宽塌缩 1px；③text 模式管道缓冲 → 进度回调全部积压到进程结束（"1% 卡很久突然完成"）。
- 修复：
  - 进度：ffmpeg Popen 改 bufsize=0 + 二进制 + readline 逐行 decode —— out_time_us 实时触发 progress_cb（不再 text 模式缓冲）。
  - 行结构重写为 canvas 单层：行根 = Canvas（pack fill=x 宽度跟随面板，不再套 Frame+place）；文件名/大小/百分比/状态全部 create_text 画在 canvas 上（随进度底色走，无灰块遮挡）；终止/删除/模式下拉 create_window 嵌入（按钮自带底色，位于行右侧，进度 100% 才到删除按钮）；背景矩形 tags="bg" 隔离删除。
  - 右对齐：_layout 从右往左排 mode_cb→del_btn→终止(显示时)→状态文字→百分比；coords 移动 create_window 后必须 update_idletasks 再读 winfo（否则 right 用的是旧坐标）。
- 真实验证：10s 720p → x265 压缩 35 次进度采样、轨迹 1%→99% 平滑、最大单步跳变 4%（REAL_PROGRESS_OK）；行高=canvas 高、100% 蓝右缘=删除按钮右缘(231)、50%=115、模式下拉贴右(差6)、停止后 bg 矩形清空；smoke 断言改查 tags="bg"/itemcget，test_v2+smoke_v2 全绿。


### 2026-09-27 压缩无收益预检（码率阈值）+ 压后校验兜底
- 现象：用户下载的 VP9 视频（Video by endy.fun.mp4，720x1280@30fps，视频码率 1045kbps，3.5MB）经 x265 CRF24 压缩后变成 6.75MB（2066kbps）——CRF 是质量目标模式，不看源码率，对低码率源必然输出更高码率。
- 修复（双层）：
  - 压前预检：ffprobe 读源视频码率 v_br（format.bit_rate 与 video stream 取较大）；v_br ≤ 2000kbps 直接返回 (True, None) 跳过（≈VP9/AV1 高度压缩场景，秒回不费编码时间）。
  - 压后兜底：输出大小 > 输入 → 删除输出、保留原文件、返回 (True, None)。
  - worker 三态：ok+out → done；ok+out None → skipped（"已跳过"）；失败 → failed。行状态文案/按钮：skipped 同 done（模式禁用、删除可用）。
- 验证：真实样本预检返回 (True, None)、无新文件产生、原文件保留；test_v2/smoke_v2 全绿。用户旧残留 `Video by endy.fun_压缩.mp4`（6.75MB）为压坏产物，可手动删除。
- 补充：skipped 行状态文案改为"收益小已终止"（预检与压后兜底统一语义），skipped 时模式禁用、删除可用；顺带修复此前 skipped 键缺失会显示英文 "skipped" 的问题。实测 SKIP_LABEL_OK。


### 2026-09-27 压缩行排序改为三组
- 需求：结束态永远最上 → 压缩中 → 排队（之前是压缩中最上、其余保序）。
- 实现：_reorder_compress_active_top 重写为 _reorder_compress_rows——按 grp() 稳定排序：组0 = done/stopped/skipped/failed（结束态）、组1 = compressing、组2 = queued；组内保持加入顺序。拖动锁定区同步改为"非 queued 行不可拖"（结束态+压缩中）。
- 验证：7 态混合序列 reorder 后 = done,stopped,skipped,failed → compressing → queued,queued；锁定 5 行；test_v2/smoke_v2 全绿。


### 2026-09-27 删除语义统一
- 需求：结束态删除键=只移出列表（保留压缩输出文件）；执行态删除键=移出列表并删除文件（未完成输出），与停止按钮共用同一确认弹窗。
- 实现：_confirm_stop() 抽出共用弹窗（_on_stop 与 _on_delete 都调）；_on_delete 对 compressing：确认→stop()（杀进程+删残留）→remove()→destroy；结束态/排队：仅 remove。remove() 允许列表补 "skipped"（此前 skipped 行删不掉）。
- 验证：执行态删除后任务移出列表、残留 _压缩.mp4 被删；done 删除后输出文件保留；skipped 可删；test_v2/smoke_v2 全绿。
- 修复：删除按钮与下拉重叠——_layout 原用 winfo_width()（新行首帧控件未布局时=1），改为 winfo_reqwidth()（请求宽度，创建即可用）；实测 3 行删除按钮[右缘231] 与下拉[左缘237] 间隙 6px 无重叠。


### 2026-09-27 压缩开始后文件名空白（z-order 修复）
- 根因：_paint_cv 的灰底/蓝底背景矩形在 __init__ 的文字 create_text 之后创建（canvas 后创建者在上层）→ 压缩一开始背景矩形盖住整行文字，文件名看起来"变空白"。此前验证只查坐标未查绘制层级。
- 修复：create_rectangle 后调 canvas.tag_lower("bg")，背景矩形垫到最底层（文字/窗口在其上）。
- 验证：z-order 实测 bg index 0 < name 2 < state 5；文件名文本保持；test_v2/smoke_v2 全绿。


### 2026-09-27 下载池加实时速度显示
- 需求：下载状态旁显示下载速度。
- 实现：DownloadTask 加 speed 属性；[download] 行正则扩展 ` at ([\d.]+(?:MiB|GiB|KiB|B)/s)`（兼容 `of ~ 1.20GiB` 的 ~ 后空格）；TaskRow 在状态列后插 speed_lbl（下载中显示、暂停/完成/失败清空）。
- 验证：4 种 yt-dlp 进度行样例解析全过（PARSE_OK）；test_v2/smoke_v2 全绿。
- 修复：速度未显示——yt-dlp 用列对齐多空格（`at    1.91MiB/s`、`of   34.46MiB`），原正则只允许单空格导致不匹配。本地起 HTTP 服务实测真实输出（34.46MiB 测试文件限速 2M 下载）后放宽为 `\s+`；`at Unknown B/s`（起始行）正确跳过不更新速度。6 种真实/历史格式全过。
- 格式紧凑化：pct 列改「已下/总」（23M/81M，total_known 时），速度列改缩写（803K/S、1.9M/S）；新增 _fmt_sz/_fmt_speed（模块级）；列宽 pct 11、speed 9 防溢出。smoke 断言同步更新。
- 插曲：两次用行数组索引插入函数时 _unit 行（方法内缩进）Select-String 匹配失败导致文件头部污染，均以"丢弃污染头恢复原内容"修复；教训——本文件用字符串 Replace 锚点操作，行号/索引操作前必须确认匹配命中。
- 单位自动换算补齐：速度增加 G/S 级（1.5GiB/s → 1.5G/S）、M/S ≥10 显示整数（20M/S）；大小已支持 G（1.2G）。边界单测 8 组速度 + 5 组大小全过。
- 百分比显示：进度条正中叠加 bar_pct（place relx=0.5/rely=0.5），pct 列保留 23M/81M；实测 bar 与 pct 中心差 ≤1px。
- 进度条断裂修复：百分比由不透明 Label 叠层改为 Canvas 自绘进度条（trough+蓝色进度+create_text 居中，文字无底色），进度条全程连续；顺带移除排队时的"摆锤"动画（排队=空条0%）。验证 42%→进度宽55px、文字中心(65,9)、100%满条。
- 下载行右对齐：状态/速度/暂停/继续/模式/删除 整组 pack(side="right") 从右往左（先 pack 最靠右），随面板拉伸自适应贴右、不叠加；左组 name/bar/pct 保持。验证 900→1200px：右边距恒定 2px、state 左缘 489→721 右移。


### 2026-09-27 下载进度"100%后反复10%~100%"+疑似重复下载
- 根因：YouTube 等视频的高清格式是分离流（fmt_arg_for 对 video-only 输出 "137+bestaudio/best"）→ yt-dlp 先下视频流（进度 10→100），再下音频流（进度又从 10% 重走）→ 进度行直接赋值导致进度条反复；用户误判为下载两遍/覆盖任务。最终仍是合并成一个文件。
- 修复：1) 进度行解析改为只涨不跌（多流时音频段不再覆盖进度，平滑到 100%）；2) start() 加防重入（已有进程在跑则返回，杜绝同任务双进程）。
- 验证：模拟 视频10→100+音频10→100+合并 进度序列单调 [10.2,55,100,100,100,100,100]；test_v2/smoke_v2 全绿。
### 2026-09-27 压缩进度单位修复（"0% 不走但 CPU 拉满"）
- 根因：compress_video 进度回调传 0~1（min(1.0, us/duration)），worker 原样存 rec["progress"]，而 CompressRow 渲染按 0~100（/100 归一化、f"{p:.0f}%"）——单位不匹配，任何进度都显示 0%（0.15 被当 0.15%）。实测老友记.mkv duration=1453s 正常、ffmpeg -progress 输出正常，纯 UI 单位 bug（此前验证只测回调序列未测显示层）。
- 修复：worker prog 存 min(100, p*100)；UI 层验证 0.37→37%、0.62→62%、1.0→100%。当前正在跑的旧进程压缩不受影响（编码正常、进度显示仍 0%，重启后新任务正常）。




### 2026-09-27 压缩任务列表行：双击打开 / 右键菜单
- 文件名双击=打开视频（done 打开输出文件，其余结束态打开原文件；执行态双击无动作）；文件名右键菜单：结束态=打开/打开所在文件夹，执行态=打开所在文件夹（仅当文件存在）。事件用 bbox 命中判定（可测）。
- 验证：done 双击→打开输出、bbox 外不触发、done 右键=[打开,打开所在文件夹]、执行态右键=[打开所在文件夹]。


### 2026-09-27 压缩执行态行：预计剩余时间（ETA）
- 需求：百分比与压缩状态之间显示预计剩余时间；并发线程增减会影响压缩速度，需持续监测、跟随速度波动。
- 估算标准：ffmpeg out_time_us 进度 0~1 回调 → worker 每次采样 (单调时间, 0~100 进度)；滑动窗口内 Δ进度/Δ时间=压缩速度（%/s）；ETA=剩余进度/速度——不用文件大小/码率（不反映编码实际速度）。
- 实现：_estimate_eta 模块级函数（窗口=最近 15 秒时间为主 + 30 点上限，对速度突变有一定跟随；采样 <3s 或进展 <0.2% 不估显示 "--"）；worker prog 每次回调采样并写 rec["eta"]；_fmt_eta 显示自适应（约N秒/约N分/约N时M分）；CompressRow 新建 _txt_eta 文字（布局 pct<eta<state），refresh 仅压缩中显示、其余清空。
- 阈值迭代：初版 1% 阈值 + 10 点/20s 窗口 → 慢速大文件（0.5%/20s 级，如 1080p x265 24 分钟片源）在 3% 时窗口进展 <1% 永远显示 "--"；改 0.2% 阈值 + 15s 时间窗为主。
- 验证：2%/s→40s、降速 1%/s→约50s（窗口反映后段速度）、慢速 0.028%/s → 3.05% 时 ETA≈3462s（约58分）、布局 pct<eta<state、非执行态隐藏。test_v2/smoke_v2 全绿。

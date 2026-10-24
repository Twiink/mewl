# Mewl

<p align="center">
	<img src="logo.png" alt="Mewl logo" width="300" height="300" />
</p>


Mewl 是一个本地运维仪表盘，用于在同一个工作区内管理运行中的服务、监听的端口、快捷生命周期操作以及主机负载压力。

`1.0.0` 版本是 Mewl 首个面向 Linux 就绪的发行版本，交付了 Electron 桌面外壳、实时运行时桥接、托管服务工作流、专属的日志工作区、监控界面以及 Linux 安装包输出。

## 截图

### 概览

![Mewl 概览仪表盘](screenshots/Screenshot1.png)

### 进程

![Mewl 进程工作区](screenshots/Screenshot2.png)

### 托管

![Mewl 托管服务工作区](screenshots/Screenshot3.png)

### 日志

![Mewl 日志工作区](screenshots/Screenshot4.png)


![Mewl 日志工作区](screenshots/Screenshot5.png)

### 端口

![Mewl 端口工作区](screenshots/Screenshot6.png)

### 监控

![Mewl 监控趋势画布](screenshots/Screenshot7.png)

![Mewl 监控资源占用](screenshots/Screenshot8.png)

## 它能做什么

- 搜索由服务、worker、工具和数据进程组成的托管本地运行时
- 通过紧凑的顶部命令栏扫描实时工作区
- 浏览更清爽的实时「进程」页面，聚焦当前正在运行的进程，提供可展开的卡片和只读检查器
- 让较长的进程名、描述、命令和工作目录路径在展开的进程卡片内自动换行，而不是溢出卡片边缘
- 将观测到的实时进程转换为经审核的托管服务草稿（预填命令和运行时提示），确认后才保存进服务目录
- 使用明确标注的「仅观测」终止操作：只结束当前实时 pid，不会改动托管服务列表
- 使用专属的「托管」工作区浏览两列服务卡片网格，再打开聚焦的弹窗来创建、编辑、配色和控制用户自定义的服务定义
- 直接在每个托管服务卡片上切换 `autostart` 和 `watch ports`，而不是把这些控件放在单独的自动化页面
- 通过托管卡片上的紧凑图标操作启动、停止和重启托管服务，而不是把控制按钮混入实时进程列表
- 在进程页面折叠辅助子进程噪音，让基于 Chromium 和 Electron 的应用以单个应用级行呈现，而不是一堆 zygote 和 utility worker
- 跨刷新持久化工作区状态，包括当前视图、筛选条件、侧边栏状态、选中进程、展开的卡片、告警以及托管服务开关状态
- 使用更简洁的概览仪表盘，包含摘要卡片以及并排的进程与端口预览
- 通过 `See all` 操作从仪表盘预览跳转到专属的「进程」和「端口」页面
- 以可展开的三列卡片浏览进程页面，完整检查器显示在下方
- 通过实时托管运行时桥接检查每个进程的 stdout 和 stderr 尾部输出
- 在桌面外壳中运行时，通过 Electron preload 桥接加载实时进程、监听端口和主机遥测数据
- 通过配置驱动的 Electron 生命周期桥接启动、停止和重启 Mewl 自有的服务
- 保存托管服务时包含明确的启动命令、可选的停止和重启命令、工作目录、备注、颜色和卡片图标
- 以明确的 `command`、`script` 或 `docker` 模式编写托管服务，让编辑器诚实标注每种流程，而不是把所有启动都当成同一种通用命令
- 通过 Electron 桥接直接启动脚本路径（如 `./scripts/dev.sh` 或 `./workers/boot.py`），无需先用 shell 胶水包装
- 让 Docker 托管服务走 Docker 专属的启动、停止和重启流程；未保存明确停止流程时，会为常见的 Compose 和命名容器启动推导停止命令
- 审查从旧版 `mewl.services.json` 结构导入的托管服务条目，查看其被归一化的原因，并在托管弹窗编辑器中标记为已清理
- 为每个服务选择带重试上限的重启策略，让 Mewl 能在异常退出后恢复托管服务
- 在 UI 中更新托管的 `autostart` 和 `watch ports` 设置，并持久化回 `mewl.services.json`
- 查看持久化的自动化历史流，涵盖启动、停止、配置档运行、重试与失败
- 使用专属的 `Logs` 工作区，在一条统一的诊断流中跟踪托管 stdout/stderr、自动化历史、告警快照以及带标签的 Mewl 内部运行时事件
- 在日志页面的 `All`、`Mewl`、`Processes`、`Containers` 和 `System` 标签页之间切换，让内部诊断、托管运行时输出、Docker 输出和 Linux 主机日志可以分开查看，同时不丢失统一信息流
- 当 Mewl 能从保存的启动命令推导出 `docker logs` 或 `docker compose logs` 目标时，将 Docker 容器日志拉入日志工作区
- 通过 Electron 运行时代理中基于 journald 的系统源，将 Linux 主机日志拉入日志工作区
- 按搜索文本、严重级别和来源筛选日志流；支持暂停 UI 消费、最新条目置顶固定（滚离实时边缘后解除）、清空本地视图，以及把当前窗口导出为换行分隔的 JSON
- 需要收窄当前事件流时，按严重级别、服务和时间窗口筛选告警托盘
- 捕获更丰富的运行时问题，包括崩溃循环、预留端口被错误进程占用，以及托管服务异常的 CPU 或内存飙升
- 从监控页面读取 CPU、内存、磁盘、网络和 GPU 的滚动趋势图，而不是只看到单次快照的压力条
- 使用更清爽的监控布局：全宽趋势画布、更宽的快照栏、2×2 噪音服务网格，以及嵌入网格的运行时波形磁贴，而不是一根高耸的堆叠监控列
- 通过加固的 Electron 运行器启动托管服务：明确的环境变量继承、命令分词、PATH 解析和预留端口防护
- 重新挂接主机上已在运行的孤儿托管服务，让生命周期操作能干净地收回并控制它们
- 把误提升的辅助进程归一化回单个托管条目，避免对子进程反复点击 `Manage` 在保存的配置中产生令人困惑的重复项
- 直接从 `public/icon.png` 生成 Linux 打包图标，并通过同一条 Electron 打包流程产出 AppImage、`.deb` 和 `.rpm`
- 查看带暴露、冲突和受监绑定状态的端口注册表
- 从侧边栏和监控视图跟踪主机 CPU、内存、磁盘、网络和 GPU 压力
- 工作区运行时加载期间，通过加载中、空态和错误状态优雅恢复
- 运行时加载经由一个要求 Electron 桌面桥接的 provider 层
- 需要更多主工作区空间时收起侧边栏
- 使用专属的 Vite 开发端口 `29463`，而不是默认的 `5173`

## 技术栈

- React 19
- TypeScript
- Vite 8
- Tailwind CSS 4
- lucide-react
- consola
- Electron Builder
- Astro 6
- Starlight

## 当前现状

`1.0.0` 是 Mewl 首个真正的发行线：Linux 桌面交付、托管服务控制、统一诊断、主机监控，以及观测（Observed）与托管（Managed）的运行时分离均已就位。

- UI 现在只通过实时 Electron 桌面桥接进行初始化加载，并从本地存储恢复已保存的工作区偏好。
- 运行时加载经由 [`src/runtime/provider.ts`](src/runtime/provider.ts)，它现在要求 Electron 主机桥接，而不是暴露浏览器回退。
- 生命周期操作、自动化开关、启动配置、托管服务日志以及新的统一日志流，现在都通过实时 Electron 运行时往返通信。
- Electron 被选为原生桥接的主机集成层，因为它让渲染层、preload 契约和运行时编排保持在同一套 TypeScript 技术栈中。
- 托管进程启动、实时端口发现和主机遥测现在都通过 Electron preload 桥接运行，进程页面专注于实时检查，托管页面负责已保存服务的控制。
- 托管服务配置现在存放在每用户的应用配置文件中，而不是仓库里，打包的 Electron 构建可以继续使用相同的设置位置。
- 托管服务现在是明确的已保存定义，带有启动命令加上可选的停止和重启命令，而不是从进程页面推断提升。
- 托管服务现在还带有明确的模式（`command`、`script` 或 `docker`），让编辑器、保存的 schema 和运行时停止行为与用户实际想要的启动类型一致。
- 旧版托管服务条目现在可以在托管工作区中显示清理原因，让旧的配置结构在应用内被审查，而不是被静默重写且无人跟进。
- 托管服务现在可以选择重启策略（`manual`、`on-failure` 或 `always`），并为当前桌面会话设置有界的重试上限。
- 直接脚本路径启动现在通过解释器感知的运行时处理来解析，支持 `.sh`、`.bash`、`.zsh`、`.py`、`.js`、`.cjs` 和 `.mjs` 等常见脚本类型。
- Docker 托管服务现在在编辑器中使用 Docker 优先的命令标签；当服务定义把停止留空时，常见的 `docker compose up ...` 或命名 `docker run ...` 启动可以推导出匹配的停止流程。
- 观测进程现在可以通过明确的审核步骤进入托管编辑器，而不是被静默提升直接写入已保存配置。
- 实时进程页面现在只暴露两个观测进程操作：从 Mewl 当前看到的内容创建托管草稿，或结束实时 pid 而不改动托管目录。
- 告警托盘现在支持筛选，并使用更丰富的运行时元数据，可以指向特定服务、时间窗口和告警类别，而不是保持为平面信息流。
- 监控页面现在通过 Electron 桥接维护滚动的内存采样缓冲区，并在渲染层静默刷新，让趋势图表感觉是活的，而不是装饰。
- 监控页面现在使用横向带状布局而不是左侧高耸的分栏，Runtime Pulse 波形填满趋势画布的开放槽位，而不是移入侧边栏。
- 当前工作区表面现在在视图或运行时状态变化时干净地重新挂载，修复了偶发的监控卡片残影问题——即过期的端口内容有时可能残留在趋势画布中。
- 概览的 `Running Now` 预览卡片现在强制标题块收缩并正确换行，长命令字符串保持在卡片内部，而不是溢出到工作区。
- 托管页面现在让工作区专注于两列服务网格，创建和编辑操作打开弹窗，而不是在屏幕上固定一整列编辑器。
- 旧的独立自动化页面已被折叠，服务级的 `autostart` 和 `watch ports` 设置现在直接放在托管卡片上。
- 托管卡片开关的帮助说明现在放在悬停提示中，而不是占用每张卡片的持久空间。
- Linux 桌面打包现在通过 `electron-builder` 接通，包含生成的图标资源和用于 AppImage、`.deb`、`.rpm` 的打包命令。
- 现在有一个用于 Linux 包构建和产物上传的手动 GitHub Actions 工作流，而 Windows 打包在运行时桥接本身跨平台之前有意不在范围内。
- Linux 打包现在通过 `--publish never` 强制 `electron-builder` 进入仅本地输出模式，CI 产物构建不再需要 GitHub token。
- 发行版 README 现在包含概览、进程、托管、端口和监控工作区的真实产品截图。
- 仓库现在还包含一个独立的 Starlight 文档站点，位于 [`docs/`](docs)，视觉风格贴近应用的深色玻璃、点阵网格和玫瑰色强调，并使用同一套截图展示关键工作流。

## 本地运行

```bash
npm install
npm run dev:desktop
```

开发服务器现在运行在：

```text
http://127.0.0.1:29463
```

生产构建：

```bash
npm run build
```

预览生产构建：

```bash
npm run preview
```

针对实时主机桥接运行 Electron 桌面外壳：

```bash
npm run dev:desktop
```

开发阶段的 Electron 流程现在把 Vite 显式绑定到 `127.0.0.1:29463`，让桌面外壳和开发服务器解析到同一个回环地址。如果你在开发中看到 Electron 的不安全 CSP 警告，这是 Vite 开发服务器的预期行为，并不是白屏窗口的原因。
在 `npm run dev:desktop` 中关闭 Mewl 主窗口现在会退出 Electron 进程，而不是留下一个脱离的、带 DevTools 的会话在后台运行，配对的 Vite 服务器也会被干净释放。

以全新渲染层构建运行生产风格的 Electron 外壳：

```bash
npm run desktop
```

`npm run desktop` 现在会在启动前重新构建 Vite 渲染层，生产包输出相对资源路径，Electron 可以通过 `file://` 加载 `dist/index.html` 而不会白屏。

构建 Linux 桌面安装包：

```bash
npm run package:linux
```

该打包流程会从 [`public/icon.png`](public/icon.png) 重新生成图标、重建渲染层，并将 AppImage、`.deb`、`.rpm` 产物输出到 `release/`。

`1.0.0` 版本预期的 Linux 产物名称：

- `release/Mewl-1.0.0-x86_64.AppImage`
- `release/mewl_1.0.0_amd64.deb`
- `release/mewl-1.0.0.x86_64.rpm`

`1.0.0` 直接下载链接：

- [AppImage](https://pub-2634147a32ee4044bd80cbdd0918010c.r2.dev/Mewl-1.0.0-x86_64.AppImage)
- [RPM](https://pub-2634147a32ee4044bd80cbdd0918010c.r2.dev/mewl-1.0.0.x86_64.rpm)
- [DEB](https://pub-2634147a32ee4044bd80cbdd0918010c.r2.dev/mewl_1.0.0_amd64.deb)

托管桌面服务存储在每用户的配置文件中：

- Linux：`~/.config/mewl/mewl.services.json`
- macOS：`~/Library/Application Support/mewl/mewl.services.json`
- Windows：`%APPDATA%\\mewl\\mewl.services.json`

[`mewl.services.json`](mewl.services.json) 的仓库副本现在是一个空基线，而不是预置的假服务列表。
Mewl 只对每用户配置中列出的服务执行生命周期控制，其他发现的主机进程在实时进程页面保持只读。
这些托管服务现在驱动托管工作区编辑器和 Electron 自动化规则，所以 UI 编辑的是真实的桌面配置，而不是仅本地的状态。
同一文件中的配置档可以通过自动化页面成组启动或静默服务，已启用的启动配置会在 Electron 运行时加载时应用。
托管服务启动刻意保持严格：Mewl 把普通命令字符串分词为可执行文件加参数的形式，只继承明确列出的环境变量，并在预留端口已被占用时阻止启动。

## 文档站点

仓库现在在 [`docs/`](docs) 附带一个独立的文档应用，使用 Astro 和 Starlight 构建。

本地运行：

```bash
npm run docs:dev
```

构建：

```bash
npm run docs:build
```

预览生产文档构建：

```bash
npm run docs:preview
```

部署文档到 Cloudflare Pages：

```bash
npm run docs:deploy
```

文档站点复用 `docs/public/` 中的 Mewl logo 和 favicon，包含 `docs/public/screenshots/` 下的应用截图，内容从以下部分开始：

- 品牌化的启动页首页
- 面向安装包下载的安装指南，指向已发布的 Linux 产物和 GitHub 发布页
- 更清晰的「Mewl 是什么？」产品说明和桌面工作流指南
- 覆盖概览、进程、托管、日志、端口和监控的工作区导览
- 托管服务和诊断指南

仓库的忽略规则现在也明确排除文档侧的生成状态，如 `docs/dist`、`docs/.astro`、Wrangler 本地文件和文档本地 env 文件，让新的文档工作流在 Git 中保持干净。

## 项目结构

```text
.
|-- .github/
|   `-- workflows/
|       `-- linux-packages.yml
|-- build/
|   `-- icons/
|       |-- icon.ico
|       |-- icon.png
|       `-- png/
|-- public/
|   |-- favicon.png
|   `-- icon.png
|-- scripts/
|   `-- generate-icons.mjs
|-- src/
|   |-- components/
|   |   `-- ui.tsx
|   |-- data/
|   |   `-- runtime.ts
|   |-- runtime/
|   |   |-- index.ts
|   |   `-- provider.ts
|   |-- App.tsx
|   |-- main.tsx
|   |-- styles.css
|   `-- vite-env.d.ts
|-- electron/
|   |-- main.cjs
|   |-- preload.cjs
|   `-- runtime.cjs
|-- mewl.services.json
|-- CHANGELOG.md
|-- LICENSE
|-- OVERVIEW.md
|-- ROADMAP.md
|-- README.md
|-- index.html
|-- package.json
|-- tsconfig.json
`-- vite.config.ts
```

## 诊断

专属的 `Logs` 工作区现在已是 `1.0.0` 桌面外壳的一部分。

- Electron 主进程负责日志聚合、保留策略，以及通过 preload 桥接的分批追加投递。
- 托管 stdout/stderr、自动化历史、告警快照和 Mewl 内部诊断都汇入同一条归一化信息流。
- Electron 主进程现在为日志采用更轻量的「代理 + 适配器」模型，让 journald 之类的源可以自然地与托管进程输出和 Docker 派生的容器日志并列。
- 日志页面现在在统一信息流之上提供专属的 `Mewl`、`Processes`、`Containers` 和 `System` 视图，让你可以聚焦内部诊断、运行时输出或 Linux 主机日志，而不改变底层采集模型。
- 当保存的启动命令给 Mewl 足够的信息安全推导 `docker logs` 或 `docker compose logs` 目标时，托管 Docker 服务可以贡献容器日志。
- 当 Mewl 运行在有 `journalctl` 的 Linux 主机上时，Linux 系统日志现在通过 journald 适配器流入。
- `consola` 为带标签的 Mewl 内部日志提供支持，来源包括 `runtime`、`process-manager`、`automation` 和 `ports`，而现有的每进程检查器尾部输出保持不变，作为窄详情视图。

## 设计方向

当前的产品方向刻意是实用优先，而不是仪表盘壁纸：

- 可折叠的左侧导航栏，涵盖概览、进程、托管、端口和监控
- 专属的托管工作区，用于用户自定义服务卡片和生命周期控制，编辑移入弹窗而不是持久侧栏
- 托管编辑器现在理解 `command`、`script` 和 `docker` 服务模式，而不是把每个启动定义压平成一种通用命令形式
- 紧凑的操作页头，带搜索、扫描和告警托盘，而不是大标题文案
- 共享搜索框现在使用 Pink Pixel 玫瑰色强调作为图标和聚焦光晕
- 简洁的概览仪表盘，用摘要卡片和短预览列表，而不是超大的说明表面
- 专属进程页面，带可展开卡片和全宽检查器，用于实时进程检查
- 实时进程卡片和检查器上的仅观测操作面板，围绕草稿创建与 pid 终止使用明确措辞
- 托管卡片现在自带图标式生命周期控件，让命令执行始终附着在已保存的服务定义上
- 进程界面现在把每个条目标注为 `managed` 或 `observed`，观测卡片上没有额外的解释性填充文案
- 托管页面不再在每个已保存服务卡片上重复 `managed` 归属徽标，让这些卡片聚焦于状态加服务模式
- 观测进程卡片现在优先显示可启动的父应用行，而不是嘈杂的辅助子进程，让实时进程列表聚焦于用户真正指的应用
- 折叠的进程卡片保持紧凑，长命令和路径详情移入展开状态
- 专属的端口和监控页面提供更深的操作细节
- 重新平衡的监控页面布局，把趋势图铺满工作区，包括第六个 Runtime Pulse 磁贴，然后才是快照和噪音服务区带
- GPU 遥测并入主机监控和侧边栏健康卡片，当主机桥接无法读取 GPU 数据时优雅回退
- 服务级自动化控件保留在托管卡片上，而不是一个基本空置的独立自动化工作区
- 监控侧可展开的资源卡片，让长进程命令行在被展开前保持隐藏
- 精简的托管服务编辑器，聚焦名称、描述、启动/停止/重启命令、颜色和图标选择，更深的运行时字段不进入默认 UI
- 托管服务编辑器再次暴露工作目录和重启策略控件，同时保留模式专属的命令标签示例
- 结构化的进程日志和会话记忆，让外壳更像一个真实的本地仪表盘
- 运行时源抽象，只在 Electron 桥接可用时启动
- 实时 Electron 主机桥接，可以扫描当前用户会话的进程、端口和机器压力
- Electron 安全的生产渲染层构建，使用相对资源路径而不是仅 Web 的绝对 `/assets/...` URL
- 打包外壳的品牌资源现在也通过基于 base 的路径解析侧边栏应用图标和 favicon，让 `file://` Linux 构建不丢失 UI 图标
- 调整过的端口注册表布局，让较长的 `Target` 绑定在桌面外壳中保持可读
- 配置驱动的托管服务，让桌面生命周期操作只触碰 Mewl 明确拥有的进程
- 托管服务设置在 React UI 和 `mewl.services.json` 之间往返
- 托管重启策略设置让 Electron 桥接在服务退出后重试，而不是无限猜测
- 解释器感知的脚本启动，让直接包装文件可以作为一等托管定义保存，无需 shell 操作符
- 当保存的 Docker 服务省略明确的拆除命令时，为常见 Compose 和命名容器流程推导 Docker 感知的停止命令
- 启动配置可以通过 Electron 桥接成组启动或静默 Mewl 自有服务
- 持久化的自动化历史流，解释什么被启动、停止、重试、失败或切换以及原因
- 加固的托管服务执行规则，让桌面桥接只启动经过验证、环境受控的命令
- 由 `electron-builder` 驱动的 Linux 打包流水线，包含包元数据、生成的图标和用于产物构建的手动 GitHub 工作流
- 当前产品步骤是「观测 / 托管」分离的前半部分，`Managed` 现在拥有已保存的服务定义，实时进程页面视觉上更轻
- 旧的推断型托管配置条目现在在加载时归一化为明确的已保存服务 schema，让运行时能区分记忆的服务定义和当前主机进程
- 已应用 Pink Pixel 品牌风格，但没有把应用变成通用的紫色 SaaS 网格

## 品牌

- 名称：Pink Pixel
- 网站：https://pinkpixel.dev
- GitHub：https://github.com/pinkpixel-dev
- 邮箱：admin@pinkpixel.dev
- 支持：support@pinkpixel.dev
- Discord：@sizzlebopz

## 备注

- `mockup.png` 仍是仓库中的视觉参考图。
- `public/icon.png` 由应用外壳和浏览器标签页使用。
- 当前实现是一个 Electron 优先的实时桌面仪表盘，带持久化的工作区偏好和托管的本地服务控制。
- 浏览器构建现在有意止步于桌面必需状态，而不是呈现回退运行时。
- 桌面外壳现在可以控制注册在 `mewl.services.json` 中的服务；任意发现的主机进程在实时进程页面有意保持只读。
- 实时主机扫描现在默认在进程网格中隐藏 Chromium zygote 和 utility worker 等辅助子进程，让一个应用看起来就是一个应用。
- 通知托盘分层在仪表盘表面之上，让告警从顶部命令栏打开时保持可读。
- 托管服务现在可以直接在应用中编写，包含命令字段、备注、颜色强调和图标选择，而实时进程卡片保持专注于检查而非控制。
- 从观测进程创建现在会打开带预填草稿横幅的托管编辑器，保存的定义在成为 Mewl 服务目录的一部分之前先经过审核。
- 终止观测进程现在是专属的实时运行时操作，只针对当前 pid，并与托管生命周期语义保持分离。
- 当前打包工作以 Linux 为先，因为运行时桥接在进程、端口、磁盘、网络和 GPU 数据上仍依赖 Linux 主机检查路径和命令。
- `1.0.0` 刻意是 Linux 优先的发行版。跨平台打包可以稍后到来，但当前的运行时桥接是围绕 Linux 主机检查命令和文件设计的。

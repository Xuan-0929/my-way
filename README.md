# My Way

一款本地优先的 macOS 学习计划与计时 App。把周计划、每日任务、专注计时和学习记录放在一起，数据保存在自己选择的文件夹中。

本仓库仅包含 **App 源码、测试、构建资源和空白工作区模板**，不包含个人学习计划、申请资料、笔记或真实计时记录。

## 功能

- **每日任务**：创建、复制、排序、编辑任务，记录计划与实际分钟、备注、学习成果及证据文件。
- **周计划与日历**：按自然周安排任务，查看周/月投入，打开历史记录；周计划卡片支持拖动调整日期。
- **专注计时**：自由计时、倒计时、暂停与恢复、结束后分配时长；关闭 App 后安全保留计时状态。
- **自动进度**：实际时间为 0 时未开始，大于 0 时进行中，达到计划后已达标；支持提前完成和恢复自动。达标仅代表时间投入，不代表知识掌握，也不会自动停止计时。
- **自愿顺延**：未完成任务不强制弹窗、不自动累积；明确选择后只顺延剩余计划时间，原日实际投入与成果保留。
- **复盘与统计**：学习和健身分别统计，汇总成果、证据、过去问成绩和每日反思。
- **本地文件保护**：原子写入、文件修订检测、外部编辑冲突提示与冲突副本。

## 环境

- 当前打包目标：Apple Silicon macOS（arm64）。
- Node.js **20.19+ 或 22.12+**、npm；版本范围以 `app/desktop/package.json` 为准。
- 技术栈：Electron、React、TypeScript、Vite、Zod、CodeMirror。
- Windows、Linux 与 Intel Mac 尚未作为发布目标验收。

## 快速开始

```bash
git clone https://github.com/Xuan-0929/my-way.git
cd my-way/app/desktop
npm ci
npm run dev
```

首次启动时选择一个**独立的本地数据目录**，不要把 App 源码仓库当作学习数据目录。仓库访问权限由 GitHub 仓库设置决定。

### 创建空白学习工作区

在仓库根目录执行以下命令。请使用一个尚不存在的目标路径，以免和已有数据混在一起：

```bash
cp -R examples/empty-workspace "$HOME/Documents/MyWayData"
```

然后在 App 中选择 `Documents/MyWayData`。模板仅包含启动所需目录与空白路线文件，没有个人信息或真实记录。首次可以直接添加任务，也可以进入“本周”建立计划。

已有 My Way 学习目录可以继续直接使用，不需要迁移或上传。当前格式要求工作区根目录包含 `README.md`、`00-dashboard/` 和 `05-admissions/`；后者是兼容现有工作区格式的目录名，不要求填写申请资料。

## 数据与隐私

App 不内置账户、GitHub 同步、云数据库或 AI 服务。选择工作区不会把该目录上传到本仓库。

```text
MyWayData/                         # 放在源码仓库之外，仅保存在本机
├── README.md
├── 00-dashboard/
│   ├── weeks/week-NN.md          # 周计划
│   ├── 12-week-roadmap.md        # 近期路线（App 只读）
│   ├── long-term-roadmap.md      # 长期路线（App 只读）
│   └── current-status.md        # 当前状态（App 只读）
├── 05-admissions/               # 工作区兼容目录
└── data/
    ├── daily/YYYY/YYYY-MM-DD.md # 每日任务、笔记、成果
    └── timer/                   # 活动计时状态与计时台账
```

每日记录使用 Markdown + YAML，计时状态使用 JSON/Markdown。可以用自己的编辑器查看文件；文件冲突需要明确处理，不会静默覆盖另一份修改。数据没有应用层加密，请自行管理本机访问权限与本地备份。

正式安装版的渲染会话默认拒绝 HTTP(S)/WebSocket 网络请求和非必要设备权限；点击外部资料链接会交给系统浏览器。应用安全边界与实现细节见 [桌面端说明](app/desktop/README.md)。

`.gitignore` 排除了本地记录、构建产物和工作区杂项，但不能替代提交前检查：请勿强制添加个人文件、工作区备份或带个人内容的截图。

## 开发与测试

以下命令在 `app/desktop` 中运行：

```bash
npm test              # 单元与组件测试
npm run typecheck     # TypeScript 检查
npm run lint          # ESLint
npm run build         # 构建主进程、preload 和界面
npm run test:e2e      # 真实 Electron 端到端测试，使用临时数据目录
```

macOS 原生全屏测试会通过 System Events 发送快捷键，需要运行测试的工具获得相应自动化权限，且快捷键不能被其他应用拦截；App 日常使用不需要该权限。存在全局快捷键冲突时，可以只跳过该项：

```bash
npm run build
npx playwright test --grep-invert 'native fullscreen'
```

## 打包与安装

```bash
cd app/desktop
npm ci
npm run package:mac -- --publish never
```

构建完成后，Apple Silicon DMG 位于 `app/desktop/release/`。打开 DMG 后将 **My Way.app** 复制到“应用程序”。该命令只生成本地产物，不发布 GitHub Release。

当前构建采用 ad-hoc 签名，未经过 Apple Developer ID 签名或公证；系统可能要求在“隐私与安全性”中确认打开。没有自动更新功能。安装包和个人工作区分开存放，更换 App 不需要删除学习数据。

## 源码结构

```text
app/desktop/
├── src/main/       # 文件读写、计时服务、领域逻辑与 IPC
├── src/preload/    # 受控桥接 API
├── src/renderer/   # React 界面
├── src/shared/     # 共享类型、校验与进度规则
├── tests/e2e/      # Electron 集成验收
└── build/          # 图标与打包校验
examples/empty-workspace/ # 无个人内容的启动模板
```

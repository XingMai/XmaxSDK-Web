# XmaxSDK Web CI/CD 与发版流程

发版流程包括准备版本、验证分支、标签隔离构建、消费端验证和 GitHub Release。
产物是 **`@xmaxai/web-sdk` 一个 npm tarball**，同时包含框架无关核心入口和可选的 `/react` 子入口。

本目录应提交到 Git；标签内必须包含脚本、消费端模板和对应 Release Notes。
仅 `.cicd/out/` 产物不提交。所有入口都可以从任意目录通过绝对路径执行；以下命令在仓库根目录执行。

## 流程概览

| 阶段 | 内容 |
| --- | --- |
| 版本准备 | 根 package.json、SDK package.json 与 RuntimeInfo 同步版本 |
| 依赖安装 | `pnpm install --frozen-lockfile` |
| 验证与构建 | SDK/示例测试、类型检查、SDK/React/示例构建 |
| 消费端验证 | 无 React 与有 React 两种独立环境安装同一个 tarball，测试 ESM、CJS、类型与 Vite 打包 |
| 产物打包 | 一个 `.tgz`、校验和及产物清单 |
| GitHub Release | GitHub Release；npm 发布作为独立可选步骤 |

默认只验证，远端写入必须显式加
`--push` 或 `--publish`。脚本不会自动提交、创建标签或推送当前开发分支。
GitHub Release 发布成功后会自动从 main 创建（或切换到已存在的）下一版本开发分支
`feature/yueting-v<next-patch>`；除此之外不强制移动本地分支。

## 环境

- macOS 或 Linux，Bash、Git、tar。
- CI/CD 使用 Node.js **22 或更新版本**；这不修改 SDK 的运行时要求。
- **pnpm 9.15.9**，与根目录 `packageManager` 一致。建议先安装 Node 22 并启用 Corepack，或安装该版本 pnpm。
- GitHub 发版额外需要 GitHub CLI：`gh auth login`，并有 `XingMai/XmaxSDK-Web` 的 Release 写权限。
- npm 发版额外需要 npm CLI、`@xmaxai` scope 的发布权限及符合账号要求的 2FA/令牌；本地可先 `npm login`。
- 默认 registry 固定为 `https://registry.npmjs.org/`，不会根据机器上的镜像地址误发私有仓库。

```bash
node --version
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm --version
pnpm install --frozen-lockfile
```

没有 Corepack 的 Node 安装可先安装 Corepack，或直接安装固定版本 pnpm。脚本会检查版本，
脚本自身不会安装包管理器（Corepack 首次使用可能下载指定版本）。勿将 npm Token、GitHub Token、Xmax API Key 写进仓库或命令参数。
自动化环境通过平台 Secret 注入凭证；本地 `.npmrc` 身份信息留在用户目录。

## 1. 开发分支与版本准备

支持 `codex/*` 和 `feature/*` 分支；默认建议 `feature/yueting-v<version>`。
准备前工作区必须干净。首次搭建流程时，先提交本目录及 packageManager 改动。

```bash
git switch -c feature/yueting-v1.0.0
bash .cicd/ci-prepare.sh 1.0.0
```

准备脚本会：

1. 检查干净工作区、开发分支、本地及 origin 尚无对应标签、版本不倒退。
2. 同步根包、`@xmaxai/web-sdk` 与 `RuntimeInfo` 版本；API 请求头共用运行时版本常量。
3. 运行 lockfile-only 同步，不创建 Git 标签。
4. 若版本说明不存在，从模板创建 `.cicd/release-notes/<version>.md`。

版本标签不带 `v`，支持 `1.1.0-rc.1` 等预发布，不接受 `+build` 后缀。
完成 What's New/API Changes 中的 TODO 后自行检查、提交并推送：

```bash
git diff --check
git diff
git add package.json packages/xmax-sdk/package.json packages/xmax-sdk/src/Foundation/Runtime/RuntimeInfo.ts pnpm-lock.yaml .cicd/release-notes/1.0.0.md
git commit -m "chore: prepare Web SDK 1.0.0"
git push -u origin HEAD
```

准备版本不自动替换 README 中所有示例版本，以免误改历史内容；发版前人工确认安装示例是否需要更新。

## 2. CI：测试、构建和真实安装包验证

```bash
bash .cicd/ci-check.sh
# 本地已安装当前锁文件依赖时，可省略安装；正式 CI/CD 不使用此选项：
bash .cicd/ci-check.sh --skip-install
```

检查内容：

- 锁文件安装、发版工具自身测试、SDK 单元测试和参考图库/图片压缩测试。
- 构建 SDK 核心与 React 子入口，再做 SDK 与示例类型检查及示例生产构建。
- 使用 `pnpm pack` 生成一个安装包，校验包名、版本、两个入口的 ESM/CJS/声明文件、文件白名单、依赖、MIT 元数据及与根目录一致的 LICENSE。
- 确认 React 是可选 peer dependency，不是核心的运行依赖。
- 在仓库之外的两个临时项目安装同一个 tarball：`.cicd/consumer-core` 不安装 React，`.cicd/consumer` 安装 React 并使用 `/react`；分别执行 ESM/CJS 导入、公开类型检查和 Vite 生产打包。
- 成功后候选 tarball 保留在 `.cicd/out/check-*/`，消费端临时目录自动删除。

独立消费端固定直接工具版本；其临时依赖安装没有提交 lockfile，因此会检验当前 registry 下的传递依赖解析。
SDK 正式构建则始终使用仓库锁文件。两个消费端均通过 `file:./sdk.tgz` 安装当前产物，
不依赖 workspace alias，也不会下载已发布的旧版 SDK。

这些检查不申请摄像头、不调用 Xmax API，也不证明真实 WebGPU、TRTC、音画同步或网络环境已通过验收。
发版前仍需运行实际浏览器冒烟测试，确认采集、生成、参考图上传、音频播放、插帧降级及断开重连正常。

## 3. 同步 develop / main

源分支必须已推送；远端 `develop`、`main` 必须存在且都能 fast-forward 到源提交。
脚本不会隐式创建缺失的远端分支。首次建立 `develop` 应由维护者确认后单独执行。

```bash
bash .cicd/ci-merge.sh          # 运行完整 CI，只验证，不推送
bash .cicd/ci-merge.sh --push   # 再次验证，通过后原子推送 develop 和 main
```

推送没有 force 参数；测试期间远端分支出现冲突更新会失败，不覆盖他人提交。
本地 main/develop 不会被强制重置。若分支保护要求 PR，请走正常 PR 审核与合并流程；
不要为了使用该脚本绕过保护。`ci-check.sh` 可以直接作为 PR 的验证命令。

本地更新 main 并手动创建 **附注标签**：

```bash
git fetch origin
git switch main
git merge --ff-only origin/main
git tag -a 1.0.0 -m "release: XmaxSDK Web 1.0.0"
git push origin refs/tags/1.0.0
```

## 4. CD：从标签构建候选产物

```bash
bash .cicd/cd-github-release.sh 1.0.0
```

默认**不创建 GitHub Release，也不发布 npm**。此命令要求工作区干净，并验证
本地 main、远端 main、本地标签和远端标签指向同一提交。

脚本从这个提交创建隔离 worktree，按锁文件安装并运行完整 CI 与消费端验证；
模型及声明重新生成后若产生源码/锁文件漂移则拒绝发布。Release Notes 必须已经在标签中。
正常结束后删除本次创建的 worktree；若有意外修改不能安全删除则保留路径供检查。

成功后输出类似 `.cicd/out/1.0.0-<commit>-<random>/`：

```text
xmaxai-web-sdk-1.0.0.tgz
release-notes.md
release.json       # 提交、版本、SDK 包 SHA-512 integrity、说明校验值
SHA256SUMS         # SHA-256 文件校验和
```

下文 `<artifacts-dir>` 必须替换为脚本打印的实际目录；不要手动填写 release.json 来冒充通过验证。
此目录是本地受信任的发布输入，不是对不可信下载内容的签名验证机制。应妥善保存原始产物，
后续 GitHub 与 npm 使用同一组文件，不重新打包。

## 5. 可选：发布 npm

若当前版本只提供 GitHub 手动安装包，跳过此步。只发布 `@xmaxai/web-sdk`，React 子入口包含在同一个包中。

```bash
# 只检查 npm 将发布的内容；不会写入 registry：
bash .cicd/cd-npm-publish.sh 1.0.0 --artifacts <artifacts-dir>

# 明确发布，可能要求 npm 2FA：
bash .cicd/cd-npm-publish.sh 1.0.0 --artifacts <artifacts-dir> --publish
```

稳定版本默认 `latest`，预发布默认 `next`。可以指定 `--tag beta`，但预发布版本使用 `latest` 会被拒绝。
`--dry-run` 不能证明账号一定有发布权限；首次发版必须先确认 `@xmaxai` scope 所有权。
首次成功发布后，再把根 README 从“尚未发布 npm”改为真实安装方式，不提前宣称可安装。

发布前读取该版本的 registry integrity：若已存在且字节完全相同则跳过；若不同则拒绝。
只有明确 E404 当作未发布，认证/网络/其他错误都会停止。
若发布结果因网络异常而不确定，保留产物，修复后重跑同一命令；不删除 SDK、不覆盖版本。
已存在包的 dist-tag 不会自动调整，如需切换 latest/next，应单独审核后使用 npm dist-tag。

## 6. 发布 GitHub Release

```bash
bash .cicd/cd-github-release.sh 1.0.0 --artifacts <artifacts-dir> --publish
```

再次检查提交和产物校验值，然后在 `XingMai/XmaxSDK-Web` 创建 Release，上传 SDK tarball、
release.json 与 SHA256SUMS，使用同一份 Release Notes。Release 标题与标签一致，均为不带 `v` 的版本号。
预发布标签创建 prerelease，不标记为 latest。
已有 Release 不自动覆盖，失败后先用 `gh release view <version>` 检查是否已创建，
避免把网络超时误认为没有发布。需补附件时由维护者核对校验值后处理。

如同时发布 npm，建议先完成 npm，再创建 GitHub Release，避免公告了一个尚不可安装的版本。
只发 GitHub 时，用户安装下载的 tarball：

```bash
npm install ./xmaxai-web-sdk-1.0.0.tgz
```

React 应用使用自身的 `react` / `react-dom` 依赖，通过 `@xmaxai/web-sdk/react` 导入组件；非 React 应用无需安装 React。

发布成功后，脚本自动从 main 创建并切换到下一版本开发分支
`feature/yueting-v<next-patch>`（分支已存在时直接切换），该分支只在本地创建，需要时自行推送。

## 常见停止原因

- **pnpm 版本不一致**：按根 packageManager 安装，不要发布时升级锁文件。
- **源码或工作区不干净**：先检查变化；CD 不使用未提交的修改。
- **标签版本与包版本不一致**：重新准备正确版本。已发布标签不得移动。
- **develop/main 不能快进或受保护**：通过正常合并流程整合，不 force push。
- **消费端类型/导入失败**：修复包导出、声明或依赖后重新跑 CI，不能跳过消费者检查发布。
- **半发布**：保留原 `.tgz`，按上述 integrity 检查重试；修改代码须用新版本。

脚本只操作其 mkdtemp 创建的临时目录，不删除开发者工作目录。`.cicd/out/` 不自动清理，
确认不再需要重试/审计后，可自行归档或删除明确的版本产物目录。

## 官方行为参考

- [pnpm workspace 协议与打包时替换](https://pnpm.io/workspaces#workspace-protocol-workspace)
- [npm publish：tarball、dist-tag 和 dry-run](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
- [npm scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)

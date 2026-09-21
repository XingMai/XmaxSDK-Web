# Web SDK 发版说明与验收

执行步骤、脚本参数和失败恢复见 [`.cicd/README.md`](../.cicd/README.md)。
本流程分为版本准备、CI、标签、隔离构建、消费端验证和 CD；
发布产物为一个 npm 安装包，包含核心入口及可选的 `/react` 子入口。

## 发布边界

- 仅发布 `@xmaxai/web-sdk`，与根包采用同步版本；`/react` 是同一包的子入口，不是独立包。示例 `xlab-react` 是 private，不发布。
- 标签使用不带 v 的 SemVer，如 `1.0.0` / `1.1.0-rc.1`。
- 构建产物包含 ESM、CommonJS、TypeScript 声明、内置模型和 MIT LICENSE；SDK 的 MIT 声明不改变第三方依赖或模型权重的原有许可，发版前需单独核验。
- GitHub Release 与 npm 是独立发布步骤，可以只发布 GitHub 安装包。
- 仅编写/执行检查脚本不会触发正式发布，必须显式传入 `--push` / `--publish`。
- 不在此次流程搭建中实际创建版本标签、推送分支或发布包。

## 发版前验收清单

- [ ] 确认包名/scope、版本、发布渠道和对应权限。
- [ ] 完成并提交版本说明；破坏性 API 变化附迁移示例。
- [ ] 审核源码、包清单及依赖，检查没有 API Key、凭证或用户数据。
- [ ] `bash .cicd/ci-check.sh` 通过，包含 tarball 消费端，不只是 workspace 构建。
- [ ] 实机浏览器验证：摄像头/麦克风权限、预览、连接、生成、切模式、上传 JPG、断开和重连。
- [ ] 验证 WebGPU 可用/不可用设备上的插帧开关与降级、原始分辨率和资源释放。
- [ ] 确认发布版本的已知限制已写入说明；测试通过不等于启动暗帧等尚未修复的问题已解决。
- [ ] 正式标签和 main/远端提交一致，隔离构建成功且无锁文件或生成文件漂移。
- [ ] 查看 SHA256SUMS / release.json，保存原始产物用于部分失败后重试。
- [ ] 若发布 npm，先 dry-run，随后显式发布 SDK，再创建 GitHub Release。
- [ ] 从 GitHub 下载 SDK 包核验校验和；从 npm 安装新版本复测核心入口与 `/react`（如果该渠道已发布）。

## 自动化接入

这些是可以在本地或 CI runner 执行的脚本，不绑定某个 CI 平台，也不默认部署示例网站。
普通 PR job 使用 Node 22、pnpm 9.15.9，然后运行 `bash .cicd/ci-check.sh`。
发布 job 应使用受保护环境、人工审批及最小权限凭证，并显式调用 CD 的 `--publish`。
不要让来自不受信任 PR 的代码接触发布 Secret；不要把 `ci-merge.sh --push` 放进普通 PR job。

当前 CD 要求本地 main/远端 main/标签相同，自动化 runner 需检出 main、获取正式标签，
而非直接使用默认 detached HEAD。若 main 已继续前进，脚本会拒绝历史版本发布；
需要单独审核历史补发流程，不要倒退 main 来满足检查。

## 暂不自动处理的事项

npm scope 注册/转移、仓库分支保护、发布凭证配置、许可证审批、实际摄像头与 GPU 硬件验收、
GitHub Release 部分创建后的修复、历史版本补发、正式 dist-tag 回滚，均需维护者单独确认。
本流程不自动 unpublish、不修改已发布版本，也不覆盖已有 Release。

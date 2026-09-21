# Release Notes

每个版本一份已提交的 `<version>.md`，与不带 `v` 的 Git 标签一致，例如
`1.0.0.md`、`1.1.0-rc.1.md`。SDK 和 React 共用版本号及说明。

复制 `TEMPLATE.md`，填写 What's New 和 API Changes。准备脚本不会覆盖已有说明。
CD 从标签对应的隔离 worktree 读取说明；缺失、空文件或仍含 `TODO` 会停止发版。
不要把 API Key、临时凭证或用户数据写入说明。

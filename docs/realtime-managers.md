# 实时 Manager 职责

实时能力按连接与生成职责拆分，应用只使用 `XmaxRealtimeManager`，由其提供公开 API、状态回调和统计回调。两个子 Manager 为 SDK 内部组件，不从包入口导出。

| 组件 | 职责与持有状态 |
| --- | --- |
| `XmaxRealtimeManager` | 公开 API、本地摄像头、音量/插帧配置、统计与启动计时回调，以及连接和生成流程编排 |
| `XmaxRealtimeConnectionManager` | 会话创建/关闭、心跳刷新、RTC 进退房、编码与发布、远端轨道与渲染绑定、等待远端轨道就绪 |
| `XmaxRealtimeGenerationManager` | 任务 ID、生成条件缓存、开始/更新/停止生成、等待确认、确认后开启远端音频 |
| `RealtimeCoordinator` | 公开状态、操作互斥、操作有效性检查、取消及分级清理 |

首次生成先校验上下文，再按需连接，随后发送生成请求；生成中再次调用只更新条件，不重建连接或任务。远端渲染绑定通过回调应用主 Manager 的插帧配置与首帧计时。

连接流程成功创建会话后立即登记资源；后续任何步骤失败，由 Coordinator 调用统一清理，避免遗留服务端会话。清理先停止心跳和生成，再退房、解除远端绑定并关闭会话。`disconnect()` 保留本地预览，`close()` 额外释放本地摄像头。

生成管理器独立持有活动任务，不依赖断开中状态是否携带任务 ID。取消与清理共享进行中的停止请求，避免重复停止或任务尚未停止就退房。等待生成确认和远端轨道就绪均响应取消并移除监听；迟到结果不再开启音频或提交生成状态。

回归覆盖位于 `packages/xmax-sdk/tests/RealtimeManagers.test.ts` 和 `packages/xmax-sdk/tests/XmaxRealtimeManager.test.ts`，包括会话创建时取消、确认迟到、远端就绪等待取消、清理失败、心跳绑定变更以及任务停止顺序。

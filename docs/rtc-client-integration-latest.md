# TRTC 客户端接入说明（服务端交互版）

## 1. 这份文档讲什么

本文只面向用户侧客户端，重点说明两件事：

1. 客户端如何通过服务端接口拿到 TRTC 入房参数
2. 客户端在什么时机需要刷新这些参数

不展开讲 TRTC SDK 的具体初始化代码，只约定你应该从服务端响应里读哪些字段。

## 2. 生效条件

- 只有当当前会话绑定的模型是 `provider=trtc` 时，服务端才会返回 TRTC 字段
- `provider` 不传时，服务端默认按 `vertc` 处理
- 客户端必须先读 `modelExtra.provider`，再决定走哪套 RTC 登录逻辑

## 3. 核心结论

- 客户端不需要单独请求一套 TRTC 凭据接口
- TRTC 字段直接跟随会话接口返回，统一放在 `data.modelExtra`
- 最重要的刷新点是：
  - `POST /session`
  - `PUT /session/{sessionUid}/heartbeat`
  - `GET /session/active`
  - `GET /session/{sessionUid}`
- `rtc_app_id` 一律按字符串处理
- TRTC 登录身份必须使用 `rtc_user_id`，不要直接使用业务 `user_id`

## 4. 服务端交互主链路

推荐客户端按下面这条链路接入：

1. 调用 `POST /session` 创建会话
2. 从响应的 `data.modelExtra` 读取 TRTC 字段并进房
3. 会话存活期间周期调用 `PUT /session/{sessionUid}/heartbeat`
4. 每次心跳成功后，用返回的最新 `data.modelExtra` 覆盖本地缓存
5. 客户端重启或前后台恢复时，可调用 `GET /session/active` 或 `GET /session/{sessionUid}` 恢复会话状态
6. 会话结束时调用 `DELETE /session/{sessionUid}`

## 5. 和 vertc 的消息收发差别

这一节只讲房间内业务消息，不讲音视频流。

当前服务端业务消息统一走 JSON 事件体，典型事件有：

- `tracks`
- `heartbeat`
- 其他业务自定义事件

上层业务入口已经统一，服务端内部最终都会走同一个消息处理方法：

- vertc：`onUserMessageReceived` / `onRoomMessageReceived`
- TRTC：`OnReceiveCustomCmdMsg`
- 统一落到：`_handle_incoming_room_message(...)`

也就是说，**业务 JSON 格式可以尽量保持一致**，真正不同的是 RTC 通道能力。

### 5.1 发送差别

#### vertc

vertc 里当前有两种发法：

1. 定向消息：`sendUserMessage(user_id, payload_text)`
2. 房间广播：`sendRoomMessage(payload_text)`

也就是说，vertc SDK 通道本身能区分：

- 这条消息是发给某个用户
- 还是发给整个房间

#### TRTC

TRTC 这边当前统一改成了自定义消息通道：

- `SendCustomCmdMsg(cmd_id=1, payload, reliable=true, ordered=false)`

另外，当前实现补了一层超长消息拆包：

- 原始业务 JSON 的 UTF-8 字节长度 `<= 800`：直接发送
- 原始业务 JSON 的 UTF-8 字节长度 `> 800`：自动拆成多条 `__trtc_chunk__` 分片消息发送
- 接收端按 `(sender_uid, eventId)` 做乱序组包，拼完整并重新 JSON 解析成功后，才进入普通业务处理链路

详细协议见：

- [TRTC 自定义消息拆包协议](file:///home/ubuntu/workspace/open_video_clean/docs/trtc-message-chunking.md)

这里有个关键差别：

- **TRTC 当前这条通道只有房间广播语义**
- 没有和 vertc `sendUserMessage` 完全等价的“服务端只投给某个用户”的独立通道

所以现在服务端在 TRTC 下的做法是：

- `_rtc_send_user_message(...)` 也会退化成一次广播
- 目标 `user_id` 不靠 RTC 通道做路由
- 而是放进业务 JSON 里，由客户端自己过滤

换句话说：

- 在 vertc 下，`user_id` 可以由 RTC 通道帮你做定向
- 在 TRTC 下，`user_id` 只是 payload 里的业务字段，不是底层投递目标

### 5.2 接收差别

#### vertc

vertc SDK 会把两类消息分开回调：

- `onUserMessageReceived`
- `onRoomMessageReceived`

客户端如果关心“这条消息到底是定向发给我的，还是房间广播”，可以直接从回调类型区分。

#### TRTC

TRTC 当前只走自定义消息接收：

- `OnReceiveCustomCmdMsg`

因此客户端收到时，看到的是：

- 一条房间广播消息
- `cmd_id=1`
- 具体是不是“发给我”的，要看 JSON 内容自己判断

另外 TRTC 还有一个 vertc 没有直接对应的补充回调：

- `OnMissCustomCmdMsg`

这个回调表示自定义消息有丢失，服务端当前会打 warning 日志。
如果客户端侧对消息完整性很敏感，要注意这条通道当前配置的是 `reliable + unordered`，因此除了分片重组，还要考虑业务层幂等和乱序容忍。

### 5.3 对客户端的直接影响

如果你们之前按 vertc 的心智写客户端，需要特别注意下面几点：

1. 不能再把 TRTC 的消息回调理解成“收到就一定是发给我的”
2. TRTC 下要从消息 JSON 里读取目标字段，例如 `user_id` / `uid`
3. 如果消息目标不是当前用户或当前任务，客户端要自己丢弃
4. 同一份业务消息体，vertc 可能是定向送达，TRTC 可能是广播后本地过滤

### 5.4 一个最常见的例子

例如服务端要给某个用户发一条 `tracks` 消息：

- 在 vertc 下，可以直接 `sendUserMessage(user_id, payload)`
- 在 TRTC 下，当前实现会广播这条消息，然后让客户端按 payload 里的目标字段过滤

因此客户端在 TRTC 下建议使用这样的判断顺序：

1. 先解析 JSON
2. 看 `event`
3. 再看 `user_id` / `uid` 是否属于当前自己
4. 不属于就忽略

### 5.5 TRTC 消息通道限制

当前 TRTC 自定义消息通道还要注意这些限制：

- 单条消息建议小于 `1000` 字节
- 发送频率建议小于 `30` 条/秒
- 总带宽建议小于 `8000` 字节/秒

所以：

- 小型业务信令适合放这里
- 不要把大对象、长文本、批量结构直接塞进消息体

### 5.6 一句话总结

- **vertc**：既支持定向消息，也支持房间消息，通道语义更直接
- **TRTC**：当前统一走自定义消息广播通道，定向语义靠业务 JSON 自己表达和过滤

## 6. 接口说明

### 6.1 创建会话：`POST /session`

这是客户端第一次拿到 TRTC 入房参数的入口。

返回示例：

```json
{
  "success": true,
  "data": {
    "sessionUid": "ums-001",
    "modelExtra": {
      "room_id": "100000001",
      "bot_name": "bot001",
      "user_id": "user-001",
      "provider": "trtc",
      "rtc_app_id": "1600126360",
      "rtc_user_id": "user-001",
      "rtc_bot_id": "bot001",
      "user_sig": "eJyrVgrx...",
      "private_map_key_with_string_room_id": "eJyrVgrx..."
    }
  }
}
```

客户端至少要读取这些字段：

- `provider`
- `room_id`
- `rtc_app_id`
- `rtc_user_id`
- `user_sig`
- `private_map_key_with_string_room_id`

其中：

- `provider` 用来决定走 TRTC 还是 vertc
- `room_id` 是 TRTC 房间号
- `rtc_app_id` 是 TRTC `SDKAppID`
- `rtc_user_id` 是 TRTC 登录 userId
- `user_sig` 和 `private_map_key_with_string_room_id` 是 TRTC 鉴权参数

### 6.2 会话心跳：`PUT /session/{sessionUid}/heartbeat`

这是客户端最重要的凭据刷新入口。

返回示例：

```json
{
  "success": true,
  "data": {
    "sessionUid": "ums-001",
    "modelExtra": {
      "room_id": "100000001",
      "provider": "trtc",
      "rtc_app_id": "1600126360",
      "rtc_user_id": "user-001",
      "user_sig": "eJyrVgrx...",
      "private_map_key_with_string_room_id": "eJyrVgrx..."
    }
  }
}
```

客户端要做的事：

- 心跳成功后，用最新的 `data.modelExtra` 覆盖本地缓存
- 不要假设创建会话时拿到的 `user_sig` 永远不变
- 不要因为 `user_sig` 刷新，就直接把它当成“切房”

### 6.3 查询当前有效会话：`GET /session/active`

适合这几类场景：

- App 重启后恢复当前活跃会话
- 前后台切换后重新确认会话状态
- 本地 session 信息丢失后重新同步

返回里是 `data[]`，每一项的 `modelExtra` 都可能带 TRTC 字段。

客户端处理规则：

- 遍历活跃会话
- 找到目标 `sessionUid`
- 读取对应 `modelExtra`
- 如果 `provider=trtc`，按 TRTC 逻辑恢复本地 RTC 状态

### 6.4 查询单个会话：`GET /session/{sessionUid}`

这个接口返回单个会话的完整 `modelExtra`，适合精准恢复某一条会话状态。

推荐用途：

- 已知 `sessionUid`，只想恢复这一条会话
- 心跳失败后，主动拉一次最新会话快照

### 6.5 关闭会话：`DELETE /session/{sessionUid}`

关闭成功后，返回体里也可能带 `data.modelExtra`，但关闭后客户端不应继续把这条会话当成活跃会话。

客户端要做的事：

- 停止会话心跳
- 清理本地会话缓存
- 退出 TRTC 房间

## 7. `modelExtra` 字段说明

当 `provider=trtc` 时，客户端重点关注这些字段：

```json
{
  "room_id": "100000001",
  "bot_name": "bot001",
  "user_id": "user-001",
  "provider": "trtc",
  "rtc_app_id": "1600126360",
  "rtc_user_id": "user-001",
  "rtc_bot_id": "bot001",
  "user_sig": "eJyrVgrx...",
  "private_map_key_with_string_room_id": "eJyrVgrx..."
}
```

字段含义：

- `user_id`：业务用户 ID，不用于 TRTC 登录
- `provider`：RTC 类型，客户端必须先判断它
- `room_id`：TRTC 房间号
- `rtc_app_id`：TRTC `SDKAppID`，服务端统一按字符串返回
- `rtc_user_id`：TRTC 登录身份
- `user_sig`：TRTC 登录签名
- `private_map_key_with_string_room_id`：TRTC 进房鉴权字段

对用户侧客户端来说，真正进房需要的最小字段集合是：

- `room_id`
- `rtc_app_id`
- `rtc_user_id`
- `user_sig`
- `private_map_key_with_string_room_id`

## 8. 刷新规则

### 8.1 哪些字段可能刷新

这些字段都可能在心跳或查询时变化：

- `user_sig`
- `private_map_key_with_string_room_id`
- `rtc_user_id`
- `room_id`
- `rtc_app_id`

### 8.2 什么情况不等于切房

下面这些变化，不要直接当成切房：

- 仅 `user_sig` 变化
- 仅 `private_map_key_with_string_room_id` 变化

这类变化更接近“凭据刷新”。

### 8.3 什么情况应视为 RTC 绑定发生了实质变化

如果下面任一字段发生变化，客户端应按“需要重建 RTC 登录态”处理：

- `provider`
- `room_id`
- `rtc_app_id`
- `rtc_user_id`

如果你们的客户端 SDK 不支持房间内热更新凭据，那么当 `user_sig` 或 `private_map_key_with_string_room_id` 变化时，也应该按本端策略重新进房。

## 9. 客户端最容易漏掉的点

1. `provider=trtc` 时，不要再读取 vertc 的 `room_token`
2. `rtc_app_id` 是字符串，不要按 number 写死
3. `rtc_user_id` 才是 TRTC 登录身份，不能直接拿 `user_id` 顶上
4. 创建会话拿到的凭据不是永久值，心跳成功后要覆盖本地缓存
5. `GET /session/active` 返回的是数组，TRTC 字段在每个元素自己的 `modelExtra` 里

## 10. 最小接入清单

- 接入 `POST /session`
- 接入 `PUT /session/{sessionUid}/heartbeat`
- 支持 `GET /session/active` 或 `GET /session/{sessionUid}` 做状态恢复
- 本地缓存整份 `modelExtra`
- 每次使用 RTC 前先判断 `provider`
- TRTC 下使用 `room_id + rtc_app_id + rtc_user_id + user_sig + private_map_key_with_string_room_id`

## 11. 相关文档

- [TRTC 下游接口改动说明（MQTT 模式）](file:///home/ubuntu/workspace/files/trtc-api-flow.md)
- [Time 模式前端接入说明](file:///home/ubuntu/workspace/open_video_clean/docs/time_mode_frontend_guide.md)

# TRTC 自定义消息拆包协议

## 1. 目的

TRTC 自定义消息单条大小和频率都比较敏感。为了避免业务 JSON 过大导致发送失败，当前约定：

- 业务消息仍然是普通 JSON
- 当整条消息的 UTF-8 字节长度大于 `800` 时，发送端自动拆包
- 每个分片仍通过 `SendCustomCmdMsg` 发送
- 所有发送都必须使用：
  - `reliable = true`
  - `ordered = false`

服务端和客户端都应该按同一套协议做拆包和解包。

## 2. 什么时候拆包

- 如果原始业务 JSON 的 UTF-8 字节长度 `<= 800`，直接按普通消息发送
- 如果原始业务 JSON 的 UTF-8 字节长度 `> 800`，必须拆成多条分片消息发送

注意：

- `800` 是当前业务阈值，不是 TRTC 的绝对硬上限
- 分片后的单条消息也必须保证自己足够小

## 3. 分片消息格式

分片本身仍然是 JSON，对外层包结构约定如下：

```json
{
  "event": "__trtc_chunk__",
  "eventId": "7f5c61b4d4ca4b3e8ff0df9b6e67d5b4",
  "index": 0,
  "count": 3,
  "data": "{\"event\":\"video_started\",\"uid\":\"abc\""
}
```

字段说明：

- `event`
  - 固定为 `__trtc_chunk__`
  - 用来区分这是一条传输层分片，不是业务事件
- `eventId`
  - 一次完整拆包消息的唯一 ID
  - 同一条原始消息的所有分片必须共用同一个 `eventId`
- `index`
  - 当前分片编号
  - 从 `0` 开始
- `count`
  - 本次拆包的总分片数
- `data`
  - 当前分片承载的正文片段
  - 类型固定为字符串

## 4. 发送端规则

### 4.1 普通消息

如果消息长度没有超过 `800`，直接发送原始 JSON 字符串，不需要再包一层。

### 4.2 超长消息

如果消息长度超过 `800`：

1. 先生成一个唯一的 `eventId`
2. 把原始 JSON 字符串切成多个字符串片段
3. 每个片段按上面的分片格式包成一条 JSON
4. 依次发送所有分片

发送参数固定为：

```text
cmd_id = 1
reliable = true
ordered = false
```

## 5. 接收端规则

### 5.1 普通消息

如果收到的 JSON 不满足下面两个条件：

- `event == "__trtc_chunk__"`
- 同时带有 `eventId / index / count / data`

那么就按普通业务 JSON 直接处理。

### 5.2 分片消息

如果识别为分片消息：

1. 以 `(sender_uid, eventId)` 作为组包键
2. 把当前 `data` 放到对应 `index`
3. 不要求按顺序到达
4. 只要 `0..count-1` 全部收齐，就按 `index` 升序拼接 `data`
5. 拼接完成后，对完整字符串做一次 JSON 解析
6. 解析成功，才进入普通业务事件处理链路
7. 解析失败，直接丢弃即可

## 6. 乱序要求

消息分片**不保证按顺序收到**，所以接收端必须：

- 允许先收到 `index=3`
- 再收到 `index=1`
- 最后收到 `index=0`

真正组包时，必须按：

```text
0, 1, 2, 3, ...
```

的顺序拼接，而不是按接收顺序拼接。

## 7. 缓存要求

接收端需要维护一个 LRU 缓存，保存最近 `1000` 个“尚未成功处理完成”的分片消息。

建议键为：

```text
(sender_uid, eventId)
```

缓存内容至少包含：

- `count`
- 已收到的 `index -> data`
- 最近更新时间

行为要求：

- 新分片到达时，如果对应组包记录不存在，就创建
- 如果缓存超过 `1000` 条，淘汰最旧的未完成记录
- 一旦成功组包并进入普通处理链路，就立刻从缓存里删除
- 如果组包后 JSON 解析失败，也可以直接删除

## 8. 客户端需要打印的日志

建议客户端至少打印下面几类日志。

### 8.1 发送端

- 原始消息长度
- 是否触发拆包
- `eventId`
- `count`
- 每个分片的 `index`
- 每个分片的字节长度
- 发送返回值

### 8.2 接收端

- 收到分片时：
  - `eventId`
  - `index`
  - `count`
  - 当前已收齐数量
- 组包成功时：
  - `eventId`
  - `count`
  - 完整消息总字节数
- 组包失败时：
  - `eventId`
  - 失败原因

## 9. 示例

原始业务消息：

```json
{
  "event": "tracks",
  "uid": "task-001",
  "user_id": "user-001",
  "tracks": [
    {
      "mime": "audio/pcm",
      "url": "https://example.com/very-long-url"
    }
  ]
}
```

如果它超过 `800` 字节，就会被拆成例如 3 个分片：

```json
{"event":"__trtc_chunk__","eventId":"evt-001","index":0,"count":3,"data":"{\"event\":\"tracks\",\"uid\":\"task-001\","}
{"event":"__trtc_chunk__","eventId":"evt-001","index":1,"count":3,"data":"\"user_id\":\"user-001\",\"tracks\":["}
{"event":"__trtc_chunk__","eventId":"evt-001","index":2,"count":3,"data":"{\"mime\":\"audio/pcm\",\"url\":\"https://example.com/very-long-url\"}]}"}
```

接收端只要把 `index=0,1,2` 都收齐，就按顺序拼回原始 JSON，再进入正常业务处理。

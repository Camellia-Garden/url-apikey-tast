# 月见中继站 · API 可用性测试台

> 在本机快速检查 API 中转站的连通性、模型可见性与真实调用能力。
>
> 输入 URL 和 API Key，选择接口协议，获取模型列表，再用一次短请求查看响应内容与延时。

## ✦ 功能一览

- **多协议测试**：OpenAI Responses、OpenAI Chat Completions、Claude Messages、Gemini。
- **模型发现**：按当前 API Key 获取模型列表，也支持直接手动填写模型 ID。
- **真实调用验证**：逐个测试或批量测试模型，避免只看列表造成误判。
- **流式计时**：同步显示响应头耗时、首段文本耗时和总耗时。
- **结果诊断**：根据 HTTP 状态、错误码、错误类型和返回内容判断失败原因。
- **客户端限制识别**：把“仅支持编程客户端”的网页提示标记为“待客户端验证”。
- **本地配置卡片**：主动保存 URL、Key 和测试选项，一键回填整套配置。
- **半透明二次元界面**：支持桌面和窄屏浏览器，背景壁纸仍然可见。

## ▶ 快速启动

### Windows 双击启动

需要 **Node.js 22 或更高版本**，项目没有 npm 第三方依赖。

1. 双击 `start.bat`。
2. 等待浏览器自动打开。
3. 默认访问地址为 [http://127.0.0.1:3177](http://127.0.0.1:3177)。
4. 使用结束后双击 `stop.bat`。

如果默认端口被占用，可以在 PowerShell 中指定端口：

```powershell
./start.bat 3180
./stop.bat 3180
```

### 命令行启动

```sh
npm start -- 3180
```

按 `Ctrl+C` 停止服务。服务只监听本机回环地址，不会把网页发布到局域网。

## ☾ 使用流程

1. 在“连接设置”中填写中转站 URL 和 API Key。
2. 选择对应协议，确认页面显示的接口路径。
3. 点击“获取模型列表”。
4. 从模型列表点击模型 ID，或手动输入模型 ID。
5. 选择流式输出，填写测试提示词，然后点击“开始测试”。
6. 查看响应内容、HTTP 状态和延时指标。
7. 需要重复使用时，点击“保存当前配置”，下次从配置卡片一键应用。

地址支持站点根地址、带版本号的地址和完整接口地址，例如：

```text
https://relay.example
https://relay.example/v1
http://127.0.0.1:8000/proxy/v1
```

如果中转站只开放生成接口，可以跳过模型发现，直接手动输入模型 ID。

## ◈ 支持的接口

| 协议 | 获取模型 | 文本测试 |
| --- | --- | --- |
| OpenAI Responses | `GET /v1/models` | `POST /v1/responses` |
| OpenAI Chat Completions | `GET /v1/models` | `POST /v1/chat/completions` |
| Claude Messages | `GET /v1/models` | `POST /v1/messages` |
| Gemini | `GET /v1beta/models` | `POST /v1beta/models/{id}:generateContent` 或 `:streamGenerateContent` |

默认使用各协议的原生鉴权方式。Claude 和 Gemini 可以在连接设置中切换为 Bearer。

## ⏱ 延时指标

| 指标 | 含义 |
| --- | --- |
| 响应头 | 从本机发出请求到收到上游响应头的时间 |
| 首段文本 | 收到第一段可显示文本的时间，主要用于流式响应 |
| 总耗时 | 完整读取本次响应所用的时间 |

非流式响应没有首段文本计时。每次测试最多请求 256 个输出 token，实际调用可能消耗中转站额度。

## 🩺 结果诊断

测试失败时，页面会同时参考返回内容和协议状态进行判断，并展示处理建议与判断依据。

| 页面提示 | 常见含义 |
| --- | --- |
| 客户端限制 | 站点限制网页、脚本或 SDK 直连，需要使用指定编程客户端验证 |
| 余额不足 / 配额不足 | 账户余额、套餐额度或调用次数不足 |
| 分组或渠道不可用 | 当前 Key 没有可用分组、渠道或路由 |
| 模型不可用 | 模型 ID 不存在、未开放或不属于当前 Key |
| 鉴权失败 | API Key 无效、过期或鉴权方式不匹配 |
| 请求限流 | 请求频率过高，或服务返回了限流相关状态 |
| 上游异常 | 上游模型服务或中转站内部发生错误 |
| 原因待确认 | 当前返回信息不足，保留原始响应供进一步核对 |

普通 JSON、纯文本、HTML 提示、HTTP 200 内嵌错误和流式错误事件都会进入诊断。原始返回可以展开查看，复制按钮会同时复制文本和诊断信息。

遇到“本站仅支持编程客户端使用……”一类提示时，页面会显示“待客户端验证”。这表示网页测试方式被限制，不代表模型一定不可用。批量测试会分别统计通过、客户端限制和异常。

## ▣ 本地配置保存

点击“保存当前配置”后，以下内容会写入当前浏览器的本地存储：

- 中转站 URL
- API Key
- 接口协议和鉴权方式
- 模型 ID
- 测试提示词
- 流式输出选项

配置卡片只显示脱敏后的 API Key。点击“一键应用”可以回填整套设置，点击“删除”可以移除配置。默认不会保存当前输入，只有主动点击保存才会持久化。

## 🔒 数据边界

- 本地服务只监听 `127.0.0.1`。
- API Key 只会随请求发送到你填写的中转站。
- 页面默认不保存 Key。主动保存后，Key 会留在当前浏览器的本地存储中。
- 模型列表、测试结果和响应内容不会上传到本项目仓库。
- 每轮模型结果会在刷新页面后清空。

## 🧪 开发与检查

运行完整测试：

```sh
npm test
```

测试使用本地模拟中转站，覆盖协议请求、流式输出、延时统计、错误诊断、客户端限制和敏感信息脱敏。

## 📚 接口参考

- [OpenAI 流式响应](https://developers.openai.com/api/docs/guides/streaming-responses)
- [OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)
- [Claude 流式消息](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Gemini GenerateContent](https://ai.google.dev/api/generate-content)

## 🗂 项目文件

```text
public/                 网页界面、样式和前端逻辑
test/                   本地模拟服务与自动化测试
server.mjs              本地 HTTP 服务
relay.mjs               中转站请求与流式响应处理
diagnostics.mjs         错误分类和诊断文案
start.bat / stop.bat    Windows 启停脚本
```

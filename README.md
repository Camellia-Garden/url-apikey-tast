# 月见中继站

在本机测试 API 中转站。输入 URL 和 API Key，选择接口协议，读取该 Key 可见的模型，然后发送一条短提示词验证实际调用。

## 运行

需要 Node.js 22 或更高版本，没有 npm 第三方依赖。

Windows 下双击 `start.bat`，服务就绪后会自动打开浏览器。双击 `stop.bat` 停止本地服务。默认地址是 [http://127.0.0.1:3177](http://127.0.0.1:3177)。

如果端口被占用，可以在 PowerShell 中运行 `./start.bat 3180`，停止时用 `./stop.bat 3180`。也可以在终端用 `npm start` 启动，按 `Ctrl+C` 停止。

```sh
npm start -- 3180
```

支持 URL 自带的中转站端口和路径前缀，例如 `http://127.0.0.1:8000/proxy/v1`。

## 接口

| 协议 | 模型列表 | 文本测试 |
| --- | --- | --- |
| OpenAI Responses | `GET /v1/models` | `POST /v1/responses` |
| OpenAI Chat Completions | `GET /v1/models` | `POST /v1/chat/completions` |
| Claude Messages | `GET /v1/models` | `POST /v1/messages` |
| Gemini | `GET /v1beta/models` | `POST /v1beta/models/{id}:generateContent` 或 `:streamGenerateContent` |

地址可填站点根地址、带版本号的地址或完整的生成接口地址。默认使用各协议的鉴权方式，也可在连接设置中切换为 Bearer。获取模型列表后，可以直接点击某个模型测试，也可以勾选后按顺序批量测试。如果中转站只开放生成接口，可以手填模型 ID。

接口实现参考 [OpenAI 流式响应](https://developers.openai.com/api/docs/guides/streaming-responses)、[OpenAI Chat API](https://developers.openai.com/api/reference/resources/chat)、[Claude 流式消息](https://platform.claude.com/docs/en/build-with-claude/streaming) 和 [Gemini GenerateContent](https://ai.google.dev/api/generate-content)。

支持 SSE 流式输出和普通 JSON 响应。响应头耗时从本机向中转站发出请求开始计算，首段耗时指收到第一段可显示文本的时间，总耗时包含读取响应。非流式响应显示总耗时，首段耗时留空。每次测试最多请求 256 个输出 token，实际测调用可能消耗中转站额度。列表可见与生成测试通过分别记录。本轮结果随页面刷新清空。

本地服务只监听回环地址。Key 随请求在内存中传给填写的中转站，不写入浏览器存储或应用文件。

## 结果诊断

调用测试与模型列表获取会结合错误码、错误类型、返回正文和 HTTP 状态显示原因、处理建议及判断依据。可以展开查看原始返回，调用测试中的复制按钮也会复制诊断。原始返回最多展示 6000 个字符，当前 Key 会被遮盖。

能识别客户端限制、余额不足、配额不足、分组或渠道不可用、模型不可用、鉴权失败、请求限流、上游异常、权限受限、内容拦截、请求不兼容、超时、连接失败、响应中断及响应格式异常。提示文案带有轻量的猫咪语气。

遇到“本站仅支持编程客户端使用……”一类提示时，结果显示“客户端限制”和“待客户端验证”。这表示当前网页测试方式被限制，模型的实际可用性仍需用该站支持的客户端验证。批量测试会分别统计通过、客户端限制和异常。

普通 JSON、纯文本、HTML 提示、HTTP 200 内嵌错误和流式错误事件均会进入诊断。正常模型输出只检查明确的客户端限制提示，解释或引用错误信息的回答仍作为正常文本处理。

不同中转站的自定义错误码含义可能不同。信息不足时会保留原始错误并显示“原因待确认”，仅有 HTTP 429 时显示“限流或配额限制”，方便进一步核对。

## 检查

```sh
npm test
```

测试使用本地模拟中转站。

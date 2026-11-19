# 月见中继站

在本机测试 API 中转站。输入 URL 和 API Key，选择接口协议，读取该 Key 可见的模型，然后发送一条短提示词验证实际调用。

## 运行

需要 Node.js 22 或更高版本，没有 npm 第三方依赖。

```sh
npm start
```

打开 [http://127.0.0.1:3177](http://127.0.0.1:3177)。如果端口被占用，可用 `npm start -- 3180` 指定其他本地端口。支持 URL 自带的中转站端口和路径前缀，例如 `http://127.0.0.1:8000/proxy/v1`。

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

## 检查

```sh
npm test
```

测试使用本地模拟中转站。

# 个人 Agent 工作台

基于 React、Hono 和 pi-durable 的本机工作台。由常驻后端持有 Agent，浏览器通过 REST 发送消息、SSE 观察状态；关闭浏览器不会取消生成。

## 运行

需要 Node.js 24 和 npm。

```sh
npm ci --ignore-scripts
npm run build
npm start
```

打开 `http://127.0.0.1:3100`，在左下角“设置”中填写 OpenAI Chat Completions 兼容接口地址、API Key、模型 ID 和名称。接口地址应包含服务要求的前缀，例如 `https://api.example.com/v1`。

开发时运行 `npm run dev`，访问 Vite 输出的地址。Vite 将 `/api` 请求转发到端口 3100 的后端。正式运行由后端在同一地址提供页面和接口。

`PORT` 可修改后端端口；`WORKBENCH_DATA_DIR` 可指定数据目录，默认是当前工作目录的 `.data`。该目录保存 SQLite 会话与任务、`models.json` 模型配置；API Key 以明文保存，整个目录已排除于 Git。请保留数据目录以继续使用已有会话，避免让多个后端进程同时打开同一目录。

后端重启后会由 pi-durable 恢复未完成任务，网页自动重连后继续观察。恢复可能重新请求中断的上游生成；已经完成的回复不会重新生成。

## 检查

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

浏览器测试自动启动隔离的真实后端、pi-durable 和临时 SQLite，只将外部模型服务替换为可暂停的本机流式服务。测试使用独立端口和临时数据目录，不读取个人配置。已有 Chromium 时可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定可执行文件。

规格、票据与领域约定见 [首版规格](docs/specs/personal-agent-workbench-v1.md)、[GitHub Issues](https://github.com/yyyac/durable/issues/1)、[领域语言](GLOSSARY.md) 和 [架构决定](docs/adr/0001-separate-agent-lifecycle-from-web-subscriptions.md)。

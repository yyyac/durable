# Pi Monorepo 各包使用调研

> 调研日期：2026-11-04 · 仓库：[earendil-works/pi](https://github.com/earendil-works/pi) `main` 分支（v1.5.0，CHANGELOG 标注发布于 2026-11-02）
> 调研方式：下载 main 分支 tarball（codeload.github.com，与 main 内容一致）只读分析源码 / README / docs / examples，npm 信息经 `npm view` 实时核验，未运行仓库内任何代码。
> 引用约定：仓库内路径均相对仓库根；对应 GitHub URL 形如 `https://github.com/earendil-works/pi/blob/main/<路径>`。
>
> 全部 11 个公开包均以 `@earendil-works/*` scope 发布于 npm（latest = 1.5.0，与仓库 HEAD 一致），可直接安装、直接 import。ESM-only，Node >= 22.19.0。
>
> **本文结构**：
>
> - **第一部分** · Monorepo 总览 + `pi-ai` / `pi-agent-core` / `pi-coding-agent`（SDK）/ `pi-tui` 使用指南
> - **第二部分** · `pi-durable` 深度调研（重点）
> - **第三部分** · 在 pi 上构建记忆 / 上下文管理架构（含 durable 执行模型源码核实）
> - **第四部分** · Cloudflare 与 pi-durable 的结合（DO 后端与部署接线）

---
# 第一部分 · Monorepo 总览与四个核心包（pi-ai / pi-agent-core / pi-coding-agent SDK / pi-tui）

> 调研日期：2026-11-04。来源：GitHub 仓库 [earendil-works/pi](https://github.com/earendil-works/pi) `main` 分支源码（通过 codeload.github.com 下载的 main 分支 tarball，内容与 main 一致；github.com 直连失败，改用 codeload）。npm 版本信息来自 `npm view` 实时查询。
> 所有仓库内路径均相对仓库根目录；对应的 GitHub URL 形如 `https://github.com/earendil-works/pi/blob/main/<路径>`。
> 按分工，`@earendil-works/pi-durable` 详见第二部分，本部分仅在总览的依赖图中列出。

---

## 一、Monorepo 总览

Pi 是 Mario Zechner（badlogic）开发的"minimal, extensible agent harness"——一个可深度定制的编码 agent 框架及其 CLI（来源: README.md）。monorepo 内含 CLI（`pi`）与一组可独立安装、独立发布的支撑库。

**基础事实：**

- **包管理器：npm workspaces**。根 `package.json` 的 `workspaces` 为 `packages/*`、`apps/*` 加几个示例目录；仓库以 `package-lock.json` 为依赖基准，无 pnpm-workspace.yaml（来源: package.json）。开发时用 `npm install --ignore-scripts`（README 明确 Pi 的正常 npm 安装不需要依赖生命周期脚本，来源: README.md）。仓库也提供脚本支持外部消费者用 pnpm 引用本地打包产物（`scripts/use-local-packages.mjs --package-manager pnpm`，来源: README.md "Using local packages outside the monorepo" 一节）。
- **Node 版本：>= 22.19.0**。根 README 写明 "Pi requires Node.js 22.19 or newer"；每个发布包的 `engines.node` 均为 `>=22.19.0`（来源: README.md、各 packages/*/package.json）。
- **发布范围**：所有公开包都在 `@earendil-works` scope 下；调研时（2026-11-04）npm `latest` dist-tag 与仓库版本一致，**全部为 1.5.0**。
- **文档站**：https://pi.dev/docs/latest （来源: README.md）。coding-agent 包内还有完整的 `docs/` 目录（约 40 篇 md），且这些 docs 与 `examples/`、`schemas/` 一并打进 npm 包（`files` 字段含 `docs`、`examples`、`schemas`，来源: packages/coding-agent/package.json）。
- **共同工程约定**：TypeScript（根 devDependencies 为 typescript 7.0.2）、ESM（`"type": "module"`）、Biome lint、vitest 测试、MIT 协议、作者 Mario Zechner（来源: package.json、packages/*/package.json）。

**全部 workspace 包（目录 → npm 名 / 是否发布）：**

| 目录 | npm 包名 | 发布 | 一句话说明（取自各包 package.json description 或根 README 表格） |
|---|---|---|---|
| packages/schema | `@earendil-works/pi-schema` | 是 | JSON Schema 校验（无 eval）：支持 draft 2020-12 与 7，编译为纯闭包 |
| packages/telemetry | `@earendil-works/pi-telemetry` | 是 | 厂商中立的 telemetry 契约、参考 adapter、一致性测试与类型化 schema |
| packages/tui | `@earendil-works/pi-tui` | 是 | 差分渲染的终端 UI 库 |
| packages/ai | `@earendil-works/pi-ai` | 是 | 统一多 provider LLM API（OpenAI、Anthropic、Google 等） |
| packages/mcp | `@earendil-works/pi-mcp` | 是 | 独立的 MCP（Model Context Protocol）客户端 |
| packages/codemode | `@earendil-works/pi-codemode` | 是 | 沙箱化 JS 执行，唯一能力是调用注入的工具 |
| packages/agent | `@earendil-works/pi-agent-core` | 是 | 带工具执行与状态管理的 agent 运行时 |
| packages/chord | `@earendil-works/chord` | 是 | 跨进程对象运行时：contracts、documents、store、links、热重载插件、HTTP、workers、web/终端客户端 |
| packages/durable | `@earendil-works/pi-durable` | 是 | 持久化会话/任务/文档运行时（本文不覆盖） |
| packages/env | `@earendil-works/pi-env` | 是 | Pi Durable 的远程执行环境：SSH 部署的小 daemon + ExecutionEnv 客户端 |
| packages/coding-agent | `@earendil-works/pi-coding-agent` | 是 | 交互式编码 agent CLI（含 SDK，见下） |
| packages/evals | `@earendil-works/pi-evals` | **否（private: true）** | 评测框架，仅内部使用 |
| apps/p2 | `p2` | **否（private: true）** | 内部应用，依赖几乎全部 pi 包 |

（来源: 各 packages/*/package.json、apps/p2/package.json、README.md "Packages" 表格）

**workspace 内部依赖图（依据各包 package.json `dependencies`）：**

```
pi-schema (叶子)          pi-telemetry (叶子)        pi-tui (叶子)
pi-mcp (叶子)             pi-codemode (叶子)

pi-ai ──────────► pi-schema, pi-telemetry
pi-agent-core ──► pi-ai, pi-schema
chord ──────────► pi-schema, pi-telemetry
pi-durable ─────► chord, pi-ai, pi-codemode, pi-schema, pi-telemetry
pi-env ─────────► chord, pi-durable
pi-coding-agent ► pi-agent-core, pi-ai, pi-codemode, pi-mcp, pi-tui
```

分层：`schema/telemetry/tui/mcp/codemode` 是底层独立库 → `pi-ai`（LLM 统一层）→ `pi-agent-core`（agent 循环层）→ `pi-coding-agent`（应用层：CLI + SDK）。`chord/pi-durable/pi-env` 是另一条持久化运行时支线。

---

## 二、pi-ai — `@earendil-works/pi-ai`

### 1. 定位与用途

pi-ai 是统一的多 provider LLM API 层：把 OpenAI、Anthropic、Google、Bedrock、OpenRouter、xAI、Groq、DeepSeek 等约 40 家 provider（以及任意 OpenAI 兼容端点如 Ollama/vLLM）统一到一个 `Models` 集合与统一的 `Context`/流式事件模型后面，并自带 auth 自动解析（env 变量、凭据存储、OAuth）、模型目录（catalog）、token/费用统计、工具调用（JSON Schema）、thinking/reasoning 统一选项、图像输入/生成、结构化分类（classifier）等。它在栈中处于 LLM 接入层，是 agent-core 与 coding-agent 的地基（来源: packages/ai/README.md）。

### 2. npm 包名 / 安装 / 版本

- 包名：`@earendil-works/pi-ai`（来源: packages/ai/package.json `name` 字段）
- 安装：`npm install @earendil-works/pi-ai`（README Installation 原文如此；工具参数示例另装 `@earendil-works/pi-schema`）
- 版本：仓库 1.5.0；npm `latest` dist-tag = **1.5.0**（2026-11-04 `npm view @earendil-works/pi-ai version dist-tags` 确认，已发布）
- engines: `node >= 22.19.0`；附带 `pi-ai` CLI bin；exports 含子路径 `./models`、`./compat`、`./providers/*`、`./api/*`、`./utils/*`、`./oauth` 等（来源: packages/ai/package.json）
- 运行时依赖：`@anthropic-ai/sdk`、`openai`、`@google/genai`、`@aws-sdk/client-bedrock-runtime` 等厂商 SDK + workspace 包 pi-schema、pi-telemetry（来源: packages/ai/package.json）

### 3. 主要导出 API

（来源: packages/ai/src/index.ts 的 export 语句、packages/ai/README.md）

- **类型/核心**：`Context`（可序列化会话上下文：systemPrompt + messages + tools）、`Tool`、`Message`/`UserMessage`/`AssistantMessage`/`ToolResultMessage`、`Usage`/`cost`、`StopReason`（stop/length/toolUse/error/aborted）。
- **Models 集合**：`createModels(options)`、`builtinModels()`（来自 `providers/all` 子路径，注册全部内置 provider）、`models.setProvider()` / `getModel(provider, id)` / `getModels()` / `getAvailable()` / `getAuth()` / `refresh()`；执行 API：`models.stream(model, context, options?)`、`models.complete(...)`、`streamSimple`/`completeSimple`（跨 provider 统一选项，如 `reasoning: 'medium'`）、`generateImages()`（图像模型）、`classify()`（classifier 模型）。
- **Provider 工厂（子路径导入，利于 tree-shaking）**：`@earendil-works/pi-ai/providers/anthropic` 的 `anthropicProvider()`、`.../providers/openai` 的 `openaiProvider()` 等，每家一个模块（来源: README "Provider Factories"）。
- **自定义 provider**：`createProvider({ id, auth, models, images?, classifiers? })`、`envApiKeyAuth(...)`。
- **Auth/凭据**：`CredentialStore` 契约（可注入持久化存储）、OAuth 工具（`./oauth` 子路径）。
- **工具校验**：`validateToolCall` / `validateToolArguments`（用 pi-schema 宽松矫正后校验）。
- **测试用**：`fauxProvider()` 及 `fauxText`/`fauxToolCall`/`fauxThinking` 等脚本化响应构造器（内存 provider，无需 API key，来源: README "Faux Provider for Tests"）。
- **流式事件**：`start / text_start / text_delta / text_end / thinking_* / toolcall_start|delta|end / done / error`，流对象可 `await s.result()` 取最终 `AssistantMessage`。
- **类型守卫**：`hasApi(model, 'anthropic-messages')`、`isModelType(model, 'image')`、`getSupportedThinkingLevels(model)`。
- **遥测**：`AI_TELEMETRY_SCHEMA`；span 形如 `pi.ai.request`。

### 4. 真实使用示例

以下为 README "Quick Start" 原文（来源: packages/ai/README.md，GitHub: https://github.com/earendil-works/pi/blob/main/packages/ai/README.md）：

```typescript
import { type Context, type Tool } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { obj, opt, str } from '@earendil-works/pi-schema';

// A Models collection with every built-in provider registered
const models = builtinModels();

// Sync lookup against the collection
const model = models.getModel('openai', 'gpt-4o-mini')!;

// Define tools with JSON Schema; pi-schema's builders also type the arguments
const tools: Tool[] = [{
  name: 'get_time',
  description: 'Get the current time',
  parameters: obj({
    timezone: opt(str({ description: 'Optional timezone (e.g., America/New_York)' }))
  })
}];

// Build a conversation context (easily serializable and transferable between models)
const context: Context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'What time is it?', timestamp: Date.now() }],
  tools
};

// Option 1: Streaming with all event types.
// Auth resolves through the provider (OPENAI_API_KEY from the environment here).
const s = models.stream(model, context);

for await (const event of s) {
  switch (event.type) {
    case 'start':
      console.log(`Starting with ${event.partial.model}`);
      break;
    case 'text_delta':
      process.stdout.write(event.delta);
      break;
    case 'toolcall_end':
      console.log(`\nTool called: ${event.toolCall.name}`);
      console.log(`Arguments: ${JSON.stringify(event.toolCall.arguments)}`);
      break;
    case 'done':
      console.log(`\nFinished: ${event.reason}`);
      break;
    case 'error':
      console.error(`Error: ${event.error.errorMessage}`);
      break;
  }
}

// Get the final message after streaming, add it to the context
const finalMessage = await s.result();
context.messages.push(finalMessage);

// Handle tool calls if any
const toolCalls = finalMessage.content.filter(b => b.type === 'toolCall');
for (const call of toolCalls) {
  const result = call.name === 'get_time'
    ? new Date().toLocaleString('en-US', {
        timeZone: call.arguments.timezone || 'UTC',
        dateStyle: 'full',
        timeStyle: 'long'
      })
    : 'Unknown tool';

  // Add tool result to context (supports text and images)
  context.messages.push({
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: 'text', text: result }],
    isError: false,
    timestamp: Date.now()
  });
}

// Continue if there were tool calls
if (toolCalls.length > 0) {
  const continuation = await models.complete(model, context);
  context.messages.push(continuation);
  console.log('After tool execution:', continuation.content);
}

console.log(`Total tokens: ${finalMessage.usage.input} in, ${finalMessage.usage.output} out`);
console.log(`Cost: $${finalMessage.usage.cost.total.toFixed(4)}`);

// Option 2: Get complete response without streaming
const response = await models.complete(model, context);
```

（注：为控制篇幅，switch 中 `text_start/text_end/thinking_*/toolcall_start/toolcall_delta` 分支已略去，其余逐字摘自 README。）

轻量注册单个 provider 的真实 import（README "Provider Factories" 原文）：

```typescript
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { createModels } from '@earendil-works/pi-ai';

const models = createModels();
models.setProvider(anthropicProvider());
```

（第二行 `createModels` 组合方式见 pi-agent-core README 与 README "Dynamic Providers" 一节，`anthropicProvider` 导入为原文。）

### 5. 与其他包的关系

- 依赖 `@earendil-works/pi-schema`（工具参数 schema 构建与校验）和 `@earendil-works/pi-telemetry`（span 契约）（来源: packages/ai/package.json dependencies）。
- 被 `pi-agent-core`、`pi-coding-agent`、`pi-durable` 直接依赖；是栈中所有 agent 能力的 LLM 出口。

### 6. 文档位置

- 包内唯一文档：`packages/ai/README.md`（约 2000 行，极详尽：providers、auth、tools、thinking、images、classification、custom providers、faux provider、OAuth、browser usage、tree-shaking 等）。无 docs/ 目录、无 examples/ 目录（示例全部内嵌 README）。
- npm 包只随包发布 `dist` 与 `README.md`（来源: packages/ai/package.json `files`）。
- 线上：https://www.npmjs.com/package/@earendil-works/pi-ai ；pi.dev 文档站主要覆盖 CLI 用法。

---

## 三、pi-agent-core — `@earendil-works/pi-agent-core`

### 1. 定位与用途

pi-agent-core 在 pi-ai 之上提供**有状态的 agent 运行时**：`Agent` 类封装"LLM 调用 → 工具执行 → 结果回填 → 继续 LLM 调用"的循环，带状态管理（`AgentState`：model/thinkingLevel/tools/messages）、可订阅的事件流（agent_start/turn_*/message_*/tool_execution_*）、steering（运行中插话）与 follow-up（排尾追加）队列、`beforeToolCall`/`afterToolCall` 钩子、`prepareRequest`/`finishTurn` 生命周期钩子、自定义消息类型（declaration merging）、可插拔的 `streamFn`（从而支持代理后端）。它不绑定任何具体产品：pi-coding-agent 的会话内核就是它（来源: packages/agent/README.md）。

### 2. npm 包名 / 安装 / 版本

- 包名：`@earendil-works/pi-agent-core`（来源: packages/agent/package.json）
- 安装：`npm install @earendil-works/pi-agent-core`（README "Installation" 原文）
- 版本：仓库 1.5.0；npm `latest` = **1.5.0**（2026-11-04 `npm view` 确认，已发布）
- engines: `node >= 22.19.0`；exports：`.` 与 `./package.json`（来源: packages/agent/package.json）
- 依赖：`@earendil-works/pi-ai`、`@earendil-works/pi-schema`（来源: packages/agent/package.json）

### 3. 主要导出 API

（来源: packages/agent/src/ 目录与 README）

- **`Agent` 类**：`new Agent({ initialState, streamFn, convertToLlm?, transformContext?, toolExecution?, beforeToolCall?, afterToolCall?, prepareRequest?, finishTurn?, identity?, getApiKey?, sessionId?, steeringMode?, followUpMode?, thinkingBudgets? })`；方法 `prompt(text|message, images?)`、`continue()`、`steer(msg)`、`followUp(msg)`、`abort()`、`waitForIdle()`、`subscribe(listener)`、`reset()`、`peekQueuedMessages()`、`clearAllQueues()` 等；状态经 `agent.state`（`model`、`thinkingLevel`、`tools`、`messages`、`isStreaming`、`streamingMessage` 等）。
- **`AgentTool<ParamsSchema>`**：`{ name, label?, description, parameters, execute(toolCallId, params, signal, onUpdate?), executionMode? }`；execute 抛错即工具错误（`isError: true` 回报给 LLM）；返回 `terminate: true` 可提示停止后续 LLM 调用。
- **`AgentMessage`**：LLM 消息超集，支持通过 `declare module "@earendil-works/pi-agent-core"` 的 declaration merging 增加自定义角色；`convertToLlm` 负责过滤转换为 LLM 消息。
- **事件**：`agent_start/agent_end/turn_start/turn_end/message_start/message_update/message_end/tool_execution_start/tool_execution_update/tool_execution_end`。
- **低层 API**：`agentLoop(messages, context, config, signal, streamFn)` 与 `agentLoopContinue(context, ...)`（无状态观察型循环）。
- **代理支持**：`streamProxy(model, context, { proxyUrl, authToken, ... })` 供浏览器经后端转发。
- 钩子语义（parallel/sequential 工具执行、finishTurn 的 `{action: 'continue'|'end'}` 等）详见 README "Event Flow" 与 "Agent Options"（来源: packages/agent/README.md）。

### 4. 真实使用示例

README "Quick Start" 原文（来源: packages/agent/README.md，GitHub: https://github.com/earendil-works/pi/blob/main/packages/agent/README.md）：

```typescript
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());
const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (!model) throw new Error("Model not found");

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model,
  },
  streamFn: models.streamSimple.bind(models),
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    // Stream just the new text chunk
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Hello!");
```

定义工具（README "Tools" 一节原文，节选）：

```typescript
import { obj, str } from "@earendil-works/pi-schema";

const readFileParameters = obj({
  path: str({ description: "File path" }),
});

const readFileTool: AgentTool<typeof readFileParameters> = {
  name: "read_file",
  label: "Read File",  // For UI display
  description: "Read a file's contents",
  parameters: readFileParameters,
  execute: async (toolCallId, params, signal, onUpdate) => {
    const content = await fs.readFile(params.path, "utf-8");
    return {
      content: [{ type: "text", text: content }],
      details: { path: params.path, size: content.length },
    };
  },
};

agent.state.tools = [readFileTool];
```

（`AgentTool` 类型在示例中由包导出，见上文 API 列表与 README 原文。）

另有 `examples/mcp-codemode/`：把 `@earendil-works/pi-mcp`（MCP 服务器连接）与 `@earendil-works/pi-codemode`（模型写 JS 调工具）包装成 `AgentTool` 的完整可运行示例（来源: packages/agent/examples/mcp-codemode、README "MCP and Codemode"）。

### 5. 与其他包的关系

- 依赖 `pi-ai`（streamFn 通常为 `models.streamSimple.bind(models)`）与 `pi-schema`（工具参数 schema）（来源: packages/agent/package.json）。
- 被 `pi-coding-agent` 依赖并作为其 `AgentSession` 的内核；与 pi-mcp/pi-codemode 通过 AgentTool 模式协同（示例级组合，非硬依赖）。

### 6. 文档位置

- `packages/agent/README.md`（约 570 行：事件流时序图、全部 Agent Options、状态管理、steering/follow-up、自定义消息、工具、代理、低层 API）。无 docs/ 目录。
- 示例：`packages/agent/examples/mcp-codemode/`。
- npm: https://www.npmjs.com/package/@earendil-works/pi-agent-core

---

## 四、pi-coding-agent（SDK / 编程嵌入视角）— `@earendil-works/pi-coding-agent`

### 1. 定位与用途（SDK 视角）

pi-coding-agent 是 Pi 的应用层：完整的编码 agent（内置 read/bash/edit/write 等工具、会话持久化、扩展/技能/主题/提示模板系统、CLI）。它同时是一个 **TypeScript SDK**：`createAgentSession()` 把整套编码 agent（模型运行时、工具、会话管理、扩展运行时、设置发现）嵌入任意 Node.js/Bun 进程——"direct TypeScript access to the agent, sessions, tools, models, and resources used by the command-line application"。适合构建自己的 agent 应用而不想自己拼装 agent-core + 工具集 + 会话存储的场景（来源: packages/coding-agent/docs/sdk.md）。语言无关或隔离子进程的替代方案是 CLI 集成（print/JSON/RPC 模式，docs/cli.md、docs/rpc.md）。

### 2. npm 包名 / 安装 / 版本

- 包名：`@earendil-works/pi-coding-agent`（来源: packages/coding-agent/package.json）
- 安装（作为库）：`npm install @earendil-works/pi-coding-agent`；作为 CLI 全局安装时官方推荐 `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`（README/getting started 原文）
- 版本：仓库 1.5.0；npm `latest` = **1.5.0**（2026-11-04 `npm view` 确认，已发布）
- engines: `node >= 22.19.0`；`bin`: `pi`；exports：`.`（SDK 入口 dist/index.js）与 `./rpc-entry`；npm 包附带的文件包括 `dist`、`docs`、`examples`、`schemas`（来源: packages/coding-agent/package.json）
- 依赖：`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@earendil-works/pi-codemode`、`@earendil-works/pi-mcp`、`@earendil-works/pi-tui` + 一批第三方库（jiti、typebox、quickjs-wasi 等）

### 3. 主要导出 API（SDK 面）

（来源: packages/coding-agent/docs/sdk.md、examples/sdk/README.md、src/index.ts export 语句）

- **`createAgentSession(options?)` → `{ session }`**：核心工厂。可选项包括 `modelRuntime`、`model`、`thinkingLevel`、`cwd`、`agentDir`、`tools`（内置工具 allowlist，默认 `["read","bash","edit","write"]`）、`noTools/excludeTools/customTools`、`resourceLoader`、`sessionManager`、`settingsManager`、`scopedModels` 等（来源: examples/sdk/README.md "Options" 表）。
- **`AgentSession`**：`prompt(text)`（含扩展命令与提示模板展开；流式期间必须二选一：`steer()` 或 `followUp()`）、`subscribe(event => ...)`（message_update / tool_execution_* / agent_settled 等会话级事件）、`abort()`、`waitForIdle()`、`getLastAssistantText()`、`messages`/`model`/`thinkingLevel`/`systemPrompt`/`getActiveToolNames()`、`dispose()`。
- **`SessionManager`**：会话持久化（JSONL entry 树、分支/fork）；`SessionManager.inMemory()` 用于不要会话文件的宿主。
- **`AgentSessionRuntime` + `createAgentSessionRuntime()`**：`newSession()/switchSession()/fork()/importFromJsonl()`，随 cwd 重建服务。
- **`ModelRuntime`**：`await ModelRuntime.create({ authPath, modelsPath })`，模型与认证的规范运行时；`setRuntimeApiKey(provider, key)`。
- **`DefaultResourceLoader`**：标准资源发现（扩展、skills、prompt templates、themes、上下文文件/AGENTS.md），支持 `systemPromptOverride`、`extensionFactories`、`skillsOverride` 等覆盖点。
- **`SettingsManager`**：`SettingsManager.create(cwd, agentDir)` / `SettingsManager.inMemory()`。
- **扩展工厂**：`createCodemodeExtension()`、`createToolSearchExtension()`、`createMcpExtension()`（CLI 内建，SDK 会话需手动加进 `extensionFactories`）（来源: docs/sdk.md "Codemode and MCP"）。
- 其他导出：`ModelRegistry`、`DefaultPackageManager`、`createEventBus`、`convertToLlm`、`main`（CLI 入口）、编辑 diff 工具函数等（来源: src/index.ts）。

### 4. 真实使用示例

docs/sdk.md 开篇原文（来源: packages/coding-agent/docs/sdk.md）：

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession();

try {
  await session.prompt("What files are in the current directory?");
  console.log(session.getLastAssistantText());
} finally {
  session.dispose();
}
```

完整最小示例（仓库内类型检查过的示例文件原文，来源: packages/coding-agent/examples/sdk/01-minimal.ts）：

```typescript
/**
 * Minimal SDK Usage
 *
 * Uses all defaults: discovers skills, extensions, tools, context files
 * from cwd and ~/.pi/agent. Model chosen from settings or first available.
 */

import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession();

try {
	session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
	});

	await session.prompt("What files are in the current directory?");
	session.state.messages.forEach((msg) => {
		console.log(msg);
	});
	console.log();
} finally {
	session.dispose();
}
```

进阶组合（examples/sdk/README.md "Quick Reference" 原文节选：自定义模型 + 只读工具 + 内存会话 + 完全接管资源发现）：

```typescript
import { getModel } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();

// Custom model
const model = getModel("anthropic", "claude-opus-4-5");
const { session } = await createAgentSession({ model, thinkingLevel: "high", modelRuntime });

// Read-only
const { session: ro } = await createAgentSession({ tools: ["read", "grep", "find", "ls"], modelRuntime });

// In-memory
const { session: mem } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

// Full control
const customRuntime = await ModelRuntime.create({
  authPath: "/my/app/auth.json",
  modelsPath: "/my/app/models.json",
});
await customRuntime.setRuntimeApiKey("anthropic", process.env.MY_KEY!);

const resourceLoader = new DefaultResourceLoader({
  systemPromptOverride: () => "You are helpful.",
  extensionFactories: [myExtension],
  skillsOverride: () => ({ skills: [], diagnostics: [] }),
  agentsFilesOverride: () => ({ agentsFiles: [] }),
  promptsOverride: () => ({ prompts: [], diagnostics: [] }),
});
await resourceLoader.reload();

const { session: full } = await createAgentSession({
  model,
  modelRuntime: customRuntime,
  resourceLoader,
  tools: ["read", "bash", "my_tool"],
  customTools: [myTool],
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory(),
});
```

（为篇幅将 Quick Reference 中四个独立片段合并为一段连续代码；每个片段本身逐字来自 examples/sdk/README.md，变量名 `ro`/`mem`/`full` 为避免重复声明所加。）

SDK 示例目录共 14 个类型检查过的示例：01-minimal 到 14-codemode-mcp（模型、system prompt、skills、工具、扩展、context files、prompt templates、API key/OAuth、settings、sessions、full control、session runtime、codemode+MCP），运行方式 `node examples/sdk/01-minimal.ts`（来源: packages/coding-agent/examples/sdk/README.md）。真实世界集成案例：OpenClaw（来源: README.md）。

### 5. 与其他包的关系

处于栈顶：直接依赖 `pi-agent-core`（Agent 循环内核）、`pi-ai`（LLM 层）、`pi-tui`（交互式终端界面）、`pi-mcp`（MCP 客户端）、`pi-codemode`（沙箱 JS 工具执行）（来源: packages/coding-agent/package.json dependencies）。SDK 的 `AgentSession` 是对 `Agent`（pi-agent-core）的高层封装，补上会话持久化、工具实现、资源发现、扩展系统。

### 6. 文档位置

- **SDK 文档**：`packages/coding-agent/docs/sdk.md`（147 行，含 session 生命周期、prompt/steer/followUp、事件订阅、各边界注入点）。
- **示例**：`packages/coding-agent/examples/sdk/`（14 个 ts 文件 + README）；另有 `examples/rpc-client.ts`、`examples/rpc-extension-ui.ts`、`examples/extensions/`。
- **包内完整 docs 目录**（~40 篇）：configuration、extensions、skills、prompt-templates、packages、rpc、cli、json、session-format、message-types、models、providers、security、containerization 等（来源: packages/coding-agent/docs/ 目录列表）；docs.json 为文档站配置。
- **线上文档站**：https://pi.dev/docs/latest ；npm: https://www.npmjs.com/package/@earendil-works/pi-coding-agent
- 注意：docs 与 examples 随 npm 包一起分发（package.json `files` 含 `docs`、`examples`），装完包即可在 node_modules 里直接阅读。

---

## 五、pi-tui — `@earendil-works/pi-tui`

### 1. 定位与用途

pi-tui 是通用终端 UI 框架（不限于 agent 场景）：差分渲染 + CSI 2026 同步输出实现无闪烁刷新；组件化（`Component` 接口：`render(width) => string[]`）、焦点管理、overlay 系统、鼠标支持（alt-screen 下 SGR 归一化 + 命中测试）、OKLCH/OKHSL 颜色系统、Kitty/iTerm2 图片协议、Markdown 渲染组件、自动补全、keybinding 工具。两个渲染器：`TuiMainScreen`（主屏、保留 scrollback）与 `TuiAltScreen`（交替屏、应用自管滚动视口 + VStack/HStack/ScrollView 布局）。它是 pi CLI 交互界面的基础，但在依赖上完全独立于其他 pi 包（来源: packages/tui/README.md）。

### 2. npm 包名 / 安装 / 版本

- 包名：`@earendil-works/pi-tui`（来源: packages/tui/package.json）
- 安装：`npm install @earendil-works/pi-tui`（标准 npm 安装；README 无单独 Installation 一节，安装即此形式）
- 版本：仓库 1.5.0；npm `latest` = **1.5.0**（2026-11-04 `npm view` 确认，已发布）
- engines: `node >= 22.19.0`；无 exports map，使用 `main: dist/index.js` + `types`（来源: packages/tui/package.json）
- 依赖（全部为第三方小依赖，**无任何 @earendil-works workspace 依赖**）：`get-east-asian-width`、`marked`、`marked-cjk-friendly`（来源: packages/tui/package.json）；devDependencies 含 `@xterm/headless`（测试用）

### 3. 主要导出 API

（来源: packages/tui/README.md、packages/tui/src/index.ts export 语句）

- **TUI 接口与渲染器**：`TUI`（接口）、`TuiMainScreen`、`TuiAltScreen`；`addChild/removeChild/start/stop/requestRender/setFocus/showOverlay/hideOverlay/hasOverlay/addInputListener/setLayoutRoot/onDebug`；`isViewportTUI(tui)` 守卫。
- **终端抽象**：`Terminal` 接口 + `ProcessTerminal`（process.stdin/stdout 实现）、`VirtualTerminal`（测试用，基于 `@xterm/headless`）、`StdinBuffer`。
- **内建组件**：`Text`、`TruncatedText`、`Input`、`Editor`（多行编辑器，onSubmit、主题）、`Markdown`、`Loader`、`CancellableLoader`、`SelectList`、`SettingsList`、`Spacer`、`Image`（Kitty/iTerm2 协议）、`Box`、`Container`、`VStack`、`HStack`、`ScrollView`、`MouseRegion`。
- **键盘**：`matchesKey(data, 'ctrl+c')`、`Key` 辅助对象、keybindings 模块。
- **颜色**：`parseColor`（接受 `#hex`、`oklch()`、`okhsl()`、ANSI 索引）、`mixColors`、`rgbColor`、`colorToRgb`、`styleText`、`foregroundAnsi`、`getTerminalColorMode`。
- **鼠标类型**：`TuiMouseEvent`、`TuiMouseEventResult`（handled/capture/focus/render）。
- **IME/焦点**：`Focusable` 接口、`CURSOR_MARKER`、`renderFakeCursor`。
- **工具函数**：`visibleWidth`、`truncateToWidth`、`wrapTextWithAnsi`、`fuzzyMatch/fuzzyFilter`、`renderLatex`、`getNativeClipboard` 等。
- 另有可选 native 模块（`native/` 目录，`build:native:*` 脚本）用于终端修饰键检测等增强。

### 4. 真实使用示例

README "Quick Start" 原文（来源: packages/tui/README.md，GitHub: https://github.com/earendil-works/pi/blob/main/packages/tui/README.md）：

```typescript
import { type TUI, Text, Editor, ProcessTerminal, TuiMainScreen, matchesKey } from "@earendil-works/pi-tui";

// Create terminal
const terminal = new ProcessTerminal();

// Create the default main-screen renderer through the shared TUI interface
const tui: TUI = new TuiMainScreen(terminal);

// Add components
tui.addChild(new Text("Welcome to my app!"));

import { defaultEditorTheme as editorTheme } from './test/test-themes.ts';
const editor = new Editor(tui, editorTheme);
editor.onSubmit = (text) => {
  console.log("Submitted:", text);
  tui.addChild(new Text(`You said: ${text}`));
};
tui.addChild(editor);

// Focus the editor so it receives keyboard input
tui.setFocus(editor);

// In raw mode Ctrl+C doesn't send SIGINT — intercept it here to allow exit
tui.addInputListener((data) => {
  if (matchesKey(data, 'ctrl+c')) {
    tui.stop();
    process.exit(0);
  }
});

// Start
tui.start();
```

（注：示例中的 `import ... from './test/test-themes.ts'` 为 README 原文写法，指向包内测试主题文件；实际使用时可换成自己的 `EditorTheme`。）

自定义组件示意（README "Creating Custom Components" 原文节选）：

```typescript
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

class MyInteractiveComponent implements Component {
  private selectedIndex = 0;
  private items = ["Option 1", "Option 2", "Option 3"];

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (matchesKey(data, Key.enter)) {
      /* select */
    }
  }

  render(width: number): string[] {
    return this.items.map((item, i) => {
      const prefix = i === this.selectedIndex ? "> " : "  ";
      return truncateToWidth(prefix + item, width);
    });
  }

  invalidate(): void {}
}
```

（为篇幅略去 Key.down/escape 分支与回调字段，结构逐字来自 README。）

### 5. 与其他包的关系

依赖图中的叶子：不依赖任何 @earendil-works 包。被 `pi-coding-agent` 依赖（pi CLI 的交互式 TUI）；apps/p2 也用它。与 pi-ai/pi-agent-core 无直接关系，可完全独立用于任何终端应用。

### 6. 文档位置

- `packages/tui/README.md`（约 950 行：渲染器、颜色、alt-screen 布局、overlay、Component/Focusable 接口、鼠标、全部内建组件、autocomplete、key detection、Terminal 接口、工具函数、自定义组件指南、文末完整 Example）。无 docs/ 目录、无独立 examples/ 目录（README 文末有 "Example" 完整程序段）。
- npm: https://www.npmjs.com/package/@earendil-works/pi-tui
- 相关：coding-agent 侧的 `docs/tui.md` 讲 pi CLI 如何使用 TUI（主题、键位等）。

---

## 附：快速对照表

| 包 | npm 名 | latest | 一句话 | 文档 | 示例 |
|---|---|---|---|---|---|
| pi-ai | `@earendil-works/pi-ai` | 1.5.0 | 统一多 provider LLM API（流式/工具/费用/auth） | 包内 README（约 2000 行） | README 内嵌 |
| pi-agent-core | `@earendil-works/pi-agent-core` | 1.5.0 | 有状态 agent 循环 + 工具执行 + 事件流 | 包内 README（约 570 行） | examples/mcp-codemode |
| pi-coding-agent | `@earendil-works/pi-coding-agent` | 1.5.0 | 编码 agent CLI + 嵌入式 SDK（createAgentSession） | docs/ 约 40 篇 + sdk.md + pi.dev | examples/sdk 14 个 |
| pi-tui | `@earendil-works/pi-tui` | 1.5.0 | 差分渲染终端 UI 框架 | 包内 README（约 950 行） | README 内嵌 + 文末 Example |

（版本查询时间 2026-11-04，`npm view <pkg> version dist-tags`，全部命中 npm registry。）

---

# 第二部分 · pi-durable 深度调研

> 调研对象：`@earendil-works/pi-durable`，仓库 [earendil-works/pi](https://github.com/earendil-works/pi) 的 `packages/durable`。
> 调研方式：克隆仓库 main 分支 HEAD 快照（v1.5.0，CHANGELOG 标注发布于 2026-11-02），只读分析源码、README、spec、examples 与仓库内集成代码。
> 引用约定：`packages/durable/...` 等路径均相对仓库根；GitHub blob 链接基于 main 分支。

---

## 1. 它解决什么问题（它自己的话）

README 第一段（来源: packages/durable/README.md）：

> A durable agent harness. Conversations, model turns, tool calls, and your own state are committed to storage before anything is shown. If the process dies mid-turn, reopening the storage picks the work up where it stopped; a model request it died during counts as a failed attempt and is retried, so a request that keeps killing the process ends.

即：pi-durable 是一个**持久化（durable）agent 运行时/harness**，把「会话（conversation）、模型回合（turn）、工具调用、应用自有状态」全部以原子提交（commit）方式先落盘、再对外可见；进程在任意时刻崩溃后，重新打开存储即可从最后一个 checkpoint 继续，正在进行的模型请求计为一次失败尝试并按重试策略重试，确定性崩溃最终会被 `restartLimit` 终止。npm 描述为 "Durable conversation, task, and document runtime for Pi"（来源: packages/durable/package.json）。

spec.md 给出的核心规则（来源: packages/durable/docs/spec.md §开篇）：

> A Session atomically commits immutable entries, full task records, and Chord-tracked documents. Only committed state is observable.

覆盖的能力面（README 目录结构，来源: packages/durable/README.md）：

- 持久化与恢复（Persist and Resume）、睡眠/唤醒（sleeping tasks、Cloudflare Durable Object 的 `onWake`）、崩溃循环保护（crash loops / restartLimit）；
- 扩展（Extension）机制：tools、system prompt sections、hooks、wrappers、tasks 的命名捆绑与注册表（Registry）；
- 内置编码工具（read / write / edit / bash / powershell）、Code Mode（QuickJS 沙箱内用 JS 编排工具调用）、tool_search（大规模工具集延迟加载）；
- 每会话 agent 配置（model / thinkingLevel / extensions / tools / cwd / maxTurns）；
- 忙碌会话的 inbox 语义（steer / followUp / reject）、reset 与 handoff、compaction（上下文压缩）、fork 与子会话；
- 子 agent（前台/后台）、child tasks、task graph 观察视图；
- 自有状态（typed JSON documents）、用量与成本（usage）、多种存储后端（内存/SQLite/JSONL/IndexedDB/Cloudflare DO）。

README 顶部标注（来源: packages/durable/README.md 第 3 行）：

> **Experimental.** The API changes without notice between releases.

---

## 2. 发布状态与安装（已核实）

- **npm 包名：`@earendil-works/pi-durable`**（来源: packages/durable/package.json `"name"` 字段）。
- **版本：1.5.0**；`npm view @earendil-works/pi-durable version dist-tags` 实测返回 `version = '1.5.0'`，`dist-tags = { latest: '1.5.0' }`，与仓库 HEAD 一致——**已发布、可直接 import 使用**。
- License: MIT；author: Earendil Works；`engines: { "node": ">=22.19.0" }`（来源: packages/durable/package.json）。
- ESM-only（`"type": "module"`），入口 `dist/index.js`，`sideEffects: false`。

安装命令（来源: packages/durable/README.md "Installation"）：

```bash
npm install @earendil-works/pi-durable @earendil-works/pi-ai @earendil-works/chord
```

运行时依赖（来源: packages/durable/package.json `dependencies`）：`@earendil-works/chord`、`@earendil-works/pi-ai`、`@earendil-works/pi-codemode`、`@earendil-works/pi-schema`、`@earendil-works/pi-telemetry`、`@silvia-odwyer/photon`（图片处理 WASM）、`diff`。

### 子路径导出（import 时可用的全部入口）

来源: packages/durable/package.json `exports`。注意源码键 `source` 仅是 monorepo 内部 `--conditions=source` 直跑 TS 用的，外部用户走 `dist`：

| 子路径 | 内容 |
|---|---|
| `.`（根） | Harness、defineTool、defineTask 等全部核心 API（见 §4） |
| `/env`、`/env/node` | ExecutionEnv 抽象接口；Node 实现 `NodeExecutionEnv` |
| `/codemode` | QuickJS 沙箱 code mode 扩展 `createCodemodeExtension` |
| `/tool-search` | `createToolSearchExtension()`（大量工具的延迟加载/搜索） |
| `/tools` | 内置编码工具与 `CodingTools` 扩展 |
| `/images`、`/images/node`、`/images/cloudflare` | Photon WASM 图片处理器 |
| `/storage/memory`、`/storage/indexeddb`、`/storage/jsonl`、`/storage/jsonl/node`、`/storage/store`、`/storage/sqlite`、`/storage/sqlite/node`、`/storage/sqlite/cloudflare` | 各存储后端 |
| `/testing` | 存储/环境一致性测试套件（`registerStorageConformance` 等） |

---

## 3. 核心概念与架构

### 3.1 概念清单（README "Concepts"，来源: packages/durable/README.md）

- **Harness**：一个打开的存储 + 在其上运行 agent 的全部机器。所有变更走同一条原子提交流水线（mutation line），提交落盘前任何东西都不可见。
- **Conversation**：一份 transcript。`root()` 首次使用时创建根会话；可再创建、可 fork。Handle 不持状态，按 `id` 比较。
- **Entry**：不可变 transcript 记录：`pi.user` / `pi.assistant` / `pi.tool-result` / `pi.system` / `pi.reset` / `pi.compaction`，或自定义 kind。模型只看最近一次 reset 之后的 entries。
- **Commit**：原子写。`conversation.commit((tx) => ...)` 可同时 append entries、改 documents、建 tasks——要么全存、要么全不存。
- **Document**：与 transcript 同存、在 commit 中修改的 typed JSON 状态。内置：`pi.agent`（每会话 agent 选择）、`pi.provider`（provider 侧会话身份 UUIDv7）、`pi.live`（运行中 generation/tool/compaction、runFailure）、`pi.inbox`（排队 submissions）、`pi.usage`（花费）。
- **Task**：持久状态机，每步保存 checkpoint，重启后从上一个 checkpoint 继续。每个 task 有 owner（其会话或另一 task）。内置任务把「回答」跑成任务链：`pi.generation` 调模型、拥有其 tool calls 的 `pi.tool` tasks，等它们完成再把 run 交给下一个 generation。
- **Submission**：交给会话的东西——用户输入、entry 写入或 continue——可等待。
- **Turn / Run**：turn = 一次模型响应 + 其工具调用；run = 从一个输入到最终答案的全部 turns。
- **Extension**：命名捆绑的 tools / sections / hooks / wraps / tasks。
- **Registry**：本进程安装的 extensions。可在 Harness 运行中变化（热替换/重载），新工作使用新状态。Registry 里什么都不落盘；会话只存扩展名。
- **Agent**：会话运行配置（model、thinking level、extensions、tools、instructions、cwd），按名字存在 `pi.agent`，每次使用时对 registry 解析。

一次被回答的输入在 entries/tasks 层面的形状（README 原图，来源: packages/durable/README.md "Concepts"）：

```text
submit(input) → pi.user
  pi.generation → pi.system (only if the prompt or tools changed), pi.assistant (tool calls)
    pi.tool × n → pi.tool-result × n   (owned by the generation, which waits for them)
  pi.generation → pi.assistant (answer) → submission done
```

### 3.2 分层与依赖方向（来源: packages/durable/README.md 第 7 行；packages/durable/package.json）

- 建立在 **`@earendil-works/pi-ai`**（模型访问）与 **`@earendil-works/chord`**（文档状态/观察/watch 抽象）之上；工具参数 schema 用 `pi-schema`；telemetry 用 `pi-telemetry`；code mode 沙箱用 `pi-codemode`。
- 所有 async API 都要求一个 Chord `Context`（携带 cancellation 与 telemetry span）；`BACKGROUND_CONTEXT` 永不取消。取消一个 wait 只取消等待本身，从不取消工作（来源: README "Quick Start" 注释）。

### 3.3 存储设计与目录布局

SQLite 后端的表结构（来源: packages/durable/src/storage/sqlite/migrations.ts）：`durable_metadata`、`record_ids`、`conversations`、`entries`、`tasks`、`submissions`、`documents`、`document_revisions`。SQLite 用 WAL + `synchronous = NORMAL`：「commits survive process crashes; the newest may be lost on power or host failure」（来源: README "Storage" 表格）。

五个后端（README "Storage" 表格，来源: packages/durable/README.md）：

| 后端 | 导入 | 说明 |
|---|---|---|
| Memory | `MemoryStorage`（包根） | 不持久化 |
| IndexedDB | `IndexedDbStorage.open(name)`（`/storage/indexeddb`） | 浏览器 |
| SQLite | `openNodeSqliteStorage(file)`（`/storage/sqlite/node`） | 单数据库文件；Node 内置 SQLite |
| JSONL | `openNodeJsonlStorage(directory, context)`（`/storage/jsonl/node`） | 单目录 append-only 文件；全历史同时驻内存，长跑 agent 建议 SQLite |
| Cloudflare DO | `openDurableObjectSqliteStorage(ctx.storage)`（`/storage/sqlite/cloudflare`） | 一个 SQLite-backed Durable Object，commit 即其存储事务 |

约束：**一个进程独占一个 storage，无跨进程锁**（README 原文 "One process owns a storage at a time; there is no cross-process locking"）。SQLite 可用 `{ prefix: "pi_" }` 做表名前缀以便共享数据库（README "Storage"）。

提交可靠性设计（来源: packages/durable/docs/spec.md §1 invariants；README "Errors"）：

1. 存储错误 → 整个 Harness 终结（`SessionFailed`），必须 reopen 恢复；commits 原子所以存储一致，相同 `requestId` 重提交会找回已 admit 的 submission。
2. 非法读 → 只失败该调用（`StorageRequestError`）。
3. 你的代码抛错 → 只影响自己的单元（task faulted / tool error result / hook 被报告并跳过 / commit 回滚）。

性能机制：**group commit**（一次存储调用批量存积压的 commits，来源: packages/durable/docs/group-commit.md；CHANGELOG 1.5.0）与 **deferred commits**（流式部分答案/工具输出先在内存与 watch 可见、稍后落盘，最多丢失约 `progress.persistWithinMs`（默认 1000ms）窗口，来源: README "Watching a Conversation"；spec §4.1）。

### 3.4 主要源码组件（来源: packages/durable/src/ 目录）

- `session/session.ts`（2105 行）：`SessionImpl`——mutation line、事务、document 生命周期、watch 分发。
- `harness/harness.ts`：`HarnessImpl` + `Harness.open()`；ConversationImpl。
- `harness/scheduler.ts`：任务调度器（pending/running/waiting/sleeping/completing、restart 计数、wake 语义）。
- `harness/generation.ts` / `tool.ts` / `compaction.ts`：三个内置任务 `pi.generation` / `pi.tool` / `pi.compaction`。
- `harness/submissions.ts`、`inbox.ts`、`live.ts`、`usage.ts`、`provider.ts`、`agent.ts`：对应内置 documents。
- `harness/registry.ts`：`createRegistry()`；内置任务 `BUILTIN_TASKS = [GenerationTask, ToolTask, CompactionTask]` 不可移除（来源: src/harness/registry.ts 注释）。
- `harness/view.ts`、`transcript.ts`、`task-graph.ts`：会话结构视图 / 客户端 transcript 增量合并 / 任务图视图。
- `storage/*`：五后端 + 通用 `Storage` 契约（`commit(batches, receive, context)` 群提交接口）。
- `env/*`：`ExecutionEnv` 抽象（文件系统、exec、watch）与 Node 实现。
- `codemode/*`、`tool-search/*`、`images/*`、`testing/*`：对应子路径模块。

---

## 4. API 全貌

以下为包根 `src/index.ts` 的**全部运行值（非 type）导出**（来源: packages/durable/src/index.ts），按类别整理、附一句话说明（说明综合导出处的 JSDoc 与 README）：

### Harness / 会话生命周期

| 导出 | 说明 |
|---|---|
| `Harness` | `Harness.open(storage, options, context)` 打开一个 Harness；实例方法见 §5.3 |
| `createSession` | 底层 Session 构造（Harness 之下那一层的入口） |
| `ROOT_CONVERSATION_ID` | 根会话的保留 ID 常量 |
| `createRegistry()` | 创建扩展注册表（自动含三个内置任务） |
| `registryReader()` | 用 snapshot+subscribe 包装的只读 registry 视图（p2 用于把 Chord registry 桥接进来） |

### Entry 定义（transcript 记录）

| 导出 | 说明 |
|---|---|
| `defineEntry` | 定义自定义 entry kind |
| `UserEntry` / `AssistantEntry` / `ToolResultEntry` / `SystemEntry` / `ResetEntry` / `CompactionEntry` | 内置 entry 类型（kind 分别为 `pi.user` 等） |

### Document 定义（自有状态）

| 导出 | 说明 |
|---|---|
| `defineDoc` | 定义 typed JSON document（kind/version/scope/history/fork/checkpointWhen） |
| `defineDocFamily` | 带 key 的 document 家族 |

### Task 定义

| 导出 | 说明 |
|---|---|
| `defineTask` | 定义持久状态机任务：`{ name, version, initial, phases, abort, migrate?, hooks? }` |
| `GenerationTask` / `ToolTask` / `CompactionTask` | 内置任务（可被 hook：`hook(GenerationTask, {...})` 等） |

### Extension / Tool / Prompt / Hook DSL

| 导出 | 说明 |
|---|---|
| `defineExtension` | 类型化扩展对象（name + tools/sections/hooks/wraps/tasks） |
| `defineTool` | 定义工具：name/description/parameters(JSON Schema)/execute/可选 replay、callers、deferred、structuredOutputSchema |
| `section(key, render, {tag})` | system prompt 段 |
| `hook(task, handlers)` | 对某任务注册 hooks（如 `beforeTool`/`afterTool`/`beforeRequest`/`onYield`/`afterRun`） |
| `runEndTask(task, input)` | `afterRun` hook 返回的要运行的 durable 任务 |
| `wrapTool` / `wrapSection` | 按名字装饰胜出的 tool/section |

### 内置 documents（watch/snapshot 用的 token）

`AgentDoc`、`LiveDoc`、`InboxDoc`、`ProviderDoc`、`UsageDoc`、`NestedCallDoc`，及常量 `DEFAULT_HARNESS_IDENTITY`、`DEFAULT_RETRY_POLICY`、`DEFAULT_COMPACTION_POLICY`、`DEFAULT_PROGRESS_POLICY`、`DEFAULT_RESTART_LIMIT`；配置函数 `configure(tx, conversationId, change)`（在事务内改 agent）。

### 视图 / 客户端辅助

| 导出 | 说明 |
|---|---|
| `ConversationTranscript` | 客户端窗口化 transcript 的合并/补页/断线恢复（配 `conversation.watch()`） |
| `DURABLE_TELEMETRY_SCHEMA` | 类型化 telemetry span/event/metric 的声明文档 |

### 错误类型

`ConversationBusy`、`ConversationIdle`、`ReadAfterWrite`、`ReadOnlySession`、`SessionFailed`、`StorageRequestError`。

### Storage

根路径导出 `MemoryStorage`；其余后端在子路径（见 §2 表）。

### 主要 type 导出（分组概览，来源: src/index.ts 第 76–233 行）

- 会话/句柄：`Conversation`、`ConversationHandle`（task/tool 用的受限句柄）、`ConversationCreateOptions`、`ConversationInit`、`Submission`、`SubmissionDraft`/`InputSubmissionDraft`、`SettledSubmissionRecord`
- 配置：`HarnessOptions`、`HarnessSettings`、`Settings`、`Agent`、`AgentChange`、`AgentState`、`ModelRef`、`EnvTarget`、`Wake`
- 任务：`Task`、`TaskDefinition`、`TaskState`、`TaskOutcome`、`TaskRuntime`、`TaskRecord`、`TaskOptions`、`NextTaskState`、`RunningTask`、`SettledTask`、`PhaseHandler`
- 工具：`ToolRegistration`、`ToolExecutionApi`、`ToolExecutionResult`、`ToolHooks`、`ToolHookCall`、`ToolControl`、`ToolDiagnostic`、`NestedToolExecutionResult`、`ToolExecutionMode`
- Hook：`HookApi`、`HookRegistration`、`HookResult`、`HooksOf`、`GenerationHooks`、`CompactionHooks`、`RunEndTask`、`RunSummary`
- Session/存储层：`Session`、`Tx`、`Storage`、`StorageWrite`、`CommitOptions`/`CommitPersistence`/`CommitResult`、`Observer`、`Observation`、`CommitObserver`/`CommitObservation`/`CommitPublication`、`Report`/`ReportInfo`、`SessionEnd`、`SetTimer`、`Cursor`/`Page`/`Seq`、`Id`/`EntryId`/`TaskId`/`SubmissionId`/`DocumentId`/`ConversationId`
- 视图：`ConversationView`、`ConversationWindow`、`ConversationWatch`、`ContextView`、`TranscriptItem`/`TranscriptView`、`TaskGraph`/`TaskGraphNode`/`TaskGraphWatch`、`BlockedReason`、`HarnessInspection`/`TaskInspection`
- documents：`DocDefinition`、`DocToken` 系列（Session/Conversation/Task × 单/家族 × latest/rewindable）、`DocumentAddress`/`DocumentWatch`/`DocumentObserver` 等

---

## 5. 使用指南（重点）

### 5.1 前置条件

- Node.js >= 22.19.0（package.json engines；Node 内置 SQLite 由此可用）。
- 一个 pi-ai `Models`（模型目录 + provider）。真实 provider 走环境变量，如 `openaiProvider()` 读 `OPENAI_API_KEY`（来源: README "Quick Start"；test/examples/15-real-model.ts）。
- Chord 的 `Context`：最简单用 `BACKGROUND_CONTEXT`。

### 5.2 最小可用示例（README "Quick Start" 原文，来源: packages/durable/README.md）

```typescript
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { AssistantEntry, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

const context = BACKGROUND_CONTEXT;

const models = createModels();
models.setProvider(openaiProvider()); // reads OPENAI_API_KEY

const harness = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, context);
const root = await harness.root(context, { agent: { model: { provider: "openai", modelId: "gpt-6-sol" } } });

const submission = await root.submit({ type: "input", content: "What is the capital of France?" }, context);
const settled = await submission.wait(context);
if (settled.status === "done" && settled.type === "input") {
	const answer = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
	console.log(answer?.model?.[0]);
}
await harness.close(context);
```

README 对这段代码的逐条解释（来源: README "Quick Start"）：

- `Harness.open()` 在存储后端之上打开一个 Session；`MemoryStorage` 全在内存。
- `root()` 返回根会话，首次使用时按给定 agent 选择创建。会话是 immutable entries 的 transcript。
- `submit()` 持久地 admit 输入并返回 `Submission`；内置 generation 任务调模型并 append 答案。
- `wait()` 在输入被回答（`done`）或失败（`unanswered` + reason）时 resolve。

注（2026-11-05 源码复核）：`settled.answer` 是已经保存的答案的 `EntryId`；`tx.entry(AssistantEntry, settled.answer)` 是读取该 entry，不是追加或手动落盘。内置 generation 任务已自动追加答案，调用方不应重复追加。接口证据见 [Tx.entry 定义](https://github.com/earendil-works/pi/blob/main/packages/durable/src/types.ts) 与 [generation 实现](https://github.com/earendil-works/pi/blob/main/packages/durable/src/harness/generation.ts)。examples 里同型代码见 `test/examples/13-chat.ts`（用 faux provider，无需 API key）。

### 5.3 生命周期操作（真实 API 签名，来源: packages/durable/src/harness/types.ts `interface Harness` / `interface Conversation`；src/harness/harness.ts）

**Harness（`Harness.open(storage, options: HarnessOptions, context)`）**：

- `root(context, { agent?, init? })` → 保留根会话（无则在一次 commit 中创建）。
- `conversation(id, context)` / `createConversation({ ownership }, context)`。
- `resume(): void` —— 启动任务调度（幂等）；`submit()` / `wait()` / `waitForTask()` 等也会隐式启动。
- `wake(): Wake` —— `{ active, at? }`：本 Session 何时需要活进程（供 Durable Object alarm 等宿主自管唤醒）。
- `submission(id, context)` —— 重开进程后按 ID 重新获取 submission。
- `getTask(id, context)` / `abortTask(id, context)` / `waitForTask(id, context)`。
- `inspect(context)` → `{ scheduling, tasks, submissions }` 只读快照。
- `waitForIdle(context)` / `usage(context)`（全会话 token/费用合计）。
- `watchTaskGraph(context)` / `observeConversation(...)` / `observeTaskGraph(...)`。
- 继承自 Session：`commit(change, context, options?)`、`close(context)`、`closed: Promise<SessionEnd>`、`snapshot(token, ...)`、`watchDoc(token, ...)`、`observeDoc(...)`、`observeCommits(observer)`、`subscribeClose(listener)`。

**Conversation**：

- `submit(submission, context)` / 事务重载 `submit(tx, submission)`（在你自己的 commit 内 admit，返回 ID）。
- `configure(change: AgentChange, context)` —— 改 model / thinkingLevel / extensions / tools / modelTools / instructions / cwd / maxTurns。
- `commit(change, context, options?)`；`context(context, { at? })`（模型看到的活跃 transcript）；`entries(query, limit, cursor, context)`。
- `reset(handoff, context)`；`compact(instructions, context)` → 手动压缩任务 ID。
- `fork(at, { ownership }, context)`；`abort(context, { background? })`；`waitForIdle(context)`；`watch(context, window?)`。

**SubmissionDraft 三种形态**（来源: src/harness/types.ts 第 76–113 行）：

```typescript
{ type: "input", content, whenBusy?: "steer"|"followUp"|"reject", whenIdle?: "reject", entry?: InputEntry, requestId?: string }
{ type: "write", entry }
{ type: "continue" }
```

`requestId` 幂等：重启后用同一 requestId 再提交会找回原 submission（`again.id === submission.id`，来源: README "Persist and Resume"）。

### 5.4 持久化 + 重启恢复（最贴近「durable」本义）

README "Persist and Resume"（来源: packages/durable/README.md）：

```typescript
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const harness = await Harness.open(await openNodeSqliteStorage("./session.sqlite"), { models, registry }, context);
const root = await harness.root(context); // the same root as last time
harness.resume(); // continue any run the last process left unfinished
```

崩溃/中断恢复的关键点（README 同节）：

- `resume()` 启动调度器；submit/wait 也会启动。
- 只读查看别人驱动的 session：`HarnessOptions.readOnly: true`（所有写/`resume()` 抛 `ReadOnlySession`）。
- 每会话在 `pi.provider` 持久化 UUIDv7 会话身份，转发给 pi-ai 作 `sessionId`（provider prompt-cache / session 亲和）。

完整的关闭→重开→继续示例见 `test/examples/12-recovery.ts`（真实文件，来源: packages/durable/test/examples/12-recovery.ts）：定义 `example.ticker` 任务，打印 tick、`runtime.sleepUntil()` 存储化睡眠；在 tick 2 后 `close()` 模拟崩溃，重开后 `waitForTask(tickerId)` 自动继续，`runtime.memo()` 防止重复打印：

```typescript
const Ticker = defineTask<{ to: number }, { phase: "tick"; n: number }, string>({
	name: "example.ticker",
	version: 1,
	initial: () => ({ phase: "tick", n: 1 }),
	phases: {
		tick: async (task, runtime, taskContext) => {
			const n = task.state.checkpoint.n;
			if ((await runtime.memo(`printed-${n}`, taskContext)) === undefined) {
				await runtime.memo(`printed-${n}`, true, taskContext);
				console.log(`tick ${n}`);
			}
			if (n === task.input.to) {
				await runtime.commit(
					() => ({ status: "terminal", outcome: { status: "completed", result: `counted to ${n}` } }),
					taskContext,
				);
				return;
			}
			await runtime.sleepUntil(runtime.now() + 50, { phase: "tick", n: n + 1 }, taskContext);
		},
	},
	abort: async (_task, runtime, taskContext) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext);
	},
});
```

创建任务与等待（同文件）：

```typescript
const tickerId = await (await firstRun.root(context)).commit(
	(tx) => tx.createTask(Ticker, { to: 5 }, { ownership: { kind: "conversation" } }),
	context,
);
// ...
const counted = await secondRun.waitForTask(tickerId, context);
```

### 5.5 与 pi 模型层的集成（pi-ai）

Harness 从不直接碰 provider，一切经 `HarnessOptions.models`（`Models` 实例或 `() => Models` 函数，每次使用时调用，可热替换模型配置）（来源: src/harness/types.ts `HarnessOptions.models` JSDoc）。`identity` 选项控制对 provider 的应用标识（默认 `DEFAULT_HARNESS_IDENTITY = { attribution: PI_ATTRIBUTION }`；传 `{ attribution: null }` 不发送）（来源: src/harness/harness.ts 第 191 行；README "Quick Start" 注）。

流式答案观察（真实示例，来源: packages/durable/test/examples/15-real-model.ts）：

```typescript
const liveWatch = (await harness.watchDoc(LiveDoc, root.id, context))!;
liveWatch.start(async (call) => {
	if (call.kind !== "value") return;
	const block = call.value?.generation?.message?.content.find((content) => content.type === "text");
	if (block?.type === "text") printText(block.text);
});
harness.resume();
const poem = await root.submit({ type: "input", content: "Write a long poem" }, context);
const settledPoem = await poem.wait(context);
```

### 5.6 工具与编码能力

- `@earendil-works/pi-durable/tools` 提供 `read`/`write`/`edit`/`bash`（+ `createPowerShellTool()`）及打包扩展 `CodingTools`；工厂 `createCodingTools({ images })`（来源: src/tools/index.ts）。工具只经 `env` 选项构建的执行环境触碰文件/进程。
- 自定义工具（README "Tools" 原文，来源: packages/durable/README.md）：

```typescript
import { num, obj, str } from "@earendil-works/pi-schema";

const count = defineTool({
	name: "count",
	description: "Count from 1 to n",
	parameters: obj({ n: num() }),
	execute: async (args, api) => {
		for (let i = 1; i <= args.n; i++) api.output(`${i}\n`);
		return {};
	},
});
registry.install(defineExtension({ name: "count", tools: [count] }));
```

每次调用是独立 durable 任务；intent 在 `execute()` 前落盘；崩溃后仅 `replay: "safe"` 的工具会重跑，否则模型收到 `interrupted` 错误结果。

- 工具调工具：`api.executeTool("bash", { command: "npm test" }, context, { progress: false })`（README "Calling tools from tools"）。
- Code Mode（`/codemode`）：模型写 JS，在 QuickJS 沙箱里 `await tools.<name>(args)`；脚本跨重启续跑（结果 journal + 确定性重放）（README "Code Mode"）：

```typescript
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";

registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 }) }));
```

### 5.7 执行环境（env）

README "Environment"（来源: packages/durable/README.md）：

```typescript
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

const harness = await Harness.open(storage, {
	models,
	registry,
	env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
}, context);
```

每次工具调用/section 渲染时调用，可按会话给目录或给容器。不传 `env` 时内置工具以错误结果失败。

### 5.8 Settings（运行策略，永不落盘、支持 getter 热读）

README "Settings"（来源: packages/durable/README.md）：

```typescript
const harness = await Harness.open(storage, {
	models,
	registry,
	settings: {
		extensions: [CodingTools, Coding],
		stream: { timeoutMs: 120_000 },
		retry: { maxRetries: 3 },
		compaction: { reserveTokens: 16384 },
		progress: { partialIntervalMs: 100, outputIntervalMs: 100, persistWithinMs: 1_000 },
		toolExecution: "parallel",
		contextRetentionMs: 600_000,
		documentRetentionMs: 600_000,
		get followUpMode() {
			return userSettings.followUpMode;
		},
	},
}, context);
```

全部字段及默认值见 `HarnessSettings`（src/harness/types.ts 第 615–652 行）：`extensions`、`stream`、`retry`、`compaction`（含 `modelOverrides`）、`progress`、`toolExecution`、`steeringMode`/`followUpMode`、`contextRetentionMs`、`documentRetentionMs`、`afterFailedRun`（keep/continue/withdraw）、`restartLimit`（默认 5）。

### 5.9 观察会话（UI 对接）

`conversation.watch(context, window?)` 返回结构化视图（窗口化 entries + `pi.live`/`pi.inbox`/`pi.usage`/`pi.agent`/`pi.provider` docs）的 watch；`ConversationTranscript` 做客户端全量 transcript 合并与断线恢复（README "Watching a Conversation"；`test/examples/31-transcript.ts`）。长会话 UI/远程同步是最典型用法。

### 5.10 生产级集成参考（仓库内真实消费方）

**消费方一：`apps/p2`**（pi 仓库的下一代应用，Chord v2 插件架构；`apps/p2/package.json` 依赖 `@earendil-works/pi-durable: 1.5.0`）。真实 import（来源: apps/p2/src/runtime/worker.ts 第 9–20 行）：

```typescript
import {
	type ConversationId,
	configure,
	type DocumentReader,
	type Conversation as DurableConversation,
	Harness as DurableHarness,
	type HarnessSettings,
	ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
```

其打开 Harness 的核心代码（来源: apps/p2/src/runtime/worker.ts `openHarness`，第 669–691 行；注释为原文）：

```typescript
const durable: Native<DurableHarness> = self.open(
	async (ctx) => {
		// Generation needs model access: open once the models plugin has contributed it.
		await whenPresent(config, "default", ctx.abortSignal ?? new AbortController().signal);
		const storage = await openNodeSqliteStorage(`${dataDir}/sessions/${session.id}.sqlite`);
		const harness = await DurableHarness.open(
			storage,
			{
				models,           // Proxy，每次使用时读插件当前配置
				registry: durableRegistry(extensions, switches, durableContext(observing.signal)),
				settings,         // Proxy over HarnessSettings
				// The conversation's location, not its agent cwd alone: a subagent's own may be on another machine.
				env: async (target, context) =>
					execution.value.at(await execution.value.locate(target.conversationId, context, target.read)),
				onReport: (report) => console.error(`durable: ${report.kind}:`, report.error),
			},
			ctx,
		);
		const root = await harness.root(ctx, {
			agent: { model: session.model, cwd, thinkingLevel: session.thinkingLevel },
		});
		// ...
		return harness;
	},
	async (harness) => {
		observing.abort();
		await harness.close(BACKGROUND_CONTEXT).catch(() => {});
	},
);
```

值得借鉴的工程点（同文件）：

- **每 session 一个 SQLite 文件**：`${dataDir}/sessions/${session.id}.sqlite`。
- `models` / `settings` 用 Proxy 转发到可热替换的宿主配置——利用 `HarnessOptions.models: () => Models` 函数形态。
- `onReport` 统一上报 `task_faulted` 等报告。
- `Harness.inspect()` 在「迁移工作目录」前做冻结检查（`prepare`/`relocate`，第 391–417 行）。
- registry 的桥接：`durableRegistry()` 把 p2 的 Chord keyed registries（Extensions/ExtensionSwitches）适配成 pi-durable 的 `RegistryReader`（来源: apps/p2/src/runtime/durable.ts 第 32–68 行）。

**消费方二：`packages/env`**（pi-env；依赖 `@earendil-works/pi-durable: 1.5.0`），复用 `/env` 与 `/env/node` 的 `ExecutionEnv`、`NodeExecutionEnv`、`FileError`、`FileChange` 等类型/实现来实现本地与远程执行环境（来源: packages/env/src/remote-env.ts、watch.ts、list-files.ts、errors.ts 的 import）。

**非消费方**：`packages/coding-agent`（经典 pi CLI）不依赖 pi-durable，其运行时是 `@earendil-works/pi-agent-core`（来源: packages/coding-agent/package.json dependencies）。pi-durable 是一条新的、更底层的 durable 运行时路线。

### 5.11 Cloudflare Durable Object 宿主模式（进阶）

`HarnessOptions.onWake` + `openDurableObjectSqliteStorage(ctx.storage)`：Harness 不再自管睡眠定时器，宿主按 `harness.wake()`（`{ active, at? }`）设 DO alarm，alarm 触发时 `resume()`。完整 `DurableObject` 类示例代码在 README "Sleeping and Waking Up"（来源: packages/durable/README.md，含 fallback alarm、heartbeat、`#arm` 实现）。

---

## 6. 仓库内真实示例清单

Runnable 示例位于 `packages/durable/test/examples/`，运行方式（来源: README "Examples"）：

```bash
node --conditions=source --experimental-strip-types test/examples/13-chat.ts
```

（在 packages/durable 目录下；调 OpenAI 的需 `OPENAI_API_KEY`，其余用 faux provider。）

37 个示例（README "Examples" 表 + 目录清单，来源: packages/durable/test/examples/）：

| 文件 | 演示内容 |
|---|---|
| 00-conversation.ts | 底层之一：conversation/session 层 |
| 01-documents.ts | documents |
| 02-forks.ts | fork |
| 03-owned-conversations.ts | 被任务拥有的会话 |
| 04-watches.ts | watch |
| 05-harness.ts | Harness 基本用法 |
| 06-configuration.ts | agent 配置 |
| 07-harness-conversations.ts | 多会话 |
| 08-context.ts | 模型上下文视图 |
| 09-registry-reload.ts | registry 重载 |
| 10-extension-state.ts | 扩展自有 document 状态 |
| 11-tasks.ts | 自定义 durable task |
| 12-recovery.ts | 关闭→重开→从 checkpoint 继续（含 memo 防重放） |
| 13-chat.ts | 一问一答（faux provider） |
| 14-system-prompt.ts | system prompt 组装 |
| 15-real-model.ts | OpenAI 流式回答 + `pi.live` watch |
| 16-coding-tools.ts | JSONL 存储上的工具调用回合（read/edit/bash）+ hook 计时 |
| 17-print.ts | print 模式 |
| 18-json.ts | JSON 模式（原始视图操作） |
| 19-inbox.ts | steer / followUp / write / 撤回 |
| 20-late-join.ts | 运行中途接入视图 |
| 21-subagent-foreground.ts | 前台 subagent 工具（replay-safe，子会话归调用所有） |
| 22-subagent-background.ts | 持久后台 subagents（spawn/steer/stop/list、答案回报、重启安全） |
| 23-child-tasks.ts | checkout 拥有 4 个 payment 子任务：failFast、abort、restart |
| 24-compaction.ts | 后台/手动/溢出后压缩 |
| 25-coding-agent.ts | CodingTools + getter 热更新 settings + 跟随会话目录的 env |
| 26-plan-mode.ts | 只读 plan mode（扩展 + 自有 document） |
| 27-reviewer.ts | 独立 reviewer 会话（自己的模型/扩展/工具/目录/评审循环） |
| 28-sandbox-per-conversation.ts | 每会话一个环境（从 app document 查） |
| 29-tool-override.ts | 同名工具替换 + wrapper 计时 |
| 30-reload-and-restart.ts | 调用中途重载扩展、存储选择跨重启 |
| 31-transcript.ts | ConversationTranscript：窗口/缺口/补页/`from` 恢复 |
| 32-tests-after-edits.ts | afterRun hook：编辑后跑测试 + 修复循环 |
| 33-turn-limit-and-continue.ts | maxTurns、runFailure、continue |
| 34-submit-in-commit.ts | `submit(tx, draft)` 在宿主 commit 内 admit |
| 35-durable-on-the-store.ts | Harness on StoreStorage（Chord host 的 store 里） |
| 36-durable-views.ts | Chord 对象用 `self.follow` 跟随 Durable 视图 |
| 37-harness-registry.ts | （README 表未列）Harness 级 registry 用法 |

---

## 7. 成熟度信号

- **版本/发布节奏**：仓库内 1.5.0（2026-11-02），npm latest 同为 1.5.0；CHANGELOG 有 11 个版本条目（含大量详细 breaking changes 与迁移指南，来源: packages/durable/CHANGELOG.md）。
- **文档**：README 973 行、覆盖全部主题；`docs/spec.md` 6525 行**规范性规格**（13 章：terms/documents/transactions/tasks/submissions/extensions/built-in tasks/observation/storage contract/backends/API footguns/non-goals）；`docs/group-commit.md` 296 行性能设计文档。
- **测试**：`test/` 下约 90 个测试文件（harness-* 50+、session-* 10+、storage 五后端各一、codemode、env、images、tools 等），`test-workers/`（Cloudflare vitest-pool-workers）另测 DO 存储/唤醒；`src/testing/` 提供可复用的 storage/env 一致性套件（`registerStorageConformance`、`registerEnvConformance`）；10 个 bench 脚本（`npm run bench:*`）。
- **明确的实验性声明**：README 顶部 "Experimental. The API changes without notice between releases."
- **生产使用**：apps/p2（同仓库的正式应用）完全建立在它之上；pi-env 复用其 env 抽象。
- **限制/注意**（README/spec 汇总）：单进程独占 storage、无跨进程锁；JSONL 全历史驻内存；deferred commit 崩溃可丢约 1 秒流式内容；`restartLimit`（默认 5）是崩溃循环的止损阀；API 在小版本间也会破坏性变化。

---

## 8. 与其他 pi 包的关系（依赖方向）

依赖（pi-durable → 这些包，来源: packages/durable/package.json dependencies）：

```
@earendil-works/chord 1.5.0        （文档状态/watch/store 抽象、Context）
@earendil-works/pi-ai 1.5.0        （模型访问：Models/providers/messages）
@earendil-works/pi-codemode 1.5.0  （QuickJS 沙箱）
@earendil-works/pi-schema 1.5.0    （JSON Schema 工具参数）
@earendil-works/pi-telemetry 1.5.0 （telemetry 契约）
@silvia-odwyer/photon 0.3.3        （图片 WASM 处理）
diff 8.0.4
```

被依赖（这些 → pi-durable）：

```
apps/p2                 （整个应用的 durable 运行时）
packages/env (pi-env)   （复用 /env 执行环境抽象）
```

无依赖关系但同域：`packages/agent`（pi-agent-core）是 pi-coding-agent 的经典运行时；pi-durable 是平行的下一代 durable 运行时，二者目前互不引用（来源: packages/coding-agent/package.json；全仓 grep 仅 apps/p2 与 packages/env 的 package.json 含 pi-durable 依赖）。

monorepo 全景中的定位（来源: 根 README.md 包表格第 81 行）："Durable conversation, task, and document runtime"。

---

## 附：本文件未做之事

- 未运行任何仓库代码/测试（按只读分析约束）。
- spec.md 6500 行未逐行精读，仅覆盖 §1 与目录结构；细节以原文为准。
- GitHub 链接模板：`https://github.com/earendil-works/pi/blob/main/packages/durable/...`。

---

# 第三部分 · 在 pi 上构建记忆 / 上下文管理架构

> 结论先行：**可以，而且 pi-durable 恰好是整个 monorepo 里最适合做"记忆 / 上下文管理架构"的层**。它提供了持久层（typed JSON documents + immutable entries 日志）、事件层（`watch()` / hooks）、注入层（system prompt sections）、能力层（自定义工具 + 后台 task + sleeping task）和上下文裁剪原语（head 标记 / reset / compaction），全部跨进程崩溃可恢复。但 pi **没有任何内建的"记忆"语义**：无 embeddings、无向量检索、无跨会话语义记忆，检索仅有 `tool_search` 用的 BM25 词法排名；上下文压缩（CompactionTask）是内建 task，不能整体替换，但可通过 `beforeCompact` hook 替换摘要内容、通过 settings 参数化阈值，或用自定义 head entry / `reset(handoff)` 绕开。以下全部论断基于 main 分支源码（引用格式：仓库相对路径 + 行号；GitHub 链接基于 `https://github.com/earendil-works/pi/blob/main/`）。

---

## A. 内建的上下文管理能力（已有什么）

### A.1 pi-ai：Context、消息模型与 token 计量

`Context` 是一个极简的请求输入类型——调用方完全拥有消息列表：

```ts
// packages/ai/src/types.ts:795-799
export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}
```

关键点：

- **消息即 transcript**。`Message` 是四种角色的 union（`packages/ai/src/types.ts:666`）：`SystemMessage | UserMessage | AssistantMessage | ToolResultMessage`，全部字段是纯 JSON（时间戳为 Unix 毫秒数），**完全可序列化**。
- **SystemMessage 支持中途变更**（`packages/ai/src/types.ts:568-584`）：`content` 追加指令；`sections?: Record<string, string | null>` 按名字替换/删除（`null` 删除）prompt 段；`toolsAdded` / `toolsRemoved` 增删工具。注释明确："Replaying every system message in order yields the current prompt and tools"。重放逻辑在 `packages/ai/src/utils/transcript.ts`：`getCurrentSystemMessage()`（73-96 行）把所有 system message 折叠成一个当前 prompt，`getCurrentTools()`（58-66 行）解析当前工具集；不支持中途 system message 的 API 用 `collapseSystemMessages()` 折叠成开头一条。**这意味着"上下文管理"在 pi-ai 层的表达方式就是：追加带 sections/toolsAdded 的 system message，或直接改写 messages 数组再传回。**
- **token 计量**：`Usage`（`packages/ai/src/types.ts:466-494`）含 `input / output / cacheRead / cacheWrite / reasoning? / totalTokens` 和 `cost`（catalog 估算或 provider 计费）。每个 `AssistantMessage.usage` 携带实际用量（605 行），这是上层压缩触发器的数据源。估算工具在 pi-ai utils（如 durable 用的 `estimateMessageTokens` / `calculateContextTokens`，见 `packages/durable/src/harness/compaction.ts:4` 的 import），是 chars/4 启发式（coding-agent 的同款在 `packages/coding-agent/src/core/compaction/compaction.ts:298-349`）。
- **上下文窗口在模型元数据里**：`Model.contextWindow: number` 是必填字段（`packages/ai/src/types.ts:878`），`maxTokens` 同级（879 行）。coding-agent 的压缩判断 `shouldCompact` 就是 `contextTokens > contextWindow - reserveTokens`（`packages/coding-agent/src/core/compaction/compaction.ts:267-270`）。

### A.2 pi-agent-core：进程内 while 循环 + 一个官方的上下文管理钩子

`AgentLoopConfig` 里有一批与上下文直接相关的钩子（`packages/agent/src/types.ts`）：

| 钩子 | 位置 | 对上下文管理的作用 |
|---|---|---|
| `transformContext(messages, signal) => Promise<AgentMessage[]>` | types.ts:244 | **官方注明的上下文管理入口**，注释原文举例 "Context window management (pruning old messages)" 和 "Injecting context from external sources" |
| `convertToLlm(messages) => Message[]` | types.ts:222 | AgentMessage → LLM 消息的投影，可过滤 UI-only 消息 |
| `prepareRequest` / `prepareNextTurn` | types.ts:271/278 | 每次请求前替换 context / model / thinkingLevel，或追加消息 |
| `getSteeringMessages` / `getFollowUpMessages` | types.ts:293/306 | 运行中插话（steer）/ 停下后追加（follow-up）队列 |
| `beforeToolCall` / `afterToolCall` | types.ts:326/341 | 拦截/改写工具调用与结果 |

循环本体（`packages/agent/src/agent-loop.ts:172-311`）：外层循环由 follow-up 驱动，内层循环处理 tool calls 与 steering；每次请求前依次走 `prepareNextTurn` → steering 注入 → `prepareRequest` → `transformContext`（399-400 行）→ `convertToLlm`（404 行）。`AgentState.messages` 是可整体赋值的（`packages/agent/src/agent.ts:101-107`，setter 复制顶层数组），即**调用方可以随时改写/裁剪整个消息列表**。

**pi-agent-core 本身没有内建 compaction/summarization**——`grep compact` 在 `packages/agent` 只命中注释（如 agent-loop.ts:210 "Preparation can be long-running (for example, compaction)"，指的是上层实现）。压缩是 coding-agent 和 pi-durable 各自实现的（两套实现，prompt 格式几乎相同）。

### A.3 pi-coding-agent：内建的上下文管理清单

- **自动压缩 + `/compact` 命令**：`CompactionSettings { enabled, reserveTokens: 16384, keepRecentTokens: 20000 }`（`packages/coding-agent/src/core/compaction/compaction.ts:120-130`）；阈值判断在 `AgentSession`（`agent-session.ts:3186`：`shouldCompact(contextTokens, contextWindow, settings)`），触发源有三种：`manual`（/compact）、`threshold`（自动）、`overflow`（上下文溢出后压缩重试一次）。切点算法 `findCutPoint`（446-501 行）从尾部按 `keepRecentTokens` 回溯累积，只在 user/assistant 消息处切（永不在 toolResult 处切，避免孤儿 tool call），支持切在 turn 中间（split turn，带 turn prefix 摘要）。摘要 prompt 是固定结构化模板（Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context，507-538 行），支持增量更新（`UPDATE_SUMMARIZATION_PROMPT`，540-579 行）和 `customInstructions` 附加聚焦。
- **AGENTS.md 注入**：候选文件名 `["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]`（`packages/coding-agent/src/core/resource-loader.ts:213`），从 `~/.pi/agent` 全局目录 + cwd 向上逐级祖先目录收集（`loadProjectContextFiles`，260-302 行），渲染进 system prompt 的 `project_context` section（`packages/coding-agent/src/core/system-prompt.ts:172`，包裹成 `<project_instructions path="...">`）。
- **System prompt 是命名 sections**（`packages/coding-agent/src/core/system-prompt.ts:128-192`）：`preamble / tools / rules / docs / addendum / project_context / skills / cwd` + 扩展自定义 sections（名字须匹配 `^[a-z][a-z0-9_-]*$`）。`diffSystemPromptSections()`（216-228 行）把期望 sections 与 transcript 重放的当前 sections 做 diff，只发送变化的 patch——这是保持 prompt cache 命中率的机制。
- **Skills / custom commands / prompt templates**：skills 从目录加载并格式化进 `skills` section（`skills.ts:358` `formatSkillsForPrompt`）；custom command 通过扩展 `registerCommand`（`extensions/types.ts:1725`）。
- **SDK 层全部可自定义**：`createAgentSession()`（`packages/coding-agent/src/core/sdk.ts:191`）接受 `customTools`（94 行）、自定义 `resourceLoader` / `sessionManager` / `settingsManager`（97-101 行）；SDK 把 agent-core 的 `transformContext` 接到扩展系统的 `context` 事件上（sdk.ts:428-432 `runner.emitContext(messages)`）。
- **扩展事件系统**（`packages/coding-agent/src/core/extensions/types.ts`）是 coding-agent 的"hook"层，事件清单（`ExtensionAPI.on(...)`，1642-1709 行）包括：`session_start / session_before_switch / session_before_fork / session_before_compact / session_compact / session_compact_failed / session_before_tree / session_tree / context / context_with_system / before_provider_request / before_provider_headers / after_provider_response / provider_stream_event / before_agent_start / agent_start / agent_end / agent_before_settle / agent_settled / turn_start / turn_end / message_start / message_update / message_end / tool_execution_start / tool_execution_update / tool_execution_end / model_select / thinking_level_select / tool_call / tool_result / user_bash / input` 等。
- **与记忆最相关的三个事件**：
  1. `context`（899-908 行）："Fired before each LLM call. Can modify messages."，`messages` 不含 system 消息（prompt/tool 状态由 Pi 恢复）；`context_with_system`（915-918 行）则是完整 transcript、handler 全权负责。
  2. `session_before_compact`（806-817 行）：携带 `preparation: CompactionPreparation`、`reason: "manual" | "threshold" | "overflow"`、`willRetry`；返回值 `SessionBeforeCompactResult { cancel?: boolean; compaction?: CompactionResult }`（1531-1534 行）——**可以取消压缩，或用自己的摘要结果整体替换内置摘要**。
  3. `agent_before_settle` / `turn_end` 返回 `BoundaryResult { entries?: SessionBoundaryDraft[]; continue?: boolean }`（1042-1045 行），`SessionBoundaryDraft` 包含 `CompactionEntryDraft`（1012-1019 行：`{ type: "compaction"; summary; firstKeptEntryId; details?; usage? }`）和 `ContextEditEntryDraft`（1007-1010 行：按 entry id 替换/删除消息）——**扩展可以在 turn 边界注入自定义压缩 entry 或编辑历史消息**。

### A.4 pi-durable：CompactionTask、fork/reset/handoff、子 agent、tool_search、maxTurns

**CompactionTask 的确切行为**（`packages/durable/src/harness/compaction.ts:115-246`）：

- 三个 phase：`select`（选切点）→ `summarize`（调模型生成摘要，`completeSimple`，maxTokens 取 `0.8 × reserveTokens` 与模型上限的较小值，152-155 行）→ `retry`（退避后重试）。
- 切点选择 `selectCut(view, keepRecentTokens)`（285-303 行）：从活动 entries 尾部回溯累积 token 直到 `keepRecentTokens`，然后取该位置之后第一个合法候选（assistant 开头的 entry，或结果不悬挂的 user entry；永不在 toolResult 处切）。
- 摘要放置 `placeSummary`（440-472 行）：写一条 `pi.compaction` entry，`head` 指向第一个保留的 entry，`model` 是一条包裹摘要文本的 user message（前缀 "The conversation history before this point was compacted into the following summary…"）。旧 entries **留在存储里**，只是不再进入活动上下文。由 generation 拥有的阻塞式 compaction 直接 append；会话级的（手动/后台）通过 write submission 在边界放置。
- 触发：手动 `conversation.compact(instructions)`；generation prepare 阶段的阈值检查 `thresholdCompaction`（`generation.ts:453-470`）：超过 `contextWindow - reserveTokens` 为 blocking（生成等待 compaction 完成再发请求），超过 `blocking - backgroundTokens` 为 background（后台压缩、会话继续工作）；provider 拒绝上下文溢出时压缩并重试一次（`classify()`，generation.ts:804-820）。
- **自定义口子**：`CompactionHooks.beforeCompact`（`packages/durable/src/harness/types.ts:1063-1081`）签名：

```ts
// packages/durable/src/harness/types.ts:1070-1080
beforeCompact(
	compaction: {
		readonly reason: CompactionReason;          // "manual" | "threshold" | "overflow"
		readonly entries: readonly EntryRecord[];   // 将被摘要替换的活动 entries
		readonly messages: readonly Message[];      // 它们的 model context（摘要器输入）
		readonly firstKept: EntryId;                // 第一个原样保留的 entry
		readonly instructions?: string;
	},
	api: HookApi,
	context: Context,
): HookResult<{ readonly decline: true } | { readonly summary: string }>;
```

返回 `{ decline: true }` 拒绝压缩，或 `{ summary: string }` **用自己的摘要文本替换模型生成**（compaction.ts:141-146：第一个非空 decision 生效，hook 提供的 summary 直接 `place()`）。阈值/策略通过 `settings.compaction`（`CompactionSettings` 含 per-model `modelOverrides`，types.ts:583-585）参数化。**但 CompactionTask 本身（`name: "pi.compaction"`）是内建 task，generation 只会创建它，不能注册同名 task 替换**——扩展只能装 hook 或调参数；完全自定义要走 C.3 的绕行方案。

**fork / reset / handoff 对上下文的影响**：

- `Conversation.fork(at, options)`（`types.ts:859`）：新会话看到父会话到 `at` 为止的 entries，独立续写；继承父会话在 fork 点的 agent（`AgentDoc` 是 `history: "rewindable", fork: "asOf"`，`packages/durable/src/harness/agent.ts:44-50`），但获得新的 provider session 身份。
- `Conversation.reset(handoff)`（`types.ts:838`）：写一条 `head: "self"` 的 `pi.reset` entry（`entries.ts:29-33`），模型不再看更早的 entries（旧 entries 仍在存储）；`handoff` 文本作为 user message 随 reset 写入。busy 时排队到边界；放置时当前 run 以 `unanswered: reset` 结束。
- 工具结果的 `control: { handoff: "..." }`（`types.ts:177-186`）写同样的 reset **但 run 继续**：下一个模型请求在新上下文中进行，submission 最终以那个答案 settle（`finishToolRound`，generation.ts:1105-1110）。

**子 agent 上下文隔离**：conversation 由 task 拥有（`ownership: { kind: "task", taskId }`）。子会话是**完全独立的 transcript + 独立的 `pi.agent` / `pi.live` / `pi.usage` documents**，起始 agent 是父会话 agent 的拷贝（README "Per-Conversation Agent"）。前台子 agent：工具在 `api.commit()` 里用 ownership index 去重后创建子会话并 `submit` + `wait`（README "Abort and Subagents" 完整示例；`test/examples/21-subagent-foreground.ts`、`22-subagent-background.ts`）。后台模式用 background anchor task + reporter task 把答案以 follow-up 投递回父会话。abort 级联自底向上：父 abort → 子 abort；父 idle 需子先 idle（除非 `{ background: true }` 边界）。

**tool_search 延迟加载**（`packages/durable/src/tool-search/tool-search.ts`）：`deferred: true` 的工具不进模型工具列表；`tool_search` 工具用 **BM25**（`packages/durable/src/search.ts`，Okapi BM25 k1=1.2 b=0.75，name/text/namespace 三字段）在 deferred 工具的名称+描述+参数 schema 文本上排名，命中者通过结果的 `control.addTools` 写入会话的 `modelTools.add`——**下次请求才生效**，且在该分支上持续 offered（compaction 后也保留）。这是"工具记忆"的官方模式：大工具集（如 MCP）按需加载。

**maxTurns**：`AgentState.maxTurns`（`types.ts:486-488`）限制一个 run 的 tool 轮数；达到限制的轮仍执行完工具，然后 run 以 `unanswered: turn_limit` 结束（`finishToolRound`，generation.ts:1097-1104）。计数在 `pi.live.run.turns`，跨重启存活，每个 run（含 continue、onYield 续跑）从 0 重新计数。children 与 forks 继承。

### A.5 pi-durable 的执行模型（与 pi-agent-core 进程内循环的对比）

这一小节回答：pi-agent-core 是进程内 while 循环（stream → toolUse → 执行工具 → 再 stream，`AgentContext` 全在内存，`packages/agent/src/agent-loop.ts:172-311`），pi-durable 是怎么"执行"的？

**1) `Conversation.submit()` 之后如何驱动**。`submit()` 在**一个原子 commit 里**做准入（`packages/durable/src/harness/submissions.ts:223-279` `admitSubmission()`）：空转会话直接 append `pi.user` entry 并 `startRun()`（`generation.ts:1164-1177`：创建一个 conversation-owned 的 `GenerationTask`，写 `pi.live.run = { taskId, inputs, turns: 0 }`）；busy 会话把 input 放进 `pi.inbox` document（`packages/durable/src/harness/inbox.ts:22-30` `InboxDoc`）。驱动者是**同一进程内的 `TaskScheduler`**（`packages/durable/src/harness/scheduler.ts`，约 3200 行）：`#live` Map 镜像所有非 terminal 的 task record；预约（reservation）→ invocation（run/abort 模式之一）→ 逐 phase 执行。所有 task 状态迁移都由 Session line 上串行化的回调决定（类注释，scheduler.ts:290-296 "every task transition is decided and written by one callback serialized on the Session line"），存储侧是 group commit。`harness.resume()`、以及任何 `submit/wait/compact/abort` 调用都会启动调度（`types.ts:883-888`）。没有外部队列服务——**"队列"就是存储里的 tasks 表**。

**2) 内置 task 的粒度与链接**。`GenerationTask`（`name: "pi.generation"`，`generation.ts:164-167`）的 checkpoint 是 phase 机（`generation.ts:71-138`）：

```ts
// packages/durable/src/harness/generation.ts:71-138（节选）
export type GenerationCheckpoint =
	| { phase: "prepare"; attempt: number; compacted?: TaskId<CompactionResult>; overflow?: string; threshold?: true }
	| { phase: "request"; attempt: number; model: ModelRef; thinkingLevel: …; streamOptions: …; cutoff: EntryId }
	| { phase: "retry"; attempt: number; until: number; poll?: … }
	| { phase: "poll"; attempt: number; handle: DeferredHandle; pollAt: number; … }
	| { phase: "tools"; assistant: EntryId; tools: TaskId<ToolTaskResult>[]; pending: string[] }
	| { phase: "finish"; run: RunSummary }
	| { phase: "drain"; answer: EntryId; tasks: TaskId[] };
```

- **一次模型调用尝试 = GenerationTask 的一个 `request` phase**（prepare 渲染 prompt/工具 → request 发起流式调用，partial 每 100ms 以 deferred commit 写进 `pi.live.generation.message`，`streamResponse`，generation.ts:692-757）。
- **工具调用如何链回**：`classify()` 发现 `stopReason: "toolUse"` → `startToolRound()`（generation.ts:1011-1065）在一个 commit 里 append assistant entry、为每个 call 创建**子 `ToolTask`**（`ownership: { kind: "task", taskId: 生成任务 }`，`createToolTask`，434-446 行），然后生成任务提交 `{ status: "waiting", checkpoint: { phase: "tools", tools, pending }, on: [taskIds], policy: "allSettled" }` **挂起**（不占 invocation）。调度器等所有 ToolTask terminal 后唤醒生成任务进入 `tools` phase（顺序轮次则逐个启动 `pending`）→ `finishToolRound()`（1066-1162 行）读各工具结果的 `control`（terminate/handoff/addTools）、跑 `afterTools` hooks、放置边界（steers 在此落地）、检查 maxTurns，然后 **`handOver()` 把 run 移交给一个新创建的 GenerationTask**（1187-1191 行：`live.run.taskId = to`），当前生成任务 terminal（`result: { entryId }`）。
- **task 图形状**（README:106-113 有官方示意图）：`pi.generation → pi.assistant (tool calls) → pi.tool × n → pi.tool-result × n → 下一个 pi.generation → pi.assistant (答案)`。即 **run = 一条 GenerationTask 链，每个 GenerationTask 拥有并等待它那一轮的 ToolTask**；CompactionTask 或作为 generation 的子 task（blocking）或 conversation-owned（background/manual）。`harness.watchTaskGraph()`（`types.ts:931`）可观察整棵所有权树。TaskRuntime 签名见 `packages/durable/src/types.ts:263-363`（`commit / memo / outcomes / waitForTask / conversation / context / entries / sleepUntil / hooks` 等）。

**3) submissions 表与 inbox 在执行流中的确切位置**。submissions 是持久表（`createSubmission` / `settleSubmission` / `placeSubmission`，状态 `queued → placed → done/unanswered`）；等待者在 settle 的 commit 发布时被唤醒（`submissions.ts:163-170`）。inbox 只在**边界（boundary）**被消费：`prepareBoundary()` 在 commit 的第一次表写之前读 inbox 与最新 head 标记（`inbox.ts:59-69`）；`applyBoundary(tx, boundary, "postTools" | "final", now)`（78-121 行）按 `steeringMode/followUpMode`（`"all" | "one-at-a-time"`）放置：writes 先放、user 项后放，均按 ID 序；排队中的 reset（`head: "self"`）把边界升级为 final 并终结当前 run。边界调用点：`answer()`（final，generation.ts:879）、`finishToolRound()`（postTools，1103/1126 行）、失败 run 结束（`endFailedRun`，656 行）、continue 准入（submissions.ts:271）。

**4) 崩溃恢复**。`TaskScheduler.open()`（scheduler.ts:439-474）在打开时扫描全部非 terminal task：`running` 的记录被改写为 `pending` 并 `restarts + 1`，**checkpoint 原样保留**；`abandonOnRestart` 的任务被 abort-mark。恢复后任务从其 checkpoint 的 phase **从头重跑该 phase**（"a phase reruns from its top after a restart"，README:162），所以 phase 内不做中间持久化、跨等待的工作放下一个 phase。特别地，`request`/`poll` phase 看到 `task.restarts !== undefined` 即知道"宿主死于本次请求在途"，把它计为一次失败尝试（`interrupted()`，generation.ts:499-546）：partial 转成 aborted entry，按 `settings.retry` 退避（sleeping phase）后重试，重试耗尽 run 以 `interrupted` 结束；poll 中的 deferred response 则改为重新轮询而非重发请求。崩溃循环由 `settings.restartLimit`（默认 5）兜底。提交顺序保证"nothing is shown before its commit is stored"（README:94），phase 的 decision commit 由该 phase 拥有（scheduler.ts:2224 "A phase owns its decision commit"）。

**5) sleeping task 在没有循环运行时如何被唤醒**。`runtime.sleepUntil(until, checkpoint)` 提交 `{ status: "sleeping", until, checkpoint }` 后任务**不再持有 invocation**（types.ts:357-362）。两种唤醒方式（README:140-212，`types.ts:727-734` `onWake`）：默认由调度器的 timer 在 `until` 到期时把任务变回 runnable 并 `#wakeDue()`；宿主可能被逐出（如 Cloudflare Durable Object）时传 `onWake` 回调，Harness 不 arm timer，而是每当 `harness.wake()`（`types.ts:759` `{ active: boolean; at?: number }`：active=有任务可立即运行，at=最早 sleep 到期时间）变化就调用它，宿主用自己的 alarm 在到期时调 `resume()`（DO 示例见 README:169-209）。README 的 `Reminder` 例子（145-159 行）就是"定时后台任务"的最小形态。

### A.6 小结：内建 vs. 需要自带

| 能力 | pi-ai | pi-agent-core | pi-coding-agent | pi-durable |
|---|---|---|---|---|
| 消息/transcript 模型（可序列化、可改写） | ✅ | ✅（AgentMessage） | ✅ | ✅（entries） |
| token 计量 / contextWindow | ✅ Usage/Model | ➖（上游提供） | ✅ | ✅（pi.usage、estimateContext） |
| compaction/summarization | ❌ | ❌（只有 transformContext 口子） | ✅ 完整（可 hook） | ✅ 完整（可 hook + 参数化） |
| system prompt 分段/动态注入 | ✅ sections | ✅（system message） | ✅ sections + diff patch | ✅ section() 每请求重渲染 |
| 事件流 | ➖ stream 事件 | ✅ AgentEvent | ✅ 扩展事件 | ✅ watch()/observe*() |
| 持久化 | ❌ | ❌ | session 文件（jsonl） | ✅ documents/entries/tasks/submissions 原子提交 |
| 检索（retrieval） | ❌ | ❌ | ❌（tool search 是 BM25，位于扩展） | ❌ 仅 tool_search 的 BM25 |
| embeddings / 向量 / RAG | ❌ | ❌ | ❌ | ❌ |
| 跨会话记忆 | ❌ | ❌ | ❌ | ➖（session-scope documents 可共享，但无语义层） |

## B. 记忆架构的积木（memory substrate）

### B.1 Typed JSON documents（defineDoc）

`defineDoc`（`packages/durable/src/documents.ts:39-57`）与 `defineDocFamily`（60-80 行）支持四种 scope：

```ts
// packages/durable/README.md:810-823（Your Own State 示例）
const Todos = defineDoc<{ items: string[] }>({
	kind: "app.todos",
	version: 1,
	scope: "conversation",        // "session" | "conversation" | "task"；family 额外带字符串 key
	history: "latest",            // 或 "rewindable"：可用 snapshotAsOf() 读历史值
	fork: "initial",              // fork 时子会话拿到什么："initial" | "current" | "asOf"
	initial: () => ({ items: [] }),
	checkpointWhen: () => false,  // 必填：何时存完整 base 以约束 delta replay
});
await root.commit(async (tx) => { (await tx.doc(Todos, root.id)).items.push("write docs"); }, context);
```

- **内建 documents**：`pi.agent`（rewindable/asOf，`agent.ts:44-50`）、`pi.provider`（provider session 身份）、`pi.live`（运行态：run/generation/tools/compactions/runFailure，`live.ts:195-219`）、`pi.inbox`（排队 submissions）、`pi.usage`（按 provider/model 与 tool 名的开销）。定义自己的 document 就是用非 `pi.` 前缀的 kind + `defineDoc`，在 commit 里 `tx.doc(Token, id)` 读写。
- **版本历史**：`history: "rewindable"` + `snapshotAsOf(token, conversationId, at: EntryId)`（spec.md:1421-1422、1536-1545 行）可读"某个 entry 提交时刻"的文档值——按 entry 定位 incarnation，fork 后读继承 entry 会落到父会话的历史实例。注意这不是任意时间旅行：`checkpointWhen` 决定完整 base 的存储频率，其余靠 op delta replay（spec.md:1305-1310："checkpointWhen() only selects complete storage bases to bound replay"）。
- **持久性与共享**：documents 与 entries 在同一 commit 原子存储，天然跨进程重启。**跨 conversation 共享只有 `scope: "session"` 一种内建方式**（一个 storage/Session 内全局单例）；conversation 文档互相隔离，fork 时按 `fork` 策略拷贝。跨进程共享存储：一个 storage 同一时刻只能被一个进程拥有（README:881 "One process owns a storage at a time; there is no cross-process locking"）。**Chord 的 store 能力**：durable 可以跑在 `StoreStorage` 上（durable 的 Chord store 集成，见 `packages/chord/src/store/README.md` 末尾 "Durable's `StoreStorage` keeps its records in the store"；示例 `packages/durable/test/examples/35-durable-on-the-store.ts`），把会话数据放进 Chord host 的表里，与 Chord 对象自己的表共用一条 commit 队列——这样记忆数据可以和宿主应用的结构化表（含查询、live query、导出/导入）放在一起，但仍受单进程约束；Chord 本身的对象/links 是跨进程（server、workers、浏览器 tab）的。
- **廉价写入**：只改 `latest` + `fork:"initial"` 文档的 commit 可声明 `{ persistence: { kind: "deferred", withinMs } }`（README:826-838）——watch 立刻可见，存储延迟落地。适合高频记忆草稿，不适合关键事实（崩溃丢至多 withinMs 窗口）。

### B.2 Entries 日志与 watch()

- **Entry 类型**（`packages/durable/src/entries.ts:15-34`）：内建 6 种——`pi.user` / `pi.assistant` / `pi.system` / `pi.tool-result` / `pi.reset` / `pi.compaction`。自定义 kind 用 `defineEntry<D>(kind)`（1-12 行），entry 是 `{ id, kind, data?, model?: Message[], head? }`；`model` 字段决定它给模型看什么（没有 `model` 的 entry 对模型不可见，纯 UI/数据记录），`head` 决定活动上下文起点。**entries 一经 commit 不可变**（README:519 "Entries never change once committed"），"编辑历史"通过 `edits`（message 替换）在投影层实现。
- **原始历史 vs 模型上下文**：`api.entries()` / `Conversation.entries()` 返回 fork 感知的**原始历史**（compaction/reset 遗留的 entry 也在，README:667 "Hooks read … the conversation's raw history (`api.entry()`, `api.entries()`), which compaction never changes"）；`runtime.context()` / `Conversation.context()` 返回 `ContextView`（`types.ts:794-803`：head 标记 + 活动 entries + 每 entry 的 model contributions + 下一次请求的 messages）。**对记忆架构这是最重要的区分：被压缩掉的对话永远可以用 `entries()` 全量召回。**
- **`watch()` 能看到什么**：`conversation.watch()` 返回结构化视图的 watch，每个 commit 一个 callback，携带 `{ value: ConversationView, ops }`；`value.entries` 是滑动窗口（默认最新 50，超过 100 摘最旧，README:497），`value.docs` 含 `pi.live / pi.inbox / pi.usage / pi.agent / pi.provider`。事件粒度=commit 粒度（新 entry、doc 变更、submission settle 都是一次 commit），流式 partial 与工具输出按 `progress.partialIntervalMs`（默认 100ms）节流提交。`ConversationTranscript`（`packages/durable/src/harness/transcript.ts:51`）是客户端侧的累积层：`merge()` 每个 view、`loadEarlier()` / `fillGap()` 翻页、`resume` 支持断线续看——UI 记忆缓冲的现成组件。适配器可用的同步观察口：`harness.observeConversation / observeTaskGraph / observeDoc`（`types.ts:938-949`，README:523）。

### B.3 Hooks：能拦截什么、能做什么

`hook(task, handlers)`（`packages/durable/src/harness/define.ts:38-40`）按 **task 名**匹配（GenerationTask / ToolTask / CompactionTask 三种内建 task 各自有一组 hooks）。真实签名（`packages/durable/src/harness/types.ts:979-1081`）：

```ts
// GenerationHooks（types.ts:979-1010）
beforeRequest(request: { messages: readonly Message[] }, api, ctx): HookResult<{ messages: readonly Message[] }>;  // 每次请求尝试前，可替换本次请求的消息（含恢复重试）
beforeProviderRequest(request: { model; payload }, …): HookResult<{ payload }>;  // provider 请求体发出前
afterResponse(message: AssistantMessage, …): void;                              // 每个终态 provider 消息（分类前）
onYield(answer, …): HookResult<{ continue: UserInput }>;                         // 最终答案后决定继续跑
afterTools(assistant: EntryId, results: readonly EntryId[], …): void;            // 一轮工具全部 terminal 后
afterRun(run: RunSummary, …): HookResult<{ tasks: readonly RunEndTask[] }>;      // run 答完后启动 afterRun tasks

// ToolHooks（types.ts:1036-1061）
beforeTool(call: ToolHookCall, …): HookResult<{ arguments?: JsonObject; block?: string }>;  // 改参数或拦截
afterTool(call, result: ToolExecutionResult, …): HookResult<ToolExecutionResult>;           // 替换结果（含 Harness 自写的错误结果）

// CompactionHooks（types.ts:1063-1081）
beforeCompact(compaction, …): HookResult<{ decline: true } | { summary: string }>;          // 拒绝或替换摘要
```

**hook 里能读写 documents 吗？能**：`HookApi`（types.ts:956-974）extends `DocumentReader`（`api.snapshot(Token, id)` / `api.watchDoc`），还能 `api.memo()`（task 级持久 memo）、`api.entry()/api.entries()`（原始历史）。写 documents 不能在 hook 里直接做——但 `afterRun` 返回的 task、或工具内的 `api.commit()` 可以；hook 是"读 + 决策"层，task/tool 是"写"层。hook 抛错被 report 并跳过（不破坏任务，README:916 规则 3）。**修改后续行为**：`beforeRequest` 改消息、`beforeTool` block/改参、`afterTool` 换结果、`onYield` 续跑、`afterRun` 派生任务、`beforeCompact` 接管压缩。

### B.4 section：system prompt 的动态注入

`section(key, render, options?)`（`define.ts:29-35`）。渲染输入 `PromptInput`（`types.ts:394-404`）：`{ conversationId, agent, env, shown: 当前已生效的 sections, read: DocumentReader }`——**render 是异步的、每次请求前执行、能读 committed documents**（README:372-378："A section sees the resolved agent, the environment built for the request, and committed documents"）。返回 `undefined` 省略该 section。顺序=扩展安装顺序，conversation 的 `instructions` 永远最后（`instructions` section）。产物存成位置性 `pi.system` entries，**只发送变化的部分**（prompt cache 友好，README:378；"A section that returns something different every time, such as the current time, defeats that"——记忆注入要注意：同样内容别每次变文本）。`wrapSection(key, wrapper)`（define.ts:56-61）可以装饰别的扩展的 section。`configure()` 按 conversation 选择扩展（`extensions: { add: […] }`），可实现"按会话开关的记忆 section"（p2 的 plan-mode 就是一例，`26-plan-mode.ts`）。

### B.5 defineTool / wrapTool

自定义记忆读写工具的模式（README:260-296）：

```ts
// packages/durable/README.md:265-274
const count = defineTool({
	name: "count", description: "Count from 1 to n",
	parameters: obj({ n: num() }),          // pi-schema；args 类型自动推断
	execute: async (args, api) => { … return {}; },
});
```

`ToolRegistration`（`types.ts:351-391`）要点：`replay: "safe" | "unsafe"`（崩溃后是否允许重跑，记忆写工具应考虑幂等 + `replay: "safe"`）；`structuredOutputSchema` 给程序调用方（子 agent / codemode）结构化返回；`callers: ["model"|"tools"]` 限定调用方（`["tools"]` 可做"只给程序用的记忆 API"）；`deferred: true` 配合 tool_search 按需加载；`api.commit()` 在工具调用的事务里写 documents / 创建子任务；`api.executeTool(name, args)` 发起嵌套工具调用（各自的 ToolTask）；`api.conversation(id)` 拿任意会话的 handle 去提交（如向父会话投递 follow-up）；`api.output()` 流式输出、`api.details()` 给 UI。`wrapTool(tool, wrapper)`（define.ts:51-53）按**名字**装饰最终胜出的工具实现（同名后者替换前者，wrapper 总能包住）——审计（记日志写 doc）、改参、限流的通用点；`api` 是 plain object 可 spread。工具结果可带 `control: { addTools / terminate / handoff }` 影响运行控制。

### B.6 defineTask / sleeping / onWake：后台记忆整理（consolidation）

`defineTask<I, S extends { phase: string }, R, H>`（`packages/durable/src/tasks.ts:4-8`；`TaskDefinition` 全签名 `types.ts:366-394`）定义一个**checkpoint 状态机**：`initial(input)` 给出首个 checkpoint；`phases` 是穷举的 phase→handler 映射，每个 handler 结束前必须 `runtime.commit()` 出新 checkpoint / waiting / sleeping / terminal（`PhaseHandler` 契约，types.ts:240-248："returning without durable progress faults the task"）；`abort` 必须提交 terminal。生命周期（README:759-784、scheduler §5.5）：pending → running（一个 invocation）→ waiting（`{ on: [taskIds], policy: "failFast" | "allSettled" }`，不占 invocation）→ sleeping（`until`）→ completing（outcome 已定，等 owned work 排干）→ terminal（completed/failed/aborted/faulted/orphaned）。

**做后台记忆整理的完整要素都在**：

- 定时唤醒：`sleepUntil` + 期末 commit（README Reminder 例，145-159 行）；
- 无进程时的唤醒：`onWake` + `harness.wake()` + 宿主 alarm（README:166-212）；
- 会话结束触发：`afterRun` hook 返回 `runEndTask(MyConsolidation, input)`（README:669-701；run 的 entries 区间 `{ first, answer, last }` 由 `RunSummary` 给出，`api.entries({ minEntryId: first, maxEntryId: last })` 分页读全量原始历史）；
- 长任务防崩溃循环：`settings.restartLimit` 兜底；重活分 phase、每 phase 落 checkpoint；
- 后台不阻塞用户：`background: true` 的 conversation-owned task 不参与 idle 等待与普通 abort（`TaskOptions.background`，types.ts:415-416）。

### B.7 持久性边界：哪些状态天然持久、哪些不是

天然持久（每个 commit 原子落库，崩溃后 `open()+resume()` 恢复）：**entries、documents（含 deferred 的在 withinMs 内除外）、tasks 及其 checkpoints/memos、submissions、inbox、usage、provider 身份**。不持久 / 进程内：调度器内存索引（`#live` 等由存储重建）、`contextRetentionMs` 内缓存的上下文投影、观察者与 watch 回调、正在流式的 partial 中未提交部分（默认至多 ~100ms + persistWithinMs 1s 窗口，README:527）、task 的 in-memory invocation 本身（running 记录恢复成 pending）。对记忆架构的含义：**把记忆放 documents/entries/tasks 里就自动获得崩溃一致性；放进程内变量就什么都没有**。`readOnly: true` 打开方式允许只读查看另一个进程驱动的会话（`types.ts:743-749`）。

## C. 实现模式（可落地方案）

以下 C.1–C.4 的**组件全部有源码证据**，但组合成"记忆架构"的方案本身是**设计推演，非仓库现状**（仓库中没有任何 memory/RAG 示例，见 C.6）。

### C.1 跨会话持久记忆：documents + section + 检索工具

- **存**：`scope: "session"` 的 document（或 docFamily 按 key 分片）做全局记忆库；`scope: "conversation"` 做每会话私有记忆。fork 策略按需选（全局记忆通常 `fork: "initial"` 甚至 session scope 天然不分叉）。
- **注入**：`section("memory", async (input) => renderMemory(input.read))` 每次请求前从 committed documents 渲染（B.4 的机制，README:372-378）。注意 diff-patch 语义：注入文本应内容寻址稳定，避免每请求变化破坏 prompt cache。
- **检索**：自定义 `memory_search` 工具（defineTool + `structuredOutputSchema`），或 deferred + tool_search 的 BM25（B/A.4）。**pi 没有内建 embeddings/向量检索**——需要语义检索就自带：要么外挂向量库（工具的 `execute` 里查询外部服务），要么抄 p2 的做法在旁边建 FTS5 索引（C.5）。BM25（`packages/durable/src/search.ts`）是现成可复用的纯函数排名器。
- **写**：模型主动调 `memory_write` 工具（`api.commit()` 写 doc），或事件驱动（C.2），或 afterRun 整理任务（C.1+B.6）。
- 规模注意：document 是单 JSON 值，无内建索引/查询；大量记忆条目要么 docFamily 分 key、要么外置存储（Chord store 表有索引与 live query，`packages/chord/src/store/README.md`）。

### C.2 事件驱动的记忆写入：hook → 抽取 → doc

用 `afterResponse`（每个终态 assistant 消息）或 `afterTools` / `afterTool`（工具结果落定）做在线抽取，用 `afterRun`（run 答完、inputs 已 settle、会话仍 busy 到任务结束）做批量整理：

```ts
// 设计推演：组件签名均真实（types.ts:979-1009 / define.ts:43-48）
const Memory = defineExtension({
	name: "memory",
	tasks: [Consolidate],   // defineTask：读 run 原始历史 → 去重/合并 → 写 MemoryDoc
	hooks: [
		hook(GenerationTask, {
			// 在线：轻量抽取（注意 hook 内不能写 doc；要写就存 memo 或派任务）
			afterResponse: async (message, api, ctx) => { await api.memo("lastAnswer", message.usage); },
			// 批量：run 结束后异步整理，不阻塞答案（答案先 settle）
			afterRun: async (run, api, ctx) => ({ tasks: [runEndTask(Consolidate, { first: run.first, last: run.last })] }),
		}),
	],
});
```

在线写 doc 的正确姿势是工具内 `api.commit()` 或派生 task（hook 本身只有 `DocumentReader`）。若要"每个 commit 都看到"的实时记忆，用 `harness.observeDoc()`（同步观察者）在宿主层做旁路处理（README:523）。

### C.3 自定义上下文压缩策略

按可控程度从高到低（前两条是源码证据，后两条是推演）：

1. **pi-coding-agent 扩展**：`session_before_compact` 返回 `{ compaction: CompactionResult }` 整体替换摘要，或 `{ cancel: true }`；`context` / `context_with_system` 事件每次请求改写消息（`extensions/types.ts:899-918, 1531-1534`）；`agent_before_settle` / `turn_end` 可注入 `CompactionEntryDraft`（自定义 `firstKeptEntryId`）与 `ContextEditEntryDraft`（按 entry 替换/删除消息）。
2. **pi-durable 参数化 + 摘要替换**：`settings.compaction`（`CompactionSettings`，含 per-model `modelOverrides`）+ `beforeCompact` hook（`decline` 或自带 `summary` 文本）。
3. **自定义 head entry（推演，机制真实）**：模型上下文定义为"最新 head 标记 + 从其 head 到尾部"（`ContextView`，`types.ts:794-803`；`EntryDraft.head?: EntryId | "self"`，`types.ts:478-481`）。任何 write submission 携带数值 `head` 都会收缩活动范围——可以提交自定义 kind 的"记忆摘要 entry"（`{ kind: "app.memory-summary", model: [userMessage], head: <firstKept> }`），效果等价于自定义 compaction；busy 时在边界放置、`isStale` 逻辑自动处理多个在途摘要（`inbox.ts:156-158`）。`reset(handoff)` 则是更粗暴的"只保留一段 handoff 文本"版本。
4. **完全外层控制（经典线）**：直接用 pi-ai `Context` / pi-agent-core `transformContext`（A.2），messages 数组就是你的数据结构，压缩策略 100% 自己写（无持久化，需自配存储）。

### C.4 多 agent 记忆隔离 vs 共享

- **隔离**（默认）：每个 conversation 有独立 transcript 与 conversation-scope documents；子 agent（task-owned conversation）自动继承父 agent 配置但 transcript 全新（A.4、README:716-745）。p2 subagents 是产品级参考（`apps/p2/plugins/subagents/tools.ts`：`Anchor` background task 持有子会话所有权、`Reporter` task 把答案以 follow-up 报回父会话，requestId 幂等防重发；587 行 `defineExtension({ tasks: [Anchor, Reporter], tools: [tool] })`）。
- **共享**：session-scope document 是唯一内建的跨会话共享通道；或走 Chord store / 外部库。组合模式：**子 agent 上下文隔离 + 共享 session-scope 记忆库 document + 记忆读写工具**——子 agent 的检索工具读同一个 doc，写回时带来源标记（其 conversationId 可从 `api.conversationId` 拿到）。

### C.5 apps/p2 中可借鉴的实际用法

- **`plugins/search`（最接近"记忆检索"的实代码）**：独立的 SQLite **FTS5** 消息索引（`apps/p2/plugins/search/db.ts:43` `CREATE VIRTUAL TABLE message_search USING fts5(text, content='messages', …)`），`plugins/search/worker.ts` 实现一个 `Indexer` 对象**喂入根会话与子 agent 的消息**，用按会话确认的 catch-up 游标做幂等增量（db.ts:80-103 `index(…, through)`），查询把关键词安全转成 FTS MATCH 表达式（`query.ts:15 ftsQuery`）。这就是"**外部记忆索引旁路 durable transcript**"的参考实现：watch/扫描 entries → 增量索引 → 检索工具/命令。
- **`plugins/subagents`**：见 C.4（adapted from durable example 22）。
- **`plugins/chat-mode/digest.ts`**：mention 触发时把最多 100 条聊天消息（`MAX_DIGEST_MESSAGES`）裁剪成模型可读 digest、附件与图片限额——**上下文预算组装**的纯函数范例。
- **`src/runtime/durable.ts`**：把 durable 的 registry 挂在 Chord 的 keyed registry 上（`Extensions = keyedRegistry<Extension>("p2.durable-extensions")`，16-17 行），带开关的快照缓存（32-68 行）——**宿主动态组合记忆扩展（安装/卸载/禁用）** 的接线方式；durable 本身支持运行中 `registry.install()` 热替换（README "Reload"：进行中的调用用旧代码，下一 phase 用新代码）。

### C.6 仓库关键词扫描：没有现成记忆系统

对 `packages/durable`、`packages/agent`、`packages/ai/src`、`packages/coding-agent/src`、`apps/p2` 全量 grep：`memory`（仅命中"内存"含义，如 spec.md 的 in-memory cache）、`embedding`（仅 UI 手势/rpc 嵌入含义）、`vector`、`rag`、`consolidat*`、`recall`、`long-term`、`episodic`、`semantic memory` **全部零命中**（于 main 分支扫描）。官方"检索"能力止步于：coding-agent 与 durable 各自的 BM25 tool search（`packages/durable/src/search.ts` 注释明言是 coding agent 的拷贝）。没有发现暗示记忆方向的 TODO/roadmap。结论：**记忆层是留给宿主的空白区，积木齐全但需要自建**。

## D. 结论与取舍

**能做什么（有源码证据）**：在 pi-durable 上可以搭建一个崩溃一致的、事件驱动的、多会话的记忆架构——持久状态（defineDoc/entries）、事件源（watch/observe/hooks）、prompt 注入（section，每请求重渲染 + diff patch）、模型可见的读写与检索工具（defineTool/wrapTool/deferred+tool_search）、后台整理（defineTask + sleeping + onWake + afterRun）、上下文收缩原语（head entry/reset/compaction+beforeCompact）、子 agent 隔离与共享库组合。coding-agent 线（SDK + extensions）提供等价但无持久层的版本（context 事件、session_before_compact、Boundary drafts）。

**不能做什么**：没有内建 embeddings/向量检索/任何语义记忆（自带）；CompactionTask 无法被自定义 task 整体替换（只能 hook 摘要或走自定义 head entry/reset 绕行）；documents 没有内建二级索引/查询语言（大量条目需要 docFamily 分片或外置存储，如 Chord store 表或独立 FTS/向量库）；没有跨存储的多进程并发（单进程独占 storage；跨设备要么 readOnly 查看要么同步外部副本——p2 的 FTS 索引就是这种旁路）。

**pi-durable 线 vs. 经典线（pi-agent-core + 自建存储）的取舍**：

- **pi-durable**：得到原子持久化、崩溃恢复（checkpoint 级重跑、restartLimit、request 在途即失败尝试语义）、durable 子任务/子 agent、sleeping/onWake、watch 事件流、内建 compaction/inbox/usage——记忆的"耐久层"免费。代价：(1) **Experimental API**（README 第 3 行："The API changes without notice between releases"；monorepo 内 durable 仍在快速演进，如 GenerationTask 已是 version 2 + migrate）；(2) 执行模型是 commit-per-decision 的状态机，吞吐与延迟低于内存循环，所有写都要过 Session line；(3) 每个存储单进程独占，做"多客户端并发读写记忆"要靠外层（Chord/自有服务）；(4) 概念面大（tasks/ownership/boundary/admission 规则较多，spec.md 6500 行）。
- **经典线（pi-agent-core 或裸 pi-ai）**：`transformContext` / `prepareRequest` / `convertToLlm` / `AgentState.messages` 给了完全的上下文控制权，循环在内存里跑，接自己的存储与检索即可（也更容易接向量库和多客户端）。代价：持久化、恢复、队列、压缩、用量统计全部自建；steering/follow-up 有队列原语但没有持久 inbox。
- **折中**：宿主 UI/记忆索引用 Chord（多进程、store 表、live query），agent 运行时用 pi-durable 跑在 `StoreStorage` 上（example 35 的形态）——一套 commit 队列，记忆数据与会话数据同库但分层。

**风险点**：pi-durable 标注 Experimental，升级成本要预算（docs 有 versioned migrate 钩子缓解）；document 的 delta/checkpoint 语义要求 `checkpointWhen` 正确设置否则 replay 变长；section 内容不稳定会击穿 prompt cache；记忆工具必须考虑 replay 语义（非幂等写用 `replay: "unsafe"` 默认即可，但 crash 后丢失，重要写入建议由 task 在 checkpoint 后执行）；`readOnly` 会话无法写记忆。

---

### 本部分引用的主要源码位置（速查）

| 主题 | 文件 |
|---|---|
| Context / Message / Usage / Model.contextWindow / SystemMessage.sections | `packages/ai/src/types.ts`（466-494, 568-584, 666, 795-799, 878） |
| transcript 重放 / normalizeContext | `packages/ai/src/utils/transcript.ts` |
| 循环钩子（transformContext 等） | `packages/agent/src/types.ts`（193-342）、`agent-loop.ts`（172-311） |
| coding-agent 压缩 | `packages/coding-agent/src/core/compaction/compaction.ts` |
| AGENTS.md 加载 / system prompt sections | `packages/coding-agent/src/core/resource-loader.ts`（212-302）、`core/system-prompt.ts` |
| coding-agent 扩展事件/API | `packages/coding-agent/src/core/extensions/types.ts`（806-839, 899-918, 1531-1549, 1637-1966） |
| durable 概览 / 示例目录 | `packages/durable/README.md` |
| GenerationTask / 边界 / 交接 | `packages/durable/src/harness/generation.ts` |
| CompactionTask / selectCut | `packages/durable/src/harness/compaction.ts` |
| 调度器 / 崩溃恢复 / 唤醒 | `packages/durable/src/harness/scheduler.ts`（439-474 open, 481-488 resume, 513-536 wake, 2188-2217 run） |
| inbox / submissions | `packages/durable/src/harness/inbox.ts`、`harness/submissions.ts` |
| 核心类型（Task/TaskRuntime/Hooks/Conversation/Wake） | `packages/durable/src/types.ts`、`harness/types.ts` |
| defineDoc / defineEntry / defineTask / define·hook·section·wrap | `packages/durable/src/documents.ts`、`entries.ts`、`tasks.ts`、`harness/define.ts` |
| tool_search / BM25 | `packages/durable/src/tool-search/tool-search.ts`、`search.ts` |
| 规范（checkpointWhen / snapshotAsOf） | `packages/durable/docs/spec.md`（1305-1310, 1421-1422, 1536-1545） |
| p2 参考实现 | `apps/p2/plugins/search/*`、`plugins/subagents/tools.ts`、`plugins/chat-mode/digest.ts`、`src/runtime/durable.ts` |

---

# 第四部分 · Cloudflare 与 pi-durable 的结合（DO 后端与部署接线）

> 调研日期：2026-11-04 · 仓库：[earendil-works/pi](https://github.com/earendil-works/pi) `main` 分支（v1.5.0）。
> 调研方式：codeload.github.com 下载 main 分支 tarball 只读分析源码 / README / docs / examples / tests，未运行仓库内任何代码。
> 引用约定：仓库内路径相对仓库根；GitHub URL 形如 `https://github.com/earendil-works/pi/blob/main/<路径>`（github.com 直连失败时与 codeload 内容一致）。

## 总览：结合形态一句话

pi-durable 与 Cloudflare 的结合形态是：**一个 SQLite-backed Durable Object（DO）内嵌一个 `Harness`——DO 的 `ctx.storage`（DO SQLite）就是 pi-durable 的 Storage 后端，DO 的唯一 alarm 就是 Harness 睡眠任务的唤醒源**。pi-durable 提供四块拼图：

1. **存储适配器** `openDurableObjectSqliteStorage(ctx.storage)`（`@earendil-works/pi-durable/storage/sqlite/cloudflare`），把 DO SQLite 包装成通用 `SqliteStorage`（commits = DO 的 storage transactions）。
2. **`HarnessOptions.onWake` / `Harness.wake()` 契约**：Harness 不再自建 sleep 定时器，而是把"何时需要进程活着"（`{ active, at }`）报给宿主，宿主把它映射到 DO alarm，alarm 触发时调用 `harness.resume()`。
3. **Workers 运行时自适配**：默认 `setTimer`（`nativeTimer`）在 Workers 里拒绝 background 定时器（否则 DO 无法休眠/逐出）；`@earendil-works/pi-durable/images/cloudflare` 提供 Wrangler 可打包的 Photon WASM 图片处理器。
4. **真实 workerd 测试基建**：`packages/durable/test-workers/` 用 `@cloudflare/vitest-plugin` 在 workerd 里跑真实 DO（含 eviction、alarm），是官方给出的完整 DO 宿主参考实现。

**用户要自己写的**：DO 类本身（宿主 Harness 的 `class Session extends DurableObject`，README 与测试 worker 给出可照抄的模板）、Worker 入口与路由（按 conversationId `getByName` 寻址）、认证/HTTP/WebSocket 接入、以及 DO 内的 bash/文件类工具的替代执行环境（DO 没有文件系统；pi-env 的 SSH 执行环境依赖 `node:child_process`，无法直接在 workerd 内运行）。

```
浏览器 / 客户端
   │ HTTP / WebSocket（用户自写：认证 + 路由）
   ▼
入口 Worker（无状态，用户自写）
   │ env.SESSIONS.getByName(conversationId)   ← RPC
   ▼
Session DO（extends DurableObject，模板由 README/test-worker 提供）
   ├─ ctx.storage ──openDurableObjectSqliteStorage──► SqliteStorage（pi-durable 提供）
   │     conversations/entries/tasks/submissions/documents/document_revisions 表
   ├─ onWake(wake) ──arm()──► ctx.storage.setAlarm(min(心跳, 最早睡眠))
   ├─ alarm() ──► harness.resume()（睡醒的任务恢复运行）
   ├─ models：pi-ai（fetch 系 provider；或 env.AI binding + createAiBindingFetch）
   └─ （可选）RemoteCodemodeSandbox ──RPC──► 独立 sandbox Worker 的 CodemodeSandbox DO
```

（上图依据 README 与源码拼接；边缘 Worker → Session DO 的形态出自 `apps/p2/docs/research/chord-on-durable-objects.md` 的推荐拓扑。）

## DO 存储后端实现

### 两层结构：pi-durable 薄封装 + chord 适配器

pi-durable 侧只有一个 15 行的文件（[packages/durable/src/storage/sqlite/cloudflare.ts](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/sqlite/cloudflare.ts#L1-L15)）：它 re-export chord 的 `DurableObjectSqliteDatabase` / `DurableObjectSqliteStorage`，并提供入口函数：

```ts
import { DurableObjectSqliteDatabase, type DurableObjectSqliteStorage } from "@earendil-works/chord/sqlite/cloudflare";
import { SqliteStorage, type SqliteStorageOptions } from "./storage.ts";

/** Open durable storage on a SQLite-backed Durable Object, optionally under a table prefix. Calls given the same
 * storage object share an operation queue. */
export function openDurableObjectSqliteStorage(
	storage: DurableObjectSqliteStorage,
	options: SqliteStorageOptions = {},
): Promise<SqliteStorage> {
	return SqliteStorage.open(new DurableObjectSqliteDatabase(storage), options);
}
```

真正的 DO SQL 适配在 chord 包（[packages/chord/src/sqlite/cloudflare.ts](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/cloudflare.ts)），它实现的是 pi-durable 的可移植 SQLite 接口 `SqliteDatabase`（`exec/run/runCounted/get/all/transaction/close`，见 [packages/durable/README.md L883-890](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#L883)）。

### DO 原语映射

`DurableObjectSqliteStorage` 是对 `ctx.storage` 的**结构化类型**（不依赖 Workers 类型包），只用到两个 DO 原语（[chord/src/sqlite/cloudflare.ts L10-23](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/cloudflare.ts#L10-L23)）：

```ts
export type DurableObjectSqliteStorage = {
	readonly sql: {
		exec(query: string, ...bindings: DurableObjectSqlValue[]): {
			next(): { readonly done?: false; readonly value: Record<string, DurableObjectSqlValue> } | { readonly done: true; ... };
			toArray(): Record<string, DurableObjectSqlValue>[];
		};
	};
	transaction<T>(closure: () => Promise<T>): Promise<T>;
};
```

- **SQL 执行** → `ctx.storage.sql.exec()`（DO SQLite API，无单独 prepare 步骤）；游标只取 `next()`（`get`）或 `toArray()`（`all`）。
- **事务** → `ctx.storage.transaction(closure)`：**callback resolve 时提交、reject 时回滚**（[L174-186](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/cloudflare.ts#L174-L186)）。pi-durable 的整批 `commit(batches)` 都包在一个这样的 DO storage transaction 里。
- **序列化队列**：同一个 storage 对象上的多个 adapter 实例共享一个 `SerialQueue`（`WeakMap` 按 storage 对象索引，[L56-65](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/cloudflare.ts#L56-L65)）；事务期间后续操作排队（`hold`），空闲时同步操作立即执行（`run`）——对齐"DO 天然单线程、但 await 间隙可能插入其他事件"的现实。README 明确：多个 Pi storage 用同一 storage 对象打开时自动共享操作队列，宿主表可与 Pi 表共存于同一 DO 数据库（需走同一个 adapter 或注意排队语义）（[packages/durable/README.md L870-879](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#L870-L879)）。

### 值类型与计数语义（坑位）

- `Uint8Array` 绑定时**拷贝**成 `ArrayBuffer`，读回时转回 `Uint8Array`（[L67-86](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/cloudflare.ts#L67-L86)）。
- DO SQL 把整数绑成 double：**超出 `Number.MAX_SAFE_INTEGER` 的 `bigint` 直接抛 `RangeError`**（[L67-75](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/cloudflare.ts#L67-L75)）。
- `runCounted` 不用 DO 游标的 `rowsWritten`（那是计费口径，含索引写入），而是补发 `SELECT changes()` 取 SQLite 精确计数（[L106-112](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/cloudflare.ts#L106-L112)；workerd 实测见 [packages/durable/test-workers/storage.test.ts L56-74](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/storage.test.ts#L56-L74)）。
- `close()` 只是排队等未完操作排空——"DO 拥有自己的 storage，没有东西可关"（[L188-192](https://github.com/earendil-works/pi/blob/main/packages/chord/src/sqlite/cloudflare.ts#L188-L192)）。

### 五类记录 + document_revisions 怎么存

`SqliteStorage` 是通用的 "Pico storage contract" 可移植 SQLite 实现（[packages/durable/src/storage/sqlite/storage.ts L179](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/sqlite/storage.ts#L179)），表结构固定为 9 张表（[packages/durable/src/storage/sqlite/schema.ts L10-20](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/sqlite/schema.ts#L10-L20)）：

| 表 | 内容 |
|---|---|
| `conversations` / `entries` / `tasks` / `submissions` / `documents` | 五类记录，JSON 全量存 `record` 列，另存索引列（如 `tasks` 的 `conversation_id/kind/status/abort_requested/background`，`entries` 的 `conversation_id/head/commit_seq`） |
| `document_revisions` | 文档版本链：`kind`（`base`/`delta`）+ `version` + `content`（JSON）；读取时 `materializeDocument` 找 ≤ 时点的最近 base 再依序 apply delta（[storage.ts L709-744](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/sqlite/storage.ts#L709-L744)） |
| `record_ids` | 全局 ID 唯一性登记（跨表查重，`checkGlobalIds`，[L755-776](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/sqlite/storage.ts#L755-L776)） |
| `durable_metadata` | `next_id`/`next_seq` 单例（`mintId` 发号 + seq 分配） |
| `durable_schema` | schema 版本（当前 v2，v2 增加了 `sleeping` 任务状态，workerd 内迁移测试见 [test-workers/storage.test.ts L20-54](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/storage.test.ts#L20-L54)） |

**commit 语义对 DO 的关键适配**（[storage.ts L214-260](https://github.com/earendil-works/pi/blob/main/packages/durable/src/storage/sqlite/storage.ts#L214-L260)）：一次 `commit(batches)` 的所有 batch 在**一个** `db.transaction()`（即 DO storage transaction）里执行；每个 batch 先做自身检查（全局 ID、文档动作、copy 解析）**再写**，检查拒绝的 batch 终止循环但**之前已写的 batch 照常提交**；数据库本身的失败则整体回滚。注释明说为什么这么设计——"No savepoints, which Durable Objects do not allow: the checks run before the writes instead"（DO SQL 不支持 savepoint，所以把检查前置）。`COMMIT` 返回后才调用 `receive(index, seq)` 通知 Session"已持久"。

`SqliteStorageOptions.prefix` 支持表名前缀（与宿主表共用数据库时用），README 提醒 DO 内宿主可保留如 `_cf_` 前缀（[packages/durable/README.md L864-868](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#L864-L868)）。

### 体积/延迟注意

- 仓库内未写 DO 特有的行大小警告，但 p2 研究文档汇总了平台限制（引用 Cloudflare 文档，2026-10 查证）：**每 DO SQLite 存储 10 GB；单条 SQL 字符串/BLOB/行 2 MB；KV 键+值合计 2 MB；isolate 内存 128 MB（含 WASM）；DO 每请求 CPU 默认 30 s、可配至 5 min**（[apps/p2/docs/research/chord-on-durable-objects.md L491-505](https://github.com/earendil-works/pi/blob/main/apps/p2/docs/research/chord-on-durable-objects.md#L491-L505)）。
- CHANGELOG 记录过一个真实翻车：`toBase64` 曾为 3 MiB 图片占约 140 MB 堆，超出 DO 128 MB 内存上限，后改为 8 KiB 分块 + `btoa`（[packages/durable/CHANGELOG.md L245](https://github.com/earendil-works/pi/blob/main/packages/durable/CHANGELOG.md#L245)）。

## DO 类与 alarm/onWake 接线

### pi-durable 不自带 agent DO 类——但给出两份可照抄模板

`grep` 全仓库：pi-durable 包内**没有** `export class ... extends DurableObject`（那需要 `cloudflare:workers` 导入，会绑定 Workers 运行时）。它提供的是：

1. **README 的宿主模板**（[packages/durable/README.md L166-212](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md#L166-L212)，完整可抄）；
2. **测试参考实现 `TestSession`**（[packages/durable/test-workers/worker.ts L39-153](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/worker.ts#L39-L153)，比 README 版多了时钟偏移、脚本化模型响应等测试设施）。

真正随包**发布**的 DO 类只有一个，在 pi-codemode：`CodemodeSandboxDurableObject`（见下文"codemode"）。

### 完整接线代码（来自测试 worker，与 README 模板同构）

构造函数——打开 Harness 并武装 fallback alarm（[test-workers/worker.ts L49-84](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/worker.ts#L49-L84)）：

```ts
constructor(ctx: DurableObjectState, env: unknown) {
	super(ctx, env);
	this.#state = ctx;
	void ctx.blockConcurrencyWhile(async () => {
		// A fallback before anything can throw: an object whose open or recovery fails is started again.
		const fallback = Date.now() + HEARTBEAT_MS;              // 60 s
		const current = await ctx.storage.getAlarm();
		if (current === null || current > fallback) await ctx.storage.setAlarm(fallback);
		...
		this.#harness = await Harness.open(
			await openDurableObjectSqliteStorage(ctx.storage),
			{
				models, registry,
				settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
				now: () => this.now(),
				onWake: (wake) => {
					this.wakes.push(wake);
					// A failed alarm write resets the object; it arms again when it next starts.
					void this.arm(wake).catch(() => ctx.abort("Alarm write failed"));
				},
			},
			context,
		);
		// Armed before `resume()` runs anything, as for any call that can start work.
		await this.arm(this.#harness.wake());
		this.#harness.resume();
	});
}
```

alarm 处理器与武装逻辑（[L104-116](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/worker.ts#L104-L116)）：

```ts
async alarm(): Promise<void> {
	await this.arm({ ...this.#harness.wake(), active: true });
	this.#harness.resume();
}

/** The alarm a host arms for `wake`: the earliest sleep, or a recovery heartbeat while work can run. */
async arm(wake: Wake): Promise<void> {
	const heartbeat = wake.active ? Date.now() + HEARTBEAT_MS : undefined;
	const sleep = wake.at === undefined ? undefined : wake.at - this.#offset;
	const at = heartbeat === undefined || sleep === undefined ? (heartbeat ?? sleep) : Math.min(heartbeat, sleep);
	if (at === undefined) await this.#state.storage.deleteAlarm();
	else await this.#state.storage.setAlarm(at);
}
```

**准入工作前先武装**（[L122-126](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/worker.ts#L122-L126)）：

```ts
async submit(text: string, requestId: string): Promise<void> {
	// Arm before admitting work: a process that dies after the commit is still woken.
	await this.arm({ ...this.#harness.wake(), active: true });
	await (await this.root()).submit({ type: "input", content: text, requestId }, context);
}
```

### 为什么必须这样接（spec 的语义解释）

- `Wake = { active: boolean; at?: number }`：`active` = 有任务现在能跑/正在跑（或 reconcile 未落地）→ **进程死掉必须尽快被再唤醒**，所以宿主保持"恢复心跳"alarm；`at` = 最早的未到期睡眠（[packages/durable/src/harness/types.ts L757-764](https://github.com/earendil-works/pi/blob/main/packages/durable/src/harness/types.ts#L757-L764)）。
- `onWake` 在 **commit 被采纳之后**的 microtask 里调用（[scheduler.ts L1769-1790](https://github.com/earendil-works/pi/blob/main/packages/durable/src/harness/scheduler.ts#L1769-L1790)：`queueMicrotask`，与上次值相同不重发，throw 会被 report）。因此**宿主在发起可能让 Session 变活跃的调用（submit/compact/abortTask/abort/registry 变更）之前要先把 alarm 设成 active 心跳**——"An early wakeup is harmless; a missing one leaves work stranded"（[docs/spec.md L2813-2839](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md#L2813-L2839)）。
- alarm 写失败 → `ctx.abort()` 重置对象（重启后构造函数的 fallback alarm 再来一遍）；`Harness.open` 本身也可能失败，所以 fallback alarm 必须在 open **之前**武装。
- DO 只有一个 alarm 槽（设新值即替换）：测试与模板都用 `min(心跳, 最早睡眠)` 复用这一个槽；p2 研究文档特别警告：**宿主如果还有自己的定时例程，必须与 pi-durable 的唤醒共用同一个调度器，不能各自覆写 alarm**（[chord-on-durable-objects.md L354-376](https://github.com/earendil-works/pi/blob/main/apps/p2/docs/research/chord-on-durable-objects.md#L354-L376)）。

### sleeping 任务 → alarm 的端到端路径

1. 任务 phase 返回 `runtime.sleepUntil(at, checkpoint)` → commit 写入 `{ status: "sleeping", until, checkpoint }`（存进 `tasks` 表的 record，DO SQLite 里）。
2. scheduler 重算 `wake()` → `onWake({ active: false, at })` → 宿主 `setAlarm(at)`。
3. DO 休眠/被逐出（内存全失）。alarm 到点 → Cloudflare 重建 DO 实例 → 构造函数重跑（从 storage 重开 Harness，`resume()` 恢复调度）→ **alarm handler 也跑** → `resume()` → 到期睡眠变 runnable → 从 checkpoint 续跑。
4. 没有剩余工作 → `wake()` 两字段皆空 → `deleteAlarm()`。

workerd 里的实证测试（[test-workers/wake.test.ts](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/wake.test.ts)）：
- "sleeps through an eviction and resumes the task from its alarm"：`evictDurableObject` 逐出 → 新实例从 storage 读出 sleep → `runDurableObjectAlarm` 触发 → 任务完成、alarm 清空（L25-60）。
- "recovers a turn an eviction cut off mid-stream"：模型请求中途被逐出（faux provider 挂起），心跳 alarm 唤醒后**同一 requestId 重新 submit 找回原 submission**，重试拿到 "recovered" 回答（L62-88）。
- "can evict an object whose Harness keeps idle documents and contexts in memory"：因为 `nativeTimer` 在 Workers 拒绝 background 定时器，无挂起定时器 → DO 可被逐出（L90-105）。

## Worker 入口与路由

### pi-durable 自身：只有测试占位入口

`packages/durable/test-workers/worker.ts` 的模块导出仅为 `export default { fetch: () => new Response("pi-durable test worker") }`（[L155-157](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/worker.ts#L155-L157)）。测试全走 **Workers RPC**（`runInDurableObject(stub, cb)`）而不是 HTTP 路由。**即：把请求路由到 per-conversation DO 的入口 Worker 需要用户自己写**（模式见下）。

### 可借鉴的入口路由范例（codemode agent example）

[packages/codemode/examples/cloudflare/agent/src/index.ts L44-50](https://github.com/earendil-works/pi/blob/main/packages/codemode/examples/cloudflare/agent/src/index.ts#L44-L50) 给出了标准形态——`getByName`（`idFromName` 语义）做 per-session 寻址，RPC 方法直达 DO：

```ts
export default {
	async fetch(request, env) {
		if (request.method !== "POST") return new Response("POST a script\n", { status: 405 });
		const result = await env.SESSION.getByName("demo").runCodemode(await request.text());
		return Response.json(result);
	},
} satisfies ExportedHandler<Env>;
```

对应 pi-durable 的 DO 同样暴露 `submit/abort/compaction` 等 RPC 方法，入口 Worker 做 `env.SESSIONS.getByName(conversationId)`（类型上 `DurableObjectNamespace<Session>`）。p2 研究文档进一步建议：入口 Worker 做认证后，删除客户端自报身份的头、盖上可信 principal 头再转发（[chord-on-durable-objects.md L84-101](https://github.com/earendil-works/pi/blob/main/apps/p2/docs/research/chord-on-durable-objects.md#L84-L101)），WebSocket 升级转发给 DO 时用 `WebSocketPair + ctx.acceptWebSocket` 做 hibernation（[L115-135](https://github.com/earendil-works/pi/blob/main/apps/p2/docs/research/chord-on-durable-objects.md#L115-L135)）——这部分是**建议而非已实现代码**（该文档明确标注 `[Inference]`）。

### 用户自写 vs. 包提供的分界

| 组件 | 提供 | 来源 |
|---|---|---|
| Storage 适配（DO SQLite → pi Storage） | pi-durable | `/storage/sqlite/cloudflare` |
| sleep→wake 契约、resume、崩溃恢复、重启计数 | pi-durable | Harness/scheduler |
| DO 类模板（构造/alarm/arm/submit 前武装） | 文档+测试模板，需拷贝进你的 Worker | README L166-212 / test-workers/worker.ts |
| 入口 Worker（认证、`getByName(conversationId)` 路由、HTTP/WS 接入） | **用户自写** | 模式见 codemode example |
| codemode 沙箱 DO + 远端沙箱客户端 | pi-codemode | `/cloudflare` + `/portable` |
| 图片处理（Photon WASM） | pi-durable | `/images/cloudflare` |
| bash/文件工具的执行环境 | **用户自写**（DO 无 fs；见 pi-env 一节） | — |

## 部署配置与 workerd 兼容性

### wrangler 配置（仓库内两处实证）

pi-durable 测试 Worker（[packages/durable/test-workers/wrangler.jsonc](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/wrangler.jsonc)，全文件）：

```jsonc
{
	"name": "pi-durable-test-workers",
	"main": "./worker.ts",
	"compatibility_date": "2026-10-01",
	"compatibility_flags": ["nodejs_compat"],
	"durable_objects": {
		"bindings": [{ "name": "SESSIONS", "class_name": "TestSession" }]
	},
	"migrations": [{ "tag": "v1", "new_sqlite_classes": ["TestSession"] }]
}
```

要点：**`nodejs_compat` 兼容旗标**（pi-durable 及其依赖仍部分走 Node 兼容层）；**`new_sqlite_classes` migration**（SQLite-backed DO 必需，普通 `new_classes` 不给 SQL API）。

codemode 双 Worker 配置（部署时**先 sandbox 后 agent**，因为 agent 以 `script_name` 引用 sandbox）：
- sandbox（[packages/codemode/examples/cloudflare/sandbox/wrangler.jsonc](https://github.com/earendil-works/pi/blob/main/packages/codemode/examples/cloudflare/sandbox/wrangler.jsonc)）：`workers_dev: false`（无 HTTP 路由，仅 DO binding 可达）、`limits: { cpu_ms: 60000 }`（默认 30 s CPU；**必须高于 interrupt budget 允许的时间**，否则脚本超时会重置整个对象而非报超时错误）。
- agent（[agent/wrangler.jsonc](https://github.com/earendil-works/pi/blob/main/packages/codemode/examples/cloudflare/agent/wrangler.jsonc)）：`"bindings": [{ "name": "SESSION", "class_name": "Session" }, { "name": "CODEMODE_SANDBOX", "class_name": "CodemodeSandbox", "script_name": "pi-codemode-sandbox" }]`——跨 Worker DO binding 用 `script_name`。

### 依赖在 workerd 下的状态（逐项）

| 依赖 | workerd 状态 | 证据 |
|---|---|---|
| pi-durable 核心（chord、delta、diff 等） | 可移植 SQLite / JSONL 核心明确声明"run without Node APIs … in Cloudflare Durable Objects" | README L881 |
| 定时器 | `nativeTimer` 检测 `navigator.userAgent === "Cloudflare-Workers"`，**拒绝 background 定时器**（挂起定时器会阻止 DO hibernate/evict，即使 `nodejs_compat` 给了 `unref()` 也没用） | [src/timers.ts L6-18](https://github.com/earendil-works/pi/blob/main/packages/durable/src/timers.ts#L6-L18)；CHANGELOG L228 |
| pi-ai provider SDKs | 基于 fetch + Web Streams，workerd 可用；**模型调用在 DO 内只被 faux provider 测过**（脚本化假响应），真实网络 provider 未在 workerd 测试 | test-workers/worker.ts L58-61 |
| Workers AI / AI Gateway | `cloudflareWorkersAIProvider()`（OpenAI 兼容 REST，需 API key）+ `createAiBindingFetch(env.AI)`（AI Gateway 的 binding 直连，`https://workers-binding.ai/ai-gateway/...`，免 token、请求原样透传） | [packages/ai/src/api/cloudflare-ai-binding.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/cloudflare-ai-binding.ts)（binding 测试在 Node 中以 fake binding 跑，[test/cloudflare-ai-binding.test.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/test/cloudflare-ai-binding.test.ts)） |
| codemode（QuickJS WASM） | Workers **不能运行时编译 WASM**：必须靠 Wrangler 的 `CompiledWasm` 规则把 `quickjs.wasm` 变成编译模块（约 640 KB）；`/cloudflare` 入口专供 Wrangler，其他打包器用 `/portable` | [packages/codemode/src/cloudflare.ts L1-29](https://github.com/earendil-works/pi/blob/main/packages/codemode/src/cloudflare.ts#L1-L29) |
| photon WASM（图片处理） | 同上走 `CompiledWasm`（`/images/cloudflare`）；**内存警示**：解码要占图片全尺寸的 WASM 内存且不回缩，"leave the processor out on memory-constrained hosts such as Cloudflare Workers unless images stay small" | [src/images/cloudflare.ts](https://github.com/earendil-works/pi/blob/main/packages/durable/src/images/cloudflare.ts)；README L258 |
| 动态代码 | Workers 禁 `eval`/`new Function`，`node:vm`/`child_process`/`worker_threads` 是非功能性 stub；插件/扩展必须**构建期静态导入**进 registry | chord-on-durable-objects.md L316-321, L534-538 |

### Cloudflare worker 测试到底覆盖什么

- 运行方式：`npm run test:workers`（[packages/durable/package.json L128-130](https://github.com/earendil-works/pi/blob/main/packages/durable/package.json#L128-L130)）→ `@cloudflare/vitest-plugin@1.4.10` + workerd，"the Durable Object storage, alarms, and eviction are Cloudflare's own"（[test-workers/vitest.config.ts L7-10](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/vitest.config.ts#L7-L10)）。
- `wake.test.ts`：三条（见上节）——睡眠穿越逐出、流中逐出恢复（含 retry 与 requestId 幂等）、可逐出性。
- `storage.test.ts`：**整套 storage conformance suite**（`registerStorageConformance`，与 Node/内存/IndexedDB/JSONL 后端同一套）在真实 DO 内以表前缀隔离运行；外加 schema v1→v2 迁移、`runCounted` 语义。
- `cloudflare:test` 提供 `runInDurableObject / runDurableObjectAlarm / evictDurableObject`（类型垫片见 [test-workers/cloudflare.d.ts](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/cloudflare.d.ts)）。
- 未覆盖：真实 provider 网络调用（faux only）、WebSocket 客户端接入、codemode 在同一矩阵里未与 pi-durable DO 联测、计费/延迟基准（chord 研究文档明言"No deployment, benchmark or runtime conformance test was performed"指其自身）。

### 性能实测（codemode，官方数据）

QuickJS 同步执行会霸占线程：session DO 内联跑脚本时，10 秒纯计算的脚本让该对象**所有**其他请求延迟整整 10 秒；放进独立 Worker 的 DO 后延迟仅约 50 ms（2026-10 Cloudflare 实测，[packages/codemode/README.md L138-145](https://github.com/earendil-works/pi/blob/main/packages/codemode/README.md#L138-L145)）。这就是 sandbox 必须独立 Worker 的原因——同一 Worker 内的 DO 类可能共享 isolate/线程。

## pi-codemode：唯一随包发布的 DO 类

`CodemodeSandboxDurableObject`（[packages/codemode/src/cloudflare.ts L61-75](https://github.com/earendil-works/pi/blob/main/packages/codemode/src/cloudflare.ts#L61-L75)）：

```ts
export class CodemodeSandboxDurableObject<Env = unknown> extends DurableObject<Env> {
	protected maxInterruptBudget: number = DEFAULT_INTERRUPT_BUDGET;   // 100k polls ≈ 10 s on CF
	protected maxMemoryLimitBytes: number = DEFAULT_REMOTE_MEMORY_LIMIT_BYTES;  // 32 MiB（isolate 共 128 MB）

	execute(request: CodemodeRemoteRequest, exchange: CodemodeRemoteExchange): Promise<void> {
		return serveCodemodeRemote(request, exchange, { wasm: quickjsWasm, ... });
	}
}
```

- 无状态、不碰 storage、按执行或按 session 命名实例；限额是服务端封顶（客户端只能要更少），改限额靠子类覆写字段。
- agent 侧用 `RemoteCodemodeSandbox`（从 `/portable` 导入，无 Node 依赖）：**工具与调用记录留在 session DO**，每次工具调用经 Workers RPC 回调回 session；`remote: () => env.CODEMODE_SANDBOX.getByName(sessionId)`。
- 账单口径：每次执行是一个 DO 请求，等待工具期间也计 wall-clock（[codemode/README.md L214-232](https://github.com/earendil-works/pi/blob/main/packages/codemode/README.md#L214-L232)）。

## pi-env 组合：DO 里的 harness 如何执行远程工具

pi-env 的定位原文（[packages/env/README.md L3-5](https://github.com/earendil-works/pi/blob/main/packages/env/README.md#L3-L5)）：

> Remote execution environments for Pi Durable: **an agent's tools run on another machine, usually over SSH, while the Durable worker, its storage and credentials stay local.**

注意这里的 "Durable worker" 指**跑 pi-durable 的进程**（设计形态是 Node 进程），不是 Cloudflare Worker。关键事实：

- `Connection` 通过 `node:child_process` 的 `spawn` 启动 `ssh`/daemon（[packages/env/src/connection.ts L1, L304](https://github.com/earendil-works/pi/blob/main/packages/env/src/connection.ts#L1)；[ssh.ts L1, L134](https://github.com/earendil-works/pi/blob/main/packages/env/src/ssh.ts#L1)）。
- 而 Workers 的 `child_process` 是非功能性 stub（p2 研究文档引 Cloudflare 文档，[chord-on-durable-objects.md L318-321](https://github.com/earendil-works/pi/blob/main/apps/p2/docs/research/chord-on-durable-objects.md#L318-L321)）。
- **结论：`RemoteExecutionEnv` 不能直接在 DO 里用**。Workers 也没有持久文件系统（`node:fs` 只有只读 bundle + 请求级临时内存文件，`fs.watch` 不支持，[L333-336](https://github.com/earendil-works/pi/blob/main/apps/p2/docs/research/chord-on-durable-objects.md#L333-L336)）。

与 DO harness 的**真实集成点**是 `HarnessOptions.env` 回调：Harness 为每个会话构建 ExecutionEnv（[packages/durable/src/harness/harness.ts L246, L292-297](https://github.com/earendil-works/pi/blob/main/packages/durable/src/harness/harness.ts#L292-L297)）：

```ts
/** Build a conversation's environment from its current `cwd`; `undefined` without an `env` option. */
async buildEnv(id: ConversationId, context: Context): Promise<ExecutionEnv | undefined> {
	const build = this.#options.env;
	if (build === undefined) return undefined;
	const cwd = (await this.snapshot(AgentDoc, id, context))?.cwd;
	return build({ conversationId: id, ...(cwd === undefined ? {} : { cwd }), read: this }, context);
}
```

`ExecutionEnv` 是接口（exec/read/write/watch/listFiles 等结构化方法，协议是 stdin/stdout 帧协议），因此 DO 宿主理论上可以写一个"网络桥接 ExecutionEnv"——把帧协议经 WebSocket/HTTP 转发给一台跑 pi-env daemon 的 Node 机器——**但仓库里没有现成实现，这是明确的缺口**。两种现实架构：

1. **Node 主机 + pi-env（文档化形态）**：pi-durable 跑在 Node（本地/VM），tools 经 SSH 到远程机器。Cloudflare 不参与。
2. **Cloudflare DO harness**：模型调用、对话状态、任务编排都在 DO；bash/文件类工具要么不带（纯对话/编排型 agent），要么自建桥接 env（把 `ExecutionEnv` 的调用转发到自部署的执行服务——pi-env daemon 的帧协议可直接复用为其后端）。

## 最小部署配方（按证据拼装）

以下步骤全部来自仓库内证据；标〔自建〕的步骤仓库只提供模式、无现成代码。

1. **建 Worker 项目**，`npm install @earendil-works/pi-durable`（及 `@earendil-works/pi-ai`、可选 `@earendil-works/pi-codemode`）。
2. **wrangler.jsonc**：抄 [test-workers/wrangler.jsonc](https://github.com/earendil-works/pi/blob/main/packages/durable/test-workers/wrangler.jsonc)——`compatibility_flags: ["nodejs_compat"]`、DO binding + `migrations: [{ tag: "v1", new_sqlite_classes: ["Session"] }]`。
3. **Session DO 类**：抄 README L166-212 或 test-worker 模板。要点逐条落实：
   - 构造函数 `blockConcurrencyWhile` 内：先设 60 s fallback alarm → `openDurableObjectSqliteStorage(ctx.storage)` → `Harness.open(storage, { models, registry, onWake, ... })` → `await arm(harness.wake())` → `resume()`。
   - `onWake` → `arm(wake)`：`min(active ? now+60s : ∞, wake.at ?? ∞)` → `setAlarm`；两者皆空 → `deleteAlarm`；写失败 → `ctx.abort()`。
   - `alarm()` → `arm({ ...wake(), active: true })` → `resume()`。
   - 每个"能启动工作的 RPC 方法"（submit/compact/abortTask/abort 等）**先 `arm({...active:true})` 再干活**。
   - 暴露 RPC 方法（DO 类公有方法即 Workers RPC）。
4. **models**：`createModels()` + 所需 provider。Cloudflare 原生路线：Workers AI provider（REST）或 AI Gateway + `createAiBindingFetch(env.AI)`（wrangler 加 `[ai_binding]`，免 API token）；或普通 fetch 型 provider + secrets。〔自建：secrets 管理〕
5. **registry**：所有扩展/任务/工具**静态 import** 后 `createRegistry().install(...)`（Workers 无 eval）。
6. **入口 Worker**〔自建〕：`exportedHandler` 里认证 + `env.SESSIONS.getByName(conversationId)` 转发（模式照 codemode agent example；WebSocket 参见 p2 文档建议）。
7. **可选 codemode**：单独部署 sandbox Worker（一行 re-export + wrangler.jsonc，`workers_dev:false`、`cpu_ms` 高于 interrupt budget），agent 侧 `new RemoteCodemodeSandbox({ tools, remote: () => env.CODEMODE_SANDBOX.getByName(sessionId) })`，`script_name` 跨 Worker 绑定。**先部署 sandbox。**
8. **可选图片**：`import { createCloudflarePhotonImages } from "@earendil-works/pi-durable/images/cloudflare"` 传给 `createCodingTools({ images })`；小图才建议开启（内存不回缩）。
9. **测试**：仿 `test-workers/` 用 `@cloudflare/vitest-plugin` + `runInDurableObject/evictDurableObject/runDurableObjectAlarm` 写自己的 workerd 集成测试。
10. **观测/善后**：接 `onReport`（`storage_failed` 常为平台 reset、`task_faulted`/`task_interrupted` 喂断路器）；DO 无关闭钩子，清理要幂等。

## 缺口与自建清单

| # | 缺口 | 现状证据 | 自建工作量 |
|---|---|---|---|
| 1 | **Session DO 类不随包发布** | 只有 README/测试模板；pi-durable 不导入 `cloudflare:workers`（保持可移植） | 小：照抄模板 ~80 行 |
| 2 | **入口 Worker / 认证 / WS 接入** | 仅 codemode example 的 `getByName` 一行模式；p2 文档的边缘认证/WS hibernation 是 `[Inference]` 建议 | 中：认证、路由、协议 |
| 3 | **DO 内 bash/文件工具执行环境** | `child_process` 是 stub；pi-env `Connection` 直接 spawn；Workers 无持久 fs | 大：自建桥接 ExecutionEnv（可复用 pi-env daemon 帧协议），或工具全部走外部服务 |
| 4 | **真实 provider 在 DO 内的验证** | workerd 测试只用 `fauxProvider`；pi-ai 本身 fetch-based 理论可用，AI binding 传输在 Node fake 上测 | 中：跑真实 key 的集成验证 + 流式稳定性 |
| 5 | **共享 alarm 的宿主定时例程** | DO 单 alarm 槽；p2 文档警告不可各自覆写 | 设计约束：所有定时意图走同一个 `arm()` |
| 6 | **大对象存储** | 2 MB 行限制；p2 建议 SQLite 放元数据、R2 放大内容（两阶段提交模式） | 中：应用层分域 |
| 7 | **CPU/内存上限配置** | isolate 128 MB（含 WASM）、DO 请求 CPU 30 s 默认；codemode 已给 `cpu_ms` 配置先例 | 配置 + 容量规划 |
| 8 | **deploy 文档** | 无 pi-durable 官方部署指南；最接近的是 codemode example README 的双 Worker 部署命令 | 按本配方第 1-7 步操作 |

**与 Node 形态的取舍**：DO 形态买到的是免运维的持久会话 + 睡眠唤醒（scale-to-zero）+ 平台级 eviction 恢复语义（这些都有 workerd 测试兜底）；付出的是工具执行域被砍掉（无 fs/进程）、128 MB 内存墙、静态 registry、以及自建入口与桥接层。编排密集、工具轻的 agent 适合上 DO；重 bash/文件工作的 agent 在当前仓库形态下更适合 Node + pi-env（可后置 Cloudflare 作为前端/编排层）。

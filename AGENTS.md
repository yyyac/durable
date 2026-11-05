# AGENTS.md

## Agent skills

### Issue tracker

议题存放于本仓库的 GitHub Issues，通过 `gh` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认标签：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `GLOSSARY.md` + `docs/adr/`。详见 `docs/agents/domain.md`。


## 代码注释

- 注释采用中文注释
- 注释仅用于解释具体业务规则、代码中不直观的约束，以及复杂逻辑的实现原因和边界条件。
- 优先通过清晰命名和代码结构表达意图；代码本身已清楚表达的内容无需重复注释。
- Ticket 的编号、标题、需求原文、验收清单、实施计划和完成情况保留在 issue、提交说明或 PR 描述中，不写入代码注释。
- 将需求落实为代码行为；确需注释时，直接解释长期有效的业务或技术原因，不使用“根据 ticket 要求”“为满足验收条件”等任务叙述。
- 交付前检查本次新增或修改的注释，删除任务过程记录和重复代码含义的内容。

> 例如：
>
> 不合适：根据 ticket #12 要求，防止同一会话并发执行。
>
> 合适：同一会话串行执行，避免工具结果写入错误的对话上下文。

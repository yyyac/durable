# 领域文档

工程技能在探索代码库时应如何消费本仓库的领域文档。

## 探索前先阅读

- 仓库根目录的 **`GLOSSARY.md`**，或
- 根目录的 **`GLOSSARY-MAP.md`**（如存在）：它指向每个上下文各自的 `GLOSSARY.md`，阅读与主题相关的每一份。
- **`docs/adr/`**：阅读与你即将工作的领域相关的 ADR。多上下文仓库还需检查 `src/<context>/docs/adr/` 中该上下文范围的决策。

这些文件若不存在，**静默继续**。不要指出其缺失，也不要建议预先创建。`/domain-modeling` 技能（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 进入）会在术语或决策真正敲定时惰性创建它们。

## 文件结构

单上下文仓库（绝大多数仓库）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `GLOSSARY-MAP.md`）：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← 上下文专属决策
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## 使用术语表中的词汇

当你的输出提到某个领域概念（议题标题、重构提案、假设、测试命名）时，使用 `GLOSSARY.md` 中定义的术语。不要漂移到术语表明确规避的同义词。

如果你需要的概念还不在术语表中，这是一个信号：要么你在发明项目并不使用的语言（请重新考虑），要么存在真实缺口（记下来交给 `/domain-modeling`）。

## 标记 ADR 冲突

如果你的输出与现有 ADR 矛盾，显式指出而不是静默覆盖：

> _与 ADR-0007（event-sourced orders）矛盾，但值得重开，因为……_

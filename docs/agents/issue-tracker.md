# 议题跟踪器：GitHub

本仓库的议题（issue）与规格（spec）以 GitHub Issues 形式存放。所有操作使用 `gh` CLI 完成。

## 约定

- **创建议题**：`gh issue create --title "..." --body "..."`。多行正文请使用 heredoc。
- **读取议题**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出议题**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需附加 `--label` 与 `--state` 过滤。
- **将议题设为父议题的子议题**：`gh issue create --parent <parent> ...`，或事后 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（database id，见下文「阻塞」）。无法使用子议题时，在子议题正文顶部写 `Part of #<parent>`。
- **评论议题**：`gh issue comment <number> --body "..."`
- **应用 / 移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

在克隆目录内运行时 `gh` 会自动从 `git remote -v` 推断仓库，无需手动指定。

## PR 作为 triage 入口

**PR 作为请求入口：否。** _（若本仓库将外部 PR 视为功能请求，改为 `yes`；`/triage` 会读取此开关。）_

设为 `yes` 时，PR 与议题走相同的标签与状态，使用对应的 `gh pr` 命令：

- **读取 PR**：`gh pr view <number> --comments`；diff 用 `gh pr diff <number>`。
- **列出待 triage 的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的议题与 PR 共用同一编号空间，因此裸 `#42` 可能是二者之一：先用 `gh pr view 42` 解析，失败再回退到 `gh issue view 42`。

## 当技能说「发布到议题跟踪器」

创建一个 GitHub issue。

## 当技能说「获取相关工单」

按上文**读取议题**的方式读取。

## 寻路操作（wayfinding）

由 `/wayfinder` 使用。**地图（map）**是单个议题，其**子议题（child）**即工单。

- **地图**：单个打有 `wayfinder:map` 标签的议题，承载 Notes / Decisions-so-far / Fog 正文。`gh issue create --label wayfinder:map`。
- **子工单**：以 GitHub 子议题形式关联到地图的议题（见**将议题设为父议题的子议题**）。子议题不可用时，把子工单加进地图正文的一个任务列表，并在子工单正文顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。被认领后，工单分配给推动开发的开发者。
- **阻塞**：GitHub 的**原生议题依赖**，是规范的、UI 可见的表示。用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加一条边，其中 `<blocker-db-id>` 是阻塞者的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#编号` 或 `node_id`）。GitHub 通过 `issue_dependencies_summary.blocked_by`（仅开放阻塞者，即实时门控）上报。依赖不可用时，回退为在子工单正文顶部写 `Blocked by: #<n>, #<n>`。所有阻塞者关闭后工单即解锁。
- **前沿查询**：列出地图的开放子工单（`gh issue list --state open`，限定在地图的子议题 / 任务列表范围内），剔除有开放阻塞者（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中存在开放议题）或已有 assignee 的；按地图顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，作为本次会话的第一次写入。
- **解决**：`gh issue comment <n> --body "<答案>"`，然后 `gh issue close <n>`，再向地图的 Decisions-so-far 追加上下文指针（gist + 链接）。

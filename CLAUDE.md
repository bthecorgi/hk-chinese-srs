## Delegation: use a Sonnet subagent for implementation and terminal work

This section applies only to the **main (top-level) agent in an interactive session**.

- **Delegate** code implementation (writing/editing files) and non-trivial terminal work (builds, tests, installs, scripts, commits/pushes) to a subagent: call the Agent tool with `subagent_type: "general-purpose"` and `model: "sonnet"`. Never use `subagent_type: "fork"` for this; forks ignore `model` and run on the parent model. Give the subagent a complete, self-contained prompt (paths, branch, exact goal, what to report back), since it starts without the conversation's context.
- **Do directly, without a subagent:** read-only commands and file reads needed to plan or verify (`git status`, `git log`, `git diff`, `ls`, Read/Grep/Glob), and quick single-command skill workflows (e.g. log-medicine, save-bookmark, find-bookmark) where a subagent would cost more than the task itself.
- **If you are a subagent** (spawned via the Agent tool), ignore this section and do the work yourself. Never delegate further.
- **Headless runs** (`claude --print`, e.g. google-chatbot) or sessions without an Agent tool: do the work directly.

The main agent keeps planning, reviewing the subagent's results, and talking to the user.

> This section is duplicated in `bthecorgi/baileycode` and `bthecorgi/hk-chinese-srs`. Change both together.

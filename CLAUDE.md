## Delegation: use a Sonnet subagent for implementation and terminal work

All code implementation (writing/editing files) and terminal execution (Bash commands: builds, tests, git, scripts, installs) must be delegated to a subagent running on Sonnet — call the Agent tool with `model: "sonnet"`. The main agent handles planning, reading/understanding the request, reviewing the subagent's results, and talking to the user. Give the subagent a complete, self-contained prompt (paths, branch, exact goal, what to report back), since it starts without the conversation's context.

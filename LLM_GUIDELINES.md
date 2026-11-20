# LLM guidelines

Shared rules for anyone (human or AI) using an LLM — Claude Code, ChatGPT, Copilot, etc. — to work on the MA Climate Coalition Map.

1. Be brief in final answers.
2. You are an LLM, so consider if you could be wrong. I'm a human, so consider if I could also be wrong, or if there could be better things.
3. Consider the underlying purpose of a question or a statement. If a question or contention I provide can be taken in multiple ways, ask for a clarifying example if you are uncertain.
4. Track your uncertainty/accuracy in your responses as conversations progress: how sure are you that something will work, and what ambiguities exist for a certain mechanism?
5. Number everything in your responses so I can answer each point on its own: top-level points `1`, `2`, `3`, sub-points `1.1`, `1.2`, and deeper `1.1.1`, `1.1.2`. Every suggestion, question and option gets its own number, and numbers stay the same if you repeat a list later, so a reply like "1.2 yes, 2.1 no" is unambiguous.
6. Tags for responses:
   1. `[0]` = no response — only for you to know, for decision making on other things
   2. `[1]` = ruling only — e.g. "yes, X and Y should be done"
   3. `[2]` = some detail (default) — e.g. "yes, X should be done because…"
   4. `[3]` = more detail — e.g. "yes, X should be done because… though Y is another option…"
   5. `[4]` = teaching mode
7. The default tag is `[2]`, but the tag is context dependent (e.g. if I ask you to teach me, it is clearly `[4]`).
8. Always `git pull` and check for pending merge requests when coding after a pause.
9. Use merge requests (pull requests) instead of pushing changes directly.
10. We work on `development_branch`, not `main`.
11. Log what you did and why in `<username>_LLM.log` (e.g. `nkessel_LLM.log`).

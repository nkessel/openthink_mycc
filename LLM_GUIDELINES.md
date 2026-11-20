# LLM guidelines

Shared rules for anyone (human or AI) using an LLM — Claude Code, ChatGPT, Copilot, etc. — to work on the MA Climate Coalition Map.

1. Be brief in final answers.
2. You are an LLM, so consider if you could be wrong. I'm a human, so consider if I could also be wrong, or if there could be better things.
3. Consider the underlying purpose of a question or a statement. If a question or contention I provide can be taken in multiple ways, ask for a clarifying example if you are uncertain.
4. Track your uncertainty/accuracy in your responses as conversations progress: how sure are you that something will work, and what ambiguities exist for a certain mechanism?
5. Number everything in your responses so I can answer each point on its own: top-level points, then sub-points (`12.1`, `12.2`) and deeper (`12.1.1`). **Never reuse a number in a conversation:** each reply continues from the last top-level number you used (if your last reply ended at 11, this one starts at 12), so "12.1 yes" always points to exactly one place. Every suggestion, question and option gets its own number; if you bring back an earlier point, cite its original number ("see 7.2") instead of renumbering it.
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
12. **One decision per number.** Never bundle separate design or product decisions under one number (or under `x.1`–`x.4` as if they were one). Give each decision its own top-level number so it can be approved or rejected alone.
13. **Every design question comes with its mockup link**, right next to the number it belongs to, so I can approve from the point itself.
14. **Show design ideas in the real UI, never in a made-up context.** Mockups must be screenshots of (or built inside) the actual page: the real progress bar, bar buttons, card layout, theme and widths (desktop and phone), not a simplified stand-in. If the idea isn't built yet, prototype it in the real page (or inject it into the real page's DOM) and screenshot that. Abstract option sketches are only fine as a short legend beside real-context pictures.

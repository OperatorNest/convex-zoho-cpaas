---
name: runtime-verification
description: Verify simulator and anonymous local runtime behavior.
---

# Runtime verification

Use AGENTS' check table. Run affected tests, then the required gate. Regenerate bindings after schema or function changes; never edit them by hand. Codegen and smoke hold the shared anonymous-backend lock. Do not terminate another checkout's backend. Report commands and exit codes, distinguishing simulator, local runtime, and live-account observations. Live e2e requires an attended maintainer account and the documented dry run; never run it in CI.

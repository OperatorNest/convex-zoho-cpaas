# ADR 0003: Require explicit test mode

Zoho tokens have no documented live/test prefix. Never infer test mode from credentials. Only client `testMode: true` or env `ZOHO_CPAAS_TEST_MODE === "true"` enables simulation. Simulation skips provider calls even when a token exists; tests use dummy credentials.

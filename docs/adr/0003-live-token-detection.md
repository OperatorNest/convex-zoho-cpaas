# ADR 0003: Live-token detection is not applicable

## Context

Test mode must refuse credentials with a recognizable live prefix. Zoho CPaaS tokens have no documented live-versus-test prefix that the component can recognize reliably.

## Decision

Require explicit test-mode opt-in and never infer test mode from a token. Do not guess whether a Zoho token is live from its contents.

## Consequences

An operator can opt in to test mode while a real token is configured; no provider call occurs in test mode. Tests and examples use dummy credentials.

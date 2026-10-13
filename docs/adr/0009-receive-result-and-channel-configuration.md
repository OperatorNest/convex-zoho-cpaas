# 0009: Report webhook outcomes by reason and configuration per channel

Component `webhooks.receive` returns `{ reason }` only. `reason: "duplicate"` already identifies an already committed body, so a separate `duplicate` boolean would give two representations of one fact that callers could read inconsistently. The internal failed-receipt mutation returns nothing, because a failed receipt never deduplicates.

`config.get` returns `configured` as `{ email, sms, whatsapp }`. Each channel resolves its own token before the shared token, so one boolean cannot tell an SMS or WhatsApp caller whether its channel can send live. Secrets stay omitted.

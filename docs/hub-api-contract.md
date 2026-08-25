# Hub-to-Dialer API contract

This is the Dialer-only subset used by the existing DMNT Hub UI. The actual
handlers are preserved in `electron/main.ts`; no Google Maps Parser routes are
part of this project.

The headless bridge listens on the configured service host, port `8789`:

- `GET /health` — service health and queue summary
- `GET /settings`, `POST /settings` — Dialer and campaign settings
- `POST /settings/test-vapi` — validate Vapi access and list assistants
- `POST /settings/test-telephony` — validate the selected telephony provider
- `POST /settings/test-telegram` — validate optional notifications
- `GET /state` — current campaign, contacts, outcomes, and user-visible events
- `POST /import` — safe JSON bulk import (`contacts` array)
- `POST /control` — `start`, `pause`, `resume`, or `stop`
- `POST /retry` — requeue supported terminal statuses
- `POST /contacts/:id/call-again` — create a new preserved attempt
- `GET /history` — campaign history catalog
- `GET /history/:id/results` — paginated normalized results
- `GET /history/:id/export` — full UTF-8 CSV export

The Vapi webhook listener uses port `8787` and accepts `POST /webhook`.

Security requirement: both bridge ports are internal services. A future web
deployment must authenticate settings/state routes and expose only the webhook
route required by Vapi. Secrets must be write-only or masked in browser-facing
responses before this API is published independently.

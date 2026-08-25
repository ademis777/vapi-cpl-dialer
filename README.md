# Vapi CPL Dialer

Clean-room project copy based on the proven DMNT Dialer calling foundation.
This initial baseline intentionally preserves the existing single-line calling
behavior. Four-line dialing and CPL-specific business logic are not implemented
yet.

## Included foundation

- Vapi outbound calls, webhook handling, and polling reconciliation
- BYO SIP provisioning and telephony providers
- CSV and bulk imports, phone normalization, global deduplication, and DNC
- persistent sequential queue with Start, Pause, Stop, retry, and Call Again
- call lifecycle, IVR navigation, DTMF, silence/goodbye/duration limits
- structured outcomes, campaign history, and CSV exports
- the proven Electron control UI and the internal Hub HTTP API contract

Google Maps Parser and all DMNT runtime/user data are intentionally excluded.

## Local development

```bash
npm ci
npm test
npm run build
npm run dev
```

Runtime data must stay in an ignored local directory. Never reuse or mount a
production DMNT data volume. Do not commit API keys, SIP credentials, customer
records, call logs, transcripts, recording URLs, exports, or debug call payloads.

## Source provenance

The TypeScript calling engine and Electron UI were copied from the current
working `/opt/dmnt-dialer` source on 2026-08-25. The Hub endpoints consumed by
the control surface are documented in `docs/hub-api-contract.md`; Parser code
and Parser routes were not copied.

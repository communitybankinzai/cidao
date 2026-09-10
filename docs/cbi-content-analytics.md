# CBI content analytics (2026-09-10)

- Presentation moved from CiDAO /admin/analytics to CBI /admin/#metaverse. CiDAO core PV/VV remains separate.
- POST /api/cbi-site-analytics accepts a random document ID, persistent browser ID and world/disaster-map category. Retries use the same document ID and do not inflate PV.
- GET returns daily aggregate counts only. VV is distinct browser IDs per content per JST day, not people or a period-wide sum.
- cbi_content_views has RLS; only service_role can insert/select. No raw identifiers are exposed in the aggregate API. No names, IPs or account tokens collected.
- Migration 20260910120000_cbi_content_views.sql applied on 2026-09-10. Existing presence data is unchanged and is returned separately as legacy_sessions. Historical PV/VV cannot be reconstructed; dates before 2026-09-10 are null. The first day is partial.
- Client skips notiles/cinema/local test pages and browsers without localStorage. Sources: CBI assets/cbi-content-tracking.js, admin/cbi-content-analytics.js.
- Validation: npx tsc --noEmit; node scripts/verify-cbi-content.mjs (transaction rollback, duplicate suppression, per-content PV/VV, anonymous access denied).
- No additional paid service introduced. This adds one small insert per document load and aggregate queries on the existing infrastructure.

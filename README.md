# BNL Badminton

Production migration baseline for **Badminton Nations League — Season 02 / Rise Together**.

## Included
- Dark responsive UI based on the current BNL ChatGPT Site direction.
- Season 01 archive and Season 02 switcher.
- Official Season 02 master schedule: **35 matches / 3 sessions / 20 appearances per athlete**.
- Mobile-first schedule filters and score-entry UX.
- Derived Season 02 standings.
- Season 01 historical standings imported from the current BNL Google Sheet.
- Athlete roster, pairing map, and operating rules.

## Verified schedule constraints
- 35 matches total.
- 140 athlete appearances = 7 athletes × 20 appearances.
- Every athlete appears exactly 20 times.
- Hào–Uyên are never teammates.

## Current migration caveat
Score entry currently persists in browser `localStorage` with the temporary UX PIN `BNL2026`. This is intentionally a migration-stage implementation. Before public production use, move result writes and PIN verification server-side so all devices share one source of truth.

## Deploy
This folder is a zero-build static site and can be deployed directly to Vercel.

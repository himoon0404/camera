# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # vite dev server (http://localhost:5173/camera/)
npm run build     # tsc -b && vite build (type-check + production bundle to dist/)
npm run lint      # oxlint
npm run preview   # serve the built dist/ locally
npm run deploy    # predeploy runs `npm run build`, then gh-pages publishes dist/ to the gh-pages branch
```

There is no test suite/framework configured in this project.

Always run `npm run build` (not just `npx tsc -b`) before considering a change done — it also catches Vite/Rollup-level issues that `tsc -b` alone won't.

## Deployment

- Live site: `https://himoon0404.github.io/camera/` — GitHub repo `himoon0404/camera`.
- `vite.config.ts`'s `base: '/camera/'` and `package.json`'s `homepage` must both match the actual repo name; if the repo is ever renamed, update both.
- `npm run deploy` only replaces the static frontend bundle on the `gh-pages` branch. It never touches the Supabase database — redeploying after a code fix is always safe for user data (reservations, custom equipment, team names all live in Supabase, not in the deployed bundle).
- Standard flow for shipping a change: commit + push to `main` first, then `npm run deploy`.

## Architecture

This is a single-page equipment-reservation app for 5 fixed teams (`1조`~`5조`) sharing cameras and per-label accessories (SD cards, batteries, mics, etc.), styled after Toss's design language (blue `#3182f6` accent, `#f2f4f6` background, large rounded cards/type).

### Data layer: Supabase with localStorage fallback

- `src/lib/types.ts` — the only source of truth for domain types (`Reservation`, `CameraInfo`, `AccessoryItem`, `TeamId`) and default seed data. Both `App.tsx` and `src/lib/cloudSync.ts` import from here; don't redefine these types elsewhere.
- `src/lib/supabase.ts` — creates the Supabase client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. If either env var is missing/placeholder, `supabase` is `null` and `isSupabaseConfigured` is `false` — this is the single flag that gates all cloud behavior. Env values are `.trim()`-ed defensively since a stray trailing space/newline in `.env` silently breaks `createClient`.
- `src/lib/cloudSync.ts` — row↔model mappers (reservations use snake_case DB columns; cameras/accessories/team_names map 1:1), `fetchAllCloudData()` (bootstraps state and seeds `cameras`/`accessories`/`team_names` from the local defaults *only if the table is empty*), `subscribeToCloudChanges()` (one realtime channel, `postgres_changes` on all 4 tables), and `persist*`/`delete*Remote` functions. **All persist/delete functions swallow errors internally (log + return) — they never throw**, so callers in `App.tsx` fire-and-forget them after already updating local state.
- `App.tsx`'s data effects: local state is always initialized from `localStorage` synchronously (instant first paint + offline fallback), then a mount effect tries `fetchAllCloudData()` — on success it overwrites state and flips the `CloudStatus` badge to `online`; on failure/misconfiguration it silently stays on `offline` and the app keeps working purely off localStorage. Every mutation (`handleSaveReservation`, `addCamera`, `renameTeam`, etc.) updates React state + localStorage immediately, then calls the matching `persist*` function — cloud sync is always additive/best-effort, never a hard dependency for functionality.
- Realtime handlers upsert-by-id or filter-by-id into the existing array; they're written to be idempotent so echoes of the local client's own writes don't cause duplicates or loops.

### Supabase project setup (manual, one-time per Supabase project)

Required SQL (tables + RLS) lives only in chat history, not in a migrations folder — if a fresh Supabase project is ever wired up, four tables are needed (`reservations`, `cameras`, `accessories`, `team_names`; reservation columns are snake_case, see `cloudSync.ts` for the exact shape), and **RLS must be explicitly enabled with a permissive `for all to public using (true) with check (true)` policy on each table** — Supabase's default is RLS-on-with-no-policy for new tables, which lets `select` return empty results silently but makes writes fail with `42501`/401. There's no login system in this app (identity is just the "내 조" dropdown), so there's no meaningful RLS boundary to enforce beyond "anyone with the anon key can read/write" — don't try to add per-team RLS policies without first adding real auth.

`.env` (gitignored, never committed) holds `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. `.env.example` is the committed placeholder template. Because Vite inlines `VITE_*` vars at build time, changing `.env` requires a rebuild (`npm run build` or `npm run deploy`) before it takes effect anywhere.

### Permission model ("내 조")

- `myTeam` (persisted to `localStorage`, per-browser, intentionally *not* synced to Supabase — it represents "who is using this browser", not shared app state) gates reservation edit/cancel/return actions: `ReservationDetailModal` only shows those buttons when `reservation.teamId === myTeam || isAdmin`.
- Admin mode (`ADMIN_PASSWORD = '9126'`, session-only via `sessionStorage`) bypasses the team check entirely and unlocks the camera/accessory management panel (`AdminPanel`).
- New reservations default `teamId` to `myTeam` but the team selector in `ReservationModal` remains editable (not locked) — anyone can still book on behalf of another team if needed.

### Conflict-checking

Three independent overlap checks, all in `App.tsx`, all excluding the reservation being edited via an `excludeReservationId` param: `findCameraConflict` (same camera, any overlap), `findAccessoryConflict` (same accessory label id, any overlap), `findBroadcastConflict` (only one `isBroadcast` reservation may exist at an overlapping time, regardless of camera/team). All three run both at submit-time (`ReservationModal.handleSubmit`) and reactively while picking accessories (to gray out conflicting label chips before submit).

### UI structure

- `AppDataContext` provides shared lookups (`getTeamLabel`, `getCameraById`, `getAccessoryById`) and mutation functions to every nested component — avoids prop-drilling equipment/team-name catalogs through the three tab views and every modal.
- Accessories are grouped by `category` (`groupAccessoriesByCategory`) into `<details>` accordions in both the reservation form (`AccessoryPickerAccordion`, chip-style multi-select) and the equipment status tab (per-category accordion showing each label's availability + history) — always group by category rather than rendering a flat list when adding accessory-related UI.
- Return flow is two steps by design: `ReservationDetailModal` → "반납 처리" opens `ReturnChecklistModal`, which requires *both* a battery-charged and an equipment-cleaned checkbox before "반납 완료" is enabled.

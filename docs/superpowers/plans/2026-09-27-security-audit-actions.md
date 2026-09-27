# Security Audit Follow-up Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the two accepted follow-up actions from the 2026-09-27 security audit — the `uuid`/`exceljs` dependency vulnerability, and re-entrancy on the export buttons — without regressing existing behavior.

**Architecture:** Two independent, unrelated changes. Task 1 is a dependency-level experiment (try a safe override, verify with the existing test suite, fall back to a documented risk-acceptance if it doesn't hold up cleanly). Task 2 is a small React state addition in `ResultsTable.tsx` guarding the three export buttons against concurrent/duplicate invocations of the `export:results` IPC call.

**Tech Stack:** TypeScript, Electron, React 18, Vitest + Testing Library (renderer tests), Node's built-in test runner (engine tests, untouched by this plan), npm.

**Spec:** [AUDITORIA.md](../../../AUDITORIA.md) (project's running audit record) and the chat security audit dated 2026-09-27 (18-item checklist), whose "Próximas ações" items 1 and 2 this plan implements. Item 3 (generic error messages) was explicitly excluded by the user — informational-only in this single-user offline app, no security benefit, and would reduce the usefulness of error messages to the user.

## Global Constraints

- Do not introduce a new test framework — Vitest (renderer) and Node's native test runner (engine) already cover this project; use them as-is.
- `npm run typecheck` must pass after each task.
- `npm test` (`node --test && vitest run`) must pass 100% after each task — no regressions.
- Do not commit without the user's explicit go-ahead in this session; do not push.
- CSV/XLSX export behavior must remain byte-for-byte identical for the end user — this plan changes *when* the IPC call can be triggered, never the exported content.
- Follow the project's existing patterns: `mockApi()` / `foundItem()` / `notFoundItem()` helpers already in `ResultsTable.test.tsx`, not new mocking utilities.

---

### Task 1: Resolve the `uuid` moderate vulnerability (via `exceljs`)

**Files:**
- Modify: `package.json` (add `overrides` field, only if the verification in Step 4 succeeds)
- Modify: `AUDITORIA.md` (append decision record, either outcome)
- Read-only verification: `node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js` (already confirmed: the only place `exceljs` uses `uuid`, and it only calls `uuid.v4()` — never `v3`/`v5`/`v6` with a `buf` argument, which is the exact vulnerable code path in GHSA-w5hq-g745-h8pq)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on — this task is fully self-contained.

**Context:** `npm audit` reports 2 moderate findings: `uuid <11.1.1` (GHSA-w5hq-g745-h8pq), pulled in transitively by `exceljs@4.4.0` which pins `uuid: ^8.3.0`. No patched `8.x` release of `uuid` exists (confirmed via `npm view uuid versions` — the line stops at `8.3.2`; the fix only ships in `11.1.1`). The straightforward `npm audit fix --force` downgrades `exceljs` to `3.4.0`, a breaking change already rejected in a previous audit round. This task instead tries a targeted `npm` `overrides` entry that forces just the `uuid` sub-dependency of `exceljs` up to the patched `11.1.1`, while keeping `exceljs` itself untouched, and empirically verifies nothing breaks.

- [ ] **Step 1: Record the pre-change baseline**

Run:
```bash
npm test
```
Expected: all suites pass (114 `node:test` + 40 Vitest tests, per the audit). Note the exact pass count in your terminal output — Step 6 must match it.

- [ ] **Step 2: Confirm today's `npm audit` baseline**

Run:
```bash
npm audit --omit=dev
```
Expected: reports exactly 2 moderate findings, both `uuid <11.1.1` via `exceljs`.

- [ ] **Step 3: Add a scoped override forcing `uuid` to the patched version**

Edit `package.json`, adding a top-level `overrides` field (sibling to `dependencies`/`devDependencies`):

```json
  "overrides": {
    "exceljs": {
      "uuid": "^11.1.1"
    }
  },
```

- [ ] **Step 4: Reinstall and verify the resolved version**

Run:
```bash
npm install
npm ls uuid
```
Expected: `npm ls uuid` shows `uuid@11.1.1` (or later 11.x) under `exceljs`, not `8.3.2`.

- [ ] **Step 5: Verify `uuid`'s CJS interop still exposes `v4` the way `exceljs` expects**

Run:
```bash
node -e "console.log(typeof require('uuid').v4)"
```
Expected: prints `function`. If it prints anything else (e.g. throws, or `undefined`), the override is incompatible — stop here, run `git checkout -- package.json package-lock.json && npm install` to revert, and go to Step 8 (fallback path) instead of continuing to Step 6.

- [ ] **Step 6: Run the full test suite again — this is the real regression check**

Run:
```bash
npm test
```
Expected: same pass count as Step 1, in particular `src/main/engine/exporter.test.ts` (exercises `exportToExcel`, which is the only code path that touches `exceljs`'s `uuid` usage). Any failure here means revert (same command as Step 5) and go to Step 8.

- [ ] **Step 7: Confirm the vulnerability is gone and typecheck is clean**

Run:
```bash
npm audit --omit=dev
npm run typecheck
```
Expected: `npm audit` reports 0 vulnerabilities; typecheck passes with no errors. If both pass, append to `AUDITORIA.md` (new entry under a new "Rodada 5" heading or appended to the existing vulnerability note in the P2 section) recording:
- What was done: pinned `uuid` to `^11.1.1` under `exceljs` via `package.json` `overrides`, without downgrading `exceljs`.
- Why it's safe: `exceljs` only ever calls `uuid.v4()` (confirmed via `grep` in `node_modules/exceljs/lib`), never the `v3`/`v5`/`v6` functions the advisory's buffer-bounds-check bug affects.
- Verification performed: full test suite passing (list the exact counts), `npm audit` clean, typecheck clean.

Then skip Step 8 and go straight to Step 9.

- [ ] **Step 8 (fallback path — only if Step 5 or Step 6 failed): Revert and document risk acceptance instead**

Run (if not already done):
```bash
git checkout -- package.json package-lock.json
npm install
```
Then append to `AUDITORIA.md` (same location as above) a decision record instead:
- Finding: `npm audit` — 2 moderate, `uuid <11.1.1` via `exceljs@4.4.0` (`uuid: ^8.3.0`, no patched 8.x release exists).
- Why not forced: the `npm overrides` experiment (`uuid@^11.1.1` under `exceljs`) broke [state exactly what broke — the CJS check in Step 5, or which test(s) failed in Step 6].
- Why the residual risk is accepted: confirmed via `grep -rn "require('uuid')" node_modules/exceljs/lib/` that `exceljs` only calls `uuid.v4()` in one file (`cf-rule-ext-xform.js`) — the vulnerable code path (`v3`/`v5`/`v6` called with a `buf` argument) is never reachable through this dependency in this app. Fixing requires either `exceljs`'s own maintainers to bump their `uuid` range, or the previously-rejected downgrade to `exceljs@3.4.0`.

- [ ] **Step 9: Record the decision via the project's Repowise tool**

Run (fill in `--decision` with whichever outcome actually happened — Step 7's fix or Step 8's acceptance):
```bash
repowise decision add --title "uuid/exceljs npm audit finding" --decision "<one paragraph: what was decided and why, matching what you wrote into AUDITORIA.md>"
```
This lands as `proposed` for the user to confirm later — do not treat it as requiring approval now.

- [ ] **Step 10: Commit**

Only after explicit user confirmation in this session that the outcome (Step 7 or Step 8) is acceptable. Stage exactly the files changed by whichever path was taken:
```bash
git add package.json package-lock.json AUDITORIA.md
git commit -m "fix: resolve uuid/exceljs npm audit finding (or: document accepted residual risk)"
```
(Omit `package.json package-lock.json` from the `git add` if the fallback path was taken and they were reverted back to their original committed state — check `git status` first.)

---

### Task 2: Guard the export buttons against re-entrant clicks

**Files:**
- Modify: `src/renderer/src/components/ResultsTable.tsx:1` (add `useState` to the existing `react` import), `:34-51` (the two export handlers), `:88-100` (the three export buttons' `disabled` props)
- Test: `src/renderer/src/components/ResultsTable.test.tsx` (append new tests after the existing export tests, ending at line 214)

**Interfaces:**
- Consumes: `useStore` (`../store`), `showToast` — both already used in this file exactly as today; no changes to the store.
- Produces: nothing other tasks rely on.

**Context:** `handleExport` and `handleExportNotFound` (`ResultsTable.tsx:34-51`) call `window.api.exportResults(...)`, which opens a native "Save As" dialog in the main process. The three toolbar buttons are only disabled based on result-count (`allResults.length === 0`, `notFound.length === 0`) — nothing stops a user from clicking a second time (or a second export button) while the first `exportResults` call is still awaiting the save dialog / write, which could open two overlapping native dialogs. This task adds a single `exportPending` flag shared by all three buttons: while any export is in flight, all three buttons are disabled, and the handlers themselves also short-circuit re-entrant calls (defense in depth against a click landing between the disabled-prop render and the actual DOM update).

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/components/ResultsTable.test.tsx`, after the existing `'falha ao exportar mostra um toast de erro...'` test (currently ending at line 214):

```tsx
test('clicar exportar duas vezes rápido dispara a chamada uma única vez, e os três botões ficam desabilitados enquanto a exportação está pendente', async () => {
  let resolveExport!: (path: string) => void
  const exportResults = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolveExport = resolve
      })
  )
  mockApi({ exportResults })
  useStore.setState({ hasSearched: true, found: [foundItem()], notFound: [notFoundItem()] })
  render(<ResultsTable />)

  const excelButton = screen.getByRole('button', { name: /Exportar Excel/ })
  const csvButton = screen.getByRole('button', { name: /Exportar CSV/ })
  const notFoundButton = screen.getByRole('button', { name: /Exportar não encontrados/ })

  fireEvent.click(excelButton)
  fireEvent.click(excelButton)
  fireEvent.click(csvButton)

  expect(exportResults).toHaveBeenCalledTimes(1)
  expect(excelButton).toBeDisabled()
  expect(csvButton).toBeDisabled()
  expect(notFoundButton).toBeDisabled()

  resolveExport('C:\\saida\\resultado.xlsx')
  await waitFor(() => expect(useStore.getState().toast).toBe('Exportado para C:\\saida\\resultado.xlsx'))

  expect(excelButton).not.toBeDisabled()
  expect(csvButton).not.toBeDisabled()
  expect(notFoundButton).not.toBeDisabled()
})

test('exportação pendente que falha libera os botões de novo (não trava desabilitado para sempre)', async () => {
  const exportResults = vi.fn().mockRejectedValue(new Error('disco cheio'))
  mockApi({ exportResults })
  useStore.setState({ hasSearched: true, found: [foundItem()] })
  render(<ResultsTable />)

  const excelButton = screen.getByRole('button', { name: /Exportar Excel/ })
  fireEvent.click(excelButton)

  await waitFor(() => expect(useStore.getState().toast).toBe('Erro ao exportar: disco cheio'))
  expect(excelButton).not.toBeDisabled()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npx vitest run src/renderer/src/components/ResultsTable.test.tsx
```
Expected: the two new tests FAIL. The first fails on `expect(exportResults).toHaveBeenCalledTimes(1)` (currently called twice) or on the `toBeDisabled()` assertions (buttons aren't disabled while pending today). The second may already pass by accident (existing `finally`-less code still resets nothing to block) — if it already passes, that's fine, it becomes a regression guard for Step 3's implementation; if it fails, note why before implementing.

- [ ] **Step 3: Implement the `exportPending` guard**

In `src/renderer/src/components/ResultsTable.tsx`, change the import on line 1:

```tsx
import { useMemo, useState } from 'react'
```

Replace the two handlers (lines 34-51):

```tsx
  const [exportPending, setExportPending] = useState(false)

  async function handleExport(format: 'xlsx' | 'csv'): Promise<void> {
    if (exportPending) return
    setExportPending(true)
    try {
      const path = await window.api.exportResults(allResults, format)
      if (path) showToast(`Exportado para ${path}`)
    } catch (err) {
      showToast(`Erro ao exportar: ${(err as Error).message}`)
    } finally {
      setExportPending(false)
    }
  }

  async function handleExportNotFound(): Promise<void> {
    if (notFound.length === 0 || exportPending) return
    setExportPending(true)
    try {
      const path = await window.api.exportResults(notFound, 'xlsx')
      if (path) showToast(`Não encontrados exportados para ${path}`)
    } catch (err) {
      showToast(`Erro ao exportar: ${(err as Error).message}`)
    } finally {
      setExportPending(false)
    }
  }
```

Update the three buttons (lines 88-100) to also disable on `exportPending`:

```tsx
          <button
            className="btn sm"
            disabled={allResults.length === 0 || exportPending}
            onClick={() => handleExport('xlsx')}
          >
            <Download className="icon" style={{ width: 13, height: 13 }} />
            Exportar Excel
          </button>
          <button
            className="btn sm"
            disabled={allResults.length === 0 || exportPending}
            onClick={() => handleExport('csv')}
          >
            <Download className="icon" style={{ width: 13, height: 13 }} />
            Exportar CSV
          </button>
          <button className="btn sm" disabled={notFound.length === 0 || exportPending} onClick={handleExportNotFound}>
            <Download className="icon" style={{ width: 13, height: 13 }} />
            Exportar não encontrados
          </button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npx vitest run src/renderer/src/components/ResultsTable.test.tsx
```
Expected: all tests in this file PASS, including the two new ones and the pre-existing `'botões de exportar ficam desabilitados sem resultados'` test (still true: `exportPending` is `false` by default, so the original `length === 0` condition still governs the initial disabled state).

- [ ] **Step 5: Run the full suite and typecheck**

Run:
```bash
npm test
npm run typecheck
```
Expected: all tests pass (same or higher count than Task 1's baseline, plus 2), typecheck clean.

- [ ] **Step 6: Commit**

Only after explicit user confirmation in this session.
```bash
git add src/renderer/src/components/ResultsTable.tsx src/renderer/src/components/ResultsTable.test.tsx
git commit -m "fix: guard export buttons against re-entrant clicks during export"
```

---

## Self-Review Notes

- **Spec coverage:** Item 1 (dependency) → Task 1. Item 2 (re-entrancy on submit) → Task 2. Item 3 was explicitly excluded by the user before this plan was written.
- **No placeholders:** every step names the exact command, exact file, and exact code — including the fallback path for Task 1 if the `uuid` override turns out to be incompatible.
- **Type consistency:** `exportPending`/`setExportPending` names are used identically across Steps 3-4 of Task 2; no other task references them.
- **Independence:** Task 1 and Task 2 touch disjoint files (`package.json`/`AUDITORIA.md` vs. `ResultsTable.tsx`/`.test.tsx`) and can be executed and committed in either order, or in parallel by two different subagents.

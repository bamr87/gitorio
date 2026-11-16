# Evidence: skip link, `<main>` landmark and head/meta block

Issues #166 (UPS-FE-11, with UPS-FE-10's single `<main id="main-content">`) and #167 (UPS-FE-25). Captured 2026-11-16 against `npm run dev` (Vite 8.3.5) on `http://127.0.0.1:5791/?demo=1`, Chromium through the Playwright MCP, viewport 1280 × 800, `prefers-color-scheme` emulated. The verify kit's `app:` block is still the unfilled template, so this bundle was driven by hand rather than by `verify/runner.mjs`.

**Verdict: PASS.**

| Step | Observed |
| --- | --- |
| Load `?demo=1` | The skip link is the first focusable element in the DOM and sits above the viewport (`bottom: -8px`); exactly one `<main>`, id `main-content`. |
| Tab once (dark) | Focus is the `A.skip-link`, `href="#main-content"`, text "Skip to content", shown at top 8 px / left 8 px on z-index 1100, cyan ground with dark ink: [gitorio-skip-link-dark-focused.png](gitorio-skip-link-dark-focused.png). |
| Enter | `document.activeElement` is `MAIN#main-content`; the URL stays `/?demo=1` (no fragment); the skip link parks again. |
| Tab again | Focus lands on the first control inside `<main>` (the blueprint passport button), past the top bar and the demo banner: [gitorio-after-skip-dark-next-tab.png](gitorio-after-skip-dark-next-tab.png). |
| Tab once (light) | The same link on the light palette (`#0e7490` ground, white ink): [gitorio-skip-link-light-focused.png](gitorio-skip-link-light-focused.png). |
| Click every tab | Build, Prompts, Content, Docs, Monitor, Fleet, Harness and Settings each render inside one `<main id="main-content">`; `<main>` spans 95 → 800 px, every `.tabpane` ends at 800 px and the document never scrolls (`scrollHeight` 800 = `innerHeight`); on the floor `.workspace` runs 142 → 751 px with the compile drawer below, as before. |
| Console | 0 errors, 0 warnings. |

The head/meta tags are not visual; `app/src/indexHtml.test.ts` and a scan of the built `app/dist/index.html` cover them (see the PR body).

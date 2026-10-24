# Changelog

## [0.2.0](https://github.com/bamr87/gitorio/compare/v0.1.0...v0.2.0) (2026-10-24)


### Added

* AO-SDLC framework + seven autonomous factory cycles (ADR-022..030, specs 001-008) ([#39](https://github.com/bamr87/gitorio/issues/39)) ([f877fe6](https://github.com/bamr87/gitorio/commit/f877fe6d7f05823a9a3d07cbd18b96c06c798fc5))
* **archify:** vendor archify + pure IR compiler + generated maps + diagram-gate; The Evidence Console design language (specs/010 + 011, ADR-034) ([#79](https://github.com/bamr87/gitorio/issues/79)) ([8084bf5](https://github.com/bamr87/gitorio/commit/8084bf52ee759824b4e7b11004c82f95e1bb0149))
* **console+harness:** the app on archify's viewer model (specs/013, ADR-035) and harness parity with the bamr87 hub (specs/014, ADR-036) ([#95](https://github.com/bamr87/gitorio/issues/95)) ([ac3d1f8](https://github.com/bamr87/gitorio/commit/ac3d1f853e489ed8308c886b76b96d70353c99ef))
* **demo:** a tokenless browser demo — one fixture GithubClient, all seven tabs ([#59](https://github.com/bamr87/gitorio/issues/59)) ([ea23020](https://github.com/bamr87/gitorio/commit/ea2302045b6354e40712f264bee4139c58122304))
* **fleet:** a fleet is a link — ?tab=fleet&roster=owner/a,owner/b (ADR-038) ([2677a48](https://github.com/bamr87/gitorio/commit/2677a4861072a010e6e1aafa659cca6212b244fb))
* **fleet:** a fleet is a link — one URL for lifehacker + irony-works; CI green again (ADR-038) ([5eac92e](https://github.com/bamr87/gitorio/commit/5eac92e65d1d95b75ff256fd2963ed38fb83c1f2))
* **fleet:** adapt Fleet Ops to the [#1](https://github.com/bamr87/gitorio/issues/1) consumer (it-journey) + a management surface ([#23](https://github.com/bamr87/gitorio/issues/23)) ([cca6cbf](https://github.com/bamr87/gitorio/commit/cca6cbff458dc65c5b0d1207f214fd9dfb5e2e33))
* **fleet:** Fleet Ops — a game-like, fleet-wide GitHub Actions cockpit ([#22](https://github.com/bamr87/gitorio/issues/22)) ([67aa41b](https://github.com/bamr87/gitorio/commit/67aa41b23b992c847aeb20b3ecb41c5926832634))
* **fleet:** read the fleet runner by reference; flag vendored copies (ADR-037) ([9ffdb36](https://github.com/bamr87/gitorio/commit/9ffdb3645f58fef9695fe958505bcd9dba14e852))
* **fleet:** read the fleet runner by reference; flag vendored copies (ADR-037) ([810cb14](https://github.com/bamr87/gitorio/commit/810cb14ee1ecc122ce0e22d69c918158b611f9d0))
* headless-CMS content factory — governance, feedback loops, Docs Gardener ([#15](https://github.com/bamr87/gitorio/issues/15)) ([974d5c7](https://github.com/bamr87/gitorio/commit/974d5c7b84879c39a304e6a08c4f297e79e1aff1))


### Fixed

* **compiler:** agents never merge — refuse agent merge grants; gate Factories 2-3 (ADR-039) ([#123](https://github.com/bamr87/gitorio/issues/123)) ([f4992f8](https://github.com/bamr87/gitorio/commit/f4992f8fc9edca99d371491ae63f3a62e71ff682))
* **compiler:** emit actions/checkout@v7 and regenerate every compiled workflow ([#76](https://github.com/bamr87/gitorio/issues/76)) ([3fd7a56](https://github.com/bamr87/gitorio/commit/3fd7a56c15bf6e19c54009e6aee9c6a635701b5c))
* **deps:** refresh nanoid 3.3.17 → 3.3.18 in the app lockfile ([#71](https://github.com/bamr87/gitorio/issues/71)) ([4af991c](https://github.com/bamr87/gitorio/commit/4af991c7e61ff3408509e17dcdcdf8bce23e1fb0))
* **factory:** give Factory 2 (nightly gardener) 24 turns instead of 12 ([#125](https://github.com/bamr87/gitorio/issues/125)) ([8a934f1](https://github.com/bamr87/gitorio/commit/8a934f102fb604a5409b417eda11db2533868565))
* **test:** green again — a usable Web Storage for the stores, and demo mode pins the fleet-ops clock ([5711b8d](https://github.com/bamr87/gitorio/commit/5711b8d6003e6c5fb2454f2a64c170eedec8a054))


### Changed

* **ui:** declutter shell, unify design tokens, add capability drill-down ([#16](https://github.com/bamr87/gitorio/issues/16)) ([e776d3e](https://github.com/bamr87/gitorio/commit/e776d3eed014932182b0026939407b01a699d1c3))


### Documentation

* add feature catalog, constitution and amendments; link PRD ([#146](https://github.com/bamr87/gitorio/issues/146)) ([d7a5a27](https://github.com/bamr87/gitorio/commit/d7a5a27b41202eb700737c0c02a09edc05e5db86))
* add LICENSE and CHANGELOG.md ([#133](https://github.com/bamr87/gitorio/issues/133)) ([7afe3ee](https://github.com/bamr87/gitorio/commit/7afe3eed14f3a985ae9f117fe9e41e1cfcf646eb))
* add PRD.md ([#145](https://github.com/bamr87/gitorio/issues/145)) ([bb997ec](https://github.com/bamr87/gitorio/commit/bb997ec875bfbdff81d46aeaa95957f1433e6097))
* **backlog:** BL-20260908-01 — opt-in central-runner harness + gate.enablement on deployed factories ([3eb023c](https://github.com/bamr87/gitorio/commit/3eb023cabb5180bb706d86aa3bdf486a49d16654))
* **backlog:** BL-20260908-01/02 — central-runner harness, gate.enablement, and consuming @bamr87/fleet-engines ([8df34c2](https://github.com/bamr87/gitorio/commit/8df34c2dcf55240a801f5d562408ceaf88ff1612))
* **backlog:** BL-20260908-02 — consume @bamr87/fleet-engines from the hub, retire the in-repo copy ([3662e94](https://github.com/bamr87/gitorio/commit/3662e947136fd90ce2bd57b9ee0a16cbff95f878))
* **claude:** add frontmatter to the three commands ([#33](https://github.com/bamr87/gitorio/issues/33)) ([cc95b59](https://github.com/bamr87/gitorio/commit/cc95b5996d889c6fee71b3a09dd96f9dd9bc5b53))
* consolidate the wtd-fleet doc drafts into a verified GENERATED-FILES contract + README map ([#77](https://github.com/bamr87/gitorio/issues/77)) ([424e0ff](https://github.com/bamr87/gitorio/commit/424e0ff055ddc5b854ce666a6d285944bbc028ad))
* **readme:** align README with the portfolio standard ([#132](https://github.com/bamr87/gitorio/issues/132)) ([0b9dccb](https://github.com/bamr87/gitorio/commit/0b9dccbf4a3e681654268f196d680a028202c656))
* **session:** ADR-033 + current state + session log for the open-PR sweep ([#78](https://github.com/bamr87/gitorio/issues/78)) ([13fa5eb](https://github.com/bamr87/gitorio/commit/13fa5ebadae64f2762c0133b10fa639cfecfa0fe))
* **specs:** spec 012 — Fleet Studio: the bamr87 fleet model as roster, contract, and adoption source ([#86](https://github.com/bamr87/gitorio/issues/86)) ([c8e329d](https://github.com/bamr87/gitorio/commit/c8e329ddeadf4bb6960de431a74d197e7178b420))
* state the division of labour between _docs/, docs/, specs/ and blog/ ([#80](https://github.com/bamr87/gitorio/issues/80)) ([4a7078c](https://github.com/bamr87/gitorio/commit/4a7078c9b56172a0aaccd9d86eeb186e5bbb0ce5))

## Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- `CHANGELOG.md`, in Keep a Changelog format.
- `LICENSE` file (MIT).

## History

No versions have been tagged yet. The project started on 2026-07-03 and has 99 commits on `main`. The most recent changes:

- 2026-10-17: docs(readme): align README with the portfolio standard ([#132](https://github.com/bamr87/gitorio/pull/132))
- 2026-10-16: chore(repo): sync .editorconfig to the fleet hub copy, keeping the 2-space local override (UPS-REPO-17) ([#129](https://github.com/bamr87/gitorio/pull/129))
- 2026-10-15: Build(deps-dev): Bump the minor-and-patch group in /app with 7 updates ([#126](https://github.com/bamr87/gitorio/pull/126))
- 2026-10-15: Build(deps): Bump source-map-js from 1.2.1 to 1.2.2 in /app ([#128](https://github.com/bamr87/gitorio/pull/128))
- 2026-10-14: ci: pause schedules while Actions billing is blocked (bamr87/bamr87#268) ([#127](https://github.com/bamr87/gitorio/pull/127))
- 2026-10-04: fix(factory): give Factory 2 (nightly gardener) 24 turns instead of 12 ([#125](https://github.com/bamr87/gitorio/pull/125))
- 2026-10-03: Build(deps-dev): Bump brace-expansion from 5.0.9 to 5.0.12 in /app ([#124](https://github.com/bamr87/gitorio/pull/124))
- 2026-10-03: Build(deps): Bump the minor-and-patch group across 1 directory with 14 updates ([#122](https://github.com/bamr87/gitorio/pull/122))
- 2026-10-03: fix(compiler): agents never merge — refuse agent merge grants; gate Factories 2-3 (ADR-039) ([#123](https://github.com/bamr87/gitorio/pull/123))
- 2026-10-03: build(docker): harmonize Docker configuration to the fleet standard ([#119](https://github.com/bamr87/gitorio/pull/119))
- 2026-09-12: Build(deps-dev): Bump vitest from 4.1.11 to 5.0.0 in /app ([#116](https://github.com/bamr87/gitorio/pull/116))
- 2026-09-12: Build(deps-dev): Bump the minor-and-patch group in /app with 4 updates ([#115](https://github.com/bamr87/gitorio/pull/115))
- …and 58 earlier changes.

The full record is in the [commit history](https://github.com/bamr87/gitorio/commits/main) and the [merged pull requests](https://github.com/bamr87/gitorio/pulls?q=is%3Apr+is%3Amerged).

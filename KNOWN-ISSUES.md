# Known issues and honest limitations

## Environment and verification
1. **Docker was not available on the author's machine** (no disk space). Everything that needs Docker (docker-compose
   stack, E2E against compose, ZAP, k6, Toxiproxy resilience, real RabbitMQ event tests) was verified **in GitHub
   Actions**, not locally. Locally verified: typecheck, ESLint, Prettier, unit, API, Newman, Pact, E2E (in-process
   stack), SQL, event (in-memory bus), migration and AI-tool suites.
2. **`azure-pipelines.yml` has never been run.** It mirrors the GitHub Actions workflow and parses as valid YAML, but
   there is no Azure DevOps organisation connected to this repository. Expect small agent-specific fixes on first run.
3. **k6 was not run locally** (no binary installed). The scripts ran in CI with `SCALE=0.25` (short profile). The full
   profile has not been exercised.
4. The self-check loop (Stage 6) ran as: local checks first, then repeated GitHub Actions runs as the Docker host.

## Planted defects (intentional, documented)
DEF-001 to DEF-004 are open on purpose ([docs/planted-defects.md](docs/planted-defects.md)). Their tests are expected failures
so the pipeline is green. If one of them is fixed, its expected-failure test will turn the build red until the marker is removed.

## Demo-system limitations
- No authentication, authorisation or rate limiting.
- All services share one database and the policy service reads quote/risk tables directly (see testability review T4).
- The in-process mode uses an in-memory event bus, whose semantics match RabbitMQ for the tested behaviours but are not identical (for example no network failures).
- Money uses a single currency (USD).
- UI tests run on Chromium only; no accessibility testing.

## Test limitations
- CI performance runs are short, so memory/GC and long-tail behaviour are not measured.
- The Postman eventual-consistency step relies on a short delay in a pre-request script and could be flaky on a very slow machine.
- ZAP scans use the OpenAPI definition; they do not cover the static web UI.
- The Playwright expected-failure test for DEF-001 parses amounts out of the rendered table text, which would need updating if the UI layout changes.
- The AI tool has only been tested with a mocked LLM; it has not been exercised against the live Anthropic API in this repository.

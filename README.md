# Meteorological Ai Scraping Tool

> **Forked from [Evan Chen's NHIS project](https://github.com/chen-wenyi)**. This tool migrates the AI subsystem from OpenAI to Anthropic Claude, adds a Gantt-chart generation feature, and has since evolved substantially beyond the original fork. The underlying architecture, scraping pipeline, MongoDB schema, Ably realtime layer, and UI foundation are all Evan's work — full credit to them; see [Acknowledgements](#acknowledgements) below.

A near real-time natural hazard intelligence platform that:

- Scrapes latest hazard content from MetService
- Stores outlooks and alerts in `MongoDB`
- Regenerates AI summaries when source data changes using **Anthropic Claude**
- Generates structured, editable **Gantt charts** of warnings and watches on demand
- Pushes update events to the UI through `Ably` pub/sub

## Branches

| Branch | Purpose |
|---|---|
| **`master`** | Stable, default branch. Promoted from `develop` once a set of changes has been tested and confirmed working. |
| **`develop`** | Active development. All new work lands here first. |
| [`original`](../../tree/original) | Evan Chen's original NHIS project, preserved unchanged, kept as a permanent comparison baseline. |

Two earlier comparison branches (`anthropic`, `open_ai`) that existed while evaluating OpenAI vs. Anthropic as the AI provider have been archived as tags (`archive/anthropic`, `archive/open_ai`) now that `develop`/`master` has superseded both — they're fully recoverable (`git checkout -b anthropic archive/anthropic`) but no longer maintained as live branches.

## Demo
[Demo](https://drive.google.com/file/d/10jYOKI_7c5phWDC1SoBJhGe9gbuqb1nM/view?usp=drive_link)

## Core Value

- Converts complex technical data into decision-ready intelligence
- Improves speed and clarity of emergency response planning
- Enables proactive risk management through timely AI-driven insights

## Architecture

The project has 3 main applications plus `MongoDB`:

- **main-services** — backend orchestration and scheduled jobs
- **scrape-services** — web scraping service for *MetService* pages
- **ui** — frontend presentation layer
- **mongodb** — persistent storage

Main flow:

1. main-services runs cron jobs to refresh severe weather outlook, thunderstorm outlook, and issued alerts.
2. main-services fetches scraped content from scrape-services and CAP feed content from MetService.
3. If new content is detected, main-services stores it and regenerates summaries with Anthropic Claude (`claude-haiku-4-5-20251001`) using tool-use for structured output.
4. main-services publishes update events through Ably.
5. ui subscribes to the Ably channel and refreshes the screen state.
6. The Gantt page on the UI lets operators paste MetService warning text or pull the latest scraped alerts, generates a structured Gantt chart of regions × hazards × time, and allows manual correction of ordering, hazard type, and severity before export.

![image](https://github.com/user-attachments/assets/0b35d8b7-b296-49e6-9d03-b13e42be5cf1)

## Project Structure

### main-services

Cron-driven backend for refresh and orchestration.

- Refresh issued alerts and outlooks on schedule
- Detect stale vs new source data
- Persist records to MongoDB
- Regenerate AI summaries when new data arrives
- Generate Gantt charts on demand from issued-alert text, distinguishing regional hazards (rain/wind/snow) from route-specific alerts (Road Snowfall Warnings)
- Publish backend update events to Ably for frontend sync

### scrape-services

Scraping layer for MetService pages.

- Scrape severe weather outlook page
- Scrape thunderstorm outlook page
- Return normalized JSON payloads to main-services

### ui

Presentation and user interaction.

- Show outlooks, alerts, and AI summaries
- Subscribe to Ably channel events
- React to backend update and generation events in near real-time
- Revision history for both outlook types — Thunderstorm Outlook covers the current day, Severe Weather Outlook covers a rolling 5-day window (since it's typically only issued once or twice a day, a same-day window rarely had anything to compare)
- Provide a Gantt-chart generator at `/gantt` with:
  - Paste-text and use-latest-scraped input modes
  - Colour-coded severity (yellow/orange/red, matching MetService's own convention) with border style distinguishing regional vs. route-specific alerts
  - A manual bars editor — drag to reorder, correct hazard type or severity via dropdown, with labels auto-updating to match
  - An "exclude road snowfall" display/export toggle
  - 150/300 DPI PNG export
  - A built-in "how to use this page" guide

## Tech Stack

- Backend framework: NestJS (main-services)
- Scraping service: Hono + Playwright (scrape-services)
- Frontend: React + TanStack stack (ui)
- Database: MongoDB
- AI provider: **Anthropic** (`@anthropic-ai/sdk`)
- AI model: **`claude-haiku-4-5-20251001`** (configurable via `ANTHROPIC_MODEL`)
- Structured output: tool-use with `tool_choice` + Zod 4 native `z.toJSONSchema()`
- Realtime messaging: Ably pub/sub

## Prerequisites

- Docker Desktop (Windows / macOS) or Docker Engine (Linux)
- Docker install guide: <https://docs.docker.com/engine/install/>
- An **Anthropic API key** — sign up at <https://console.anthropic.com/>
- An **Ably API key** — sign up at <https://ably.com/sign-up>

## Environment Setup

1. Copy environment variables template:

```bash
cp .env.schema .env
```

2. Open `.env` and set your secrets:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
ABLY_API_KEY=xxxxxx.yyyyyy:zzzzzzzzzz
```

3. The Ably channel name is preconfigured:

```env
ABLY_CHANNEL_NAME=nhis-nest-channel
```

4. (Optional) override the model:

```env
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

5. If deploying to cloud, set environment variables in your cloud provider instead of committing secrets.

> Windows note: edit `.env` in VS Code or Notepad++, **not** Notepad. Notepad inserts a UTF-8 BOM that breaks dotenv parsing. Each line should also start at column 0 — strip any leading whitespace.

## Run

From the project root:

```bash
docker compose up --build
```

First build takes 5–15 minutes (the Playwright base image is ~2 GB). Subsequent runs are seconds.

## Access

- UI: <http://localhost:3001>
- main-services: <http://localhost:3000>
- scrape-services: <http://localhost:4000>
- mongodb: localhost:27017

The Gantt page is at <http://localhost:3001/gantt>.

## Stop

```bash
docker compose down
```

To also wipe the MongoDB data volume:

```bash
docker compose down -v
```

## Operational Notes

- main-services schedules recurring updates for severe weather outlook, thunderstorm outlook, and issued warnings and watches.
- AI summaries are regenerated only when newly scraped data differs from latest stored records, so most cron ticks make zero API calls.
- The Gantt page generates on demand — every generation costs one Anthropic call; manual corrections in the bars editor do not.
- Ably is used as pub/sub transport between backend and frontend for status and update events.
- Container timezone is set to `Pacific/Auckland` so log timestamps match NZ wall clock; the NestJS logger is overridden to emit `DD/MM/YYYY, HH:mm:ss` via Luxon.

## What's changed since the original NHIS project

- **AI provider migrated from OpenAI to Anthropic Claude** — `ai-generate.service.ts` uses Anthropic's Messages API with `tool_choice: { type: 'tool', name: ... }` to force schema-conformant JSON. `OPENAI_API_KEY` → `ANTHROPIC_API_KEY`, with an optional `ANTHROPIC_MODEL` override.
- **Gantt chart generator added and substantially extended**, including:
  - Deterministic geographic (north–south) and severity sorting, enforced in code rather than left to the model
  - A dedicated `road_snow` hazard type distinguishing route-specific Road Snowfall Warnings from regional Heavy Snow Watch/Warning, with colour and border conventions matching MetService's own yellow/orange/red severity scheme
  - A manual bars editor for drag-and-drop reordering and hazard/severity correction, with auto-updated labels
  - An "exclude road snowfall" toggle affecting both the on-screen chart and PNG export
  - Peak-intensity overlay on rain bars, shown only where the source text gives explicit timing
  - 150/300 DPI PNG export
- **AI Summary panel** writes warning/watch type names in lowercase (e.g. "heavy rain warning"), distinct from the Title Case used in the Issued Warnings & Watches panel.
- **Severe Weather Outlook revision history** extended from a same-day window to a rolling 5-day window, since this outlook is typically only issued once or twice a day and a same-day window rarely had more than one version to compare.
- **Bug fixes**: Ably token endpoint URL handling under SSR, container timezone, Luxon-based logger format, a pnpm version mismatch between Docker build stages, and a corrupted Dockerfile line.

If you're evaluating this work in detail, `git diff original..develop` remains the most accurate way to see the full scope of change.

# Screenshots

## Meteorological Ai Scraping Tool Dashboard

![image](https://github.com/user-attachments/assets/5d5c01a8-c0d1-446b-b629-3c56bfb63f65)

<img width="1919" height="949" alt="Dashboard" src="https://github.com/user-attachments/assets/2dc7042d-b24a-44bf-983e-b37503e83390" />

## Data Collection & Visualisation

![image](https://github.com/user-attachments/assets/7236fd46-24dd-4fca-94bd-8948924891ae)

## Issued Alerts Timeline feature

![image](https://github.com/user-attachments/assets/0d6f6fc5-11ac-483b-867e-9d0701c7f8c5)

## Issued Alerts Status feature

![image](https://github.com/user-attachments/assets/b6008e48-3ca1-4c6e-af93-839c4ad1a37c)

## Outlooks revision comparison feature

![image](https://github.com/user-attachments/assets/b7895fd3-cd36-4122-ab44-e52806292fb8)

## Gantt Chart Creation

<img width="869" height="505" alt="Gantt_Chart" src="https://github.com/user-attachments/assets/2fa241e9-581e-472b-a7c1-4e53ecee60d2" />

## Acknowledgements

This project is built on top of the **Natural Hazard Intelligence Summary** platform created by **[Evan Chen (chen-wenyi)](https://github.com/chen-wenyi)** and licensed under the [MIT License](LICENSE).

**Evan's original work** (preserved on the [`original` branch](../../tree/original)):
- The complete three-service architecture (main-services / scrape-services / ui) and Docker Compose orchestration
- The MetService scraping pipeline (Playwright-based outlook scraping plus CAP feed parsing)
- The MongoDB schema and revision-history persistence model
- The Ably realtime layer and channel-event vocabulary
- The cron scheduling and stale-vs-new dedup logic
- The AI extraction prompts (severe weather and thunderstorm) with their strict quote-as-evidence rules and Māori macron handling — these are kept verbatim in this branch
- The React + TanStack Start dashboard UI and all its features (issued alerts timeline, status badges, revision comparison, AI content validation)

**Modifications since the fork:**
- Migrated the AI provider from OpenAI to Anthropic Claude
- Built and substantially extended the Gantt-chart generator (see "What's changed" above)
- Extended Severe Weather Outlook revision history to a rolling 5-day window
- Various bug fixes and rebranding

If you're evaluating this work, `git diff original..develop` is the most accurate way to see what's changed.

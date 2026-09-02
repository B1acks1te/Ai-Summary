# Meteorological Ai Scraping Tool — Anthropic edition

> **Forked from [Evan Chen's NHIS project](https://github.com/chen-wenyi)** ([original branch preserved here](../../tree/original)). This branch migrates the AI subsystem from OpenAI to Anthropic Claude and adds a Gantt-chart generation feature. The underlying architecture, scraping pipeline, MongoDB schema, Ably realtime layer, and UI are all Evan's work — full credit to them; see [Acknowledgements](#acknowledgements) below.

A near real-time natural hazard intelligence platform that:

- Scrapes latest hazard content from MetService
- Stores outlooks and alerts in `MongoDB`
- Regenerates AI summaries when source data changes using **Anthropic Claude**
- Generates structured **Gantt charts** of warnings and watches on demand
- Pushes update events to the UI through `Ably` pub/sub

## Branches

This repository hosts three parallel versions of the same project so they can be compared directly:

| Branch | LLM provider | Model | Gantt feature |
|---|---|---|---|
| [`original`](../../tree/original) | OpenAI | `gpt-5-mini` | No |
| [`open_ai`](../../tree/open_ai) | OpenAI | `gpt-5-mini` | Yes |
| **`anthropic`** *(this branch)* | Anthropic | `claude-haiku-4-5-20251001` | Yes |

The `original` branch is preserved as-shipped by Evan Chen. The `open_ai` and `anthropic` branches add a Gantt-chart generator on top, with `anthropic` additionally migrating the AI subsystem from OpenAI to Anthropic Claude.

The two feature branches (`open_ai` and `anthropic`) share identical UI, scrape pipeline, MongoDB schema, Ably realtime layer, and cron schedules. They differ only in the LLM provider and the surrounding glue code in `main-services/src/services/ai-generate/`.

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
6. The Gantt page on the UI lets operators paste MetService warning text or pull the latest scraped alerts, and produces a structured Gantt chart of regions × hazards × time.

![image](https://github.com/user-attachments/assets/0b35d8b7-b296-49e6-9d03-b13e42be5cf1)

## Project Structure

### main-services

Cron-driven backend for refresh and orchestration.

- Refresh issued alerts and outlooks on schedule
- Detect stale vs new source data
- Persist records to MongoDB
- Regenerate AI summaries when new data arrives
- Generate Gantt charts on demand from issued-alert text
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
- Provide a Gantt-chart generator at `/gantt` with paste-text and use-latest-scraped modes, plus 150/300 DPI PNG export

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
- The Gantt page generates on demand — every click costs one Anthropic call. Inspect `/gantt` in the UI for the paste-text and use-latest-scraped flows.
- Ably is used as pub/sub transport between backend and frontend for status and update events.
- Container timezone is set to `Pacific/Auckland` so log timestamps match NZ wall clock; the NestJS logger is overridden to emit `DD/MM/YYYY, HH:mm:ss` via Luxon.

## What changed vs the `original` branch

- **`@anthropic-ai/sdk` replaces `openai`** in `main-services/package.json`.
- **`ai-generate.service.ts`** uses Anthropic's Messages API with `tool_choice: { type: 'tool', name: ... }` to force schema-conformant JSON. Public method signatures (`generateSevereWeatherOutlookSummary`, `generateThunderstormOutlookSummary`) are unchanged so cron and controller call sites still work.
- **`OPENAI_API_KEY` becomes `ANTHROPIC_API_KEY`**, with an optional `ANTHROPIC_MODEL` override.
- **New Gantt feature** — backend prompt + endpoint, plus a `/gantt` route in the UI that renders structured warnings as a canvas-based Gantt chart with N→S regional sorting, peak-intensity overlay on rain bars, and PNG export at 150/300 DPI.
- **Bug fixes** for the Ably token endpoint URL handling under SSR, container timezone, and logger format.

# Screenshots

## Meteorological Ai Scraping Tool Dashboard

![image](https://github.com/user-attachments/assets/5d5c01a8-c0d1-446b-b629-3c56bfb63f65)

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

## AI Generated content validation

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

**Modifications on this branch:**
- Migrated the AI provider from OpenAI to Anthropic Claude, adapting `ai-generate.service.ts` to use tool-use for structured output instead of `zodResponseFormat`. The prompts and Zod schemas are unchanged.
- Added a Gantt-chart generator: a new prompt + schema (`ganttPrompt.ts`, `GanttChartSchema`), backend endpoints, and a UI route at `/gantt` with paste-text + use-latest-scraped modes and 150/300 DPI PNG export.
- Bug fixes for an Ably URL-parsing issue under TanStack Start SSR (deferred client construction with a no-op stub during server render), container timezone, and a custom Luxon-based logger format.

If you're evaluating this work, the most accurate way to see what was changed is `git diff original..anthropic` — the diff is small relative to the project as a whole.

# Natural Hazard Intelligence Summary — OpenAI edition with Gantt

A near real-time natural hazard intelligence platform that:

- Scrapes latest hazard content from MetService
- Stores outlooks and alerts in `MongoDB`
- Regenerates AI summaries when source data changes using **OpenAI**
- Generates structured **Gantt charts** of warnings and watches on demand
- Pushes update events to the UI through `Ably` pub/sub

> **This is the `open_ai` branch.** The AI subsystem still uses OpenAI `gpt-5-mini` (matching the `original` branch), and a new Gantt-chart generator has been added on top. See [Branches](#branches) below for the other versions.

## Branches

This repository hosts three parallel versions of the same project so they can be compared directly:

| Branch | LLM provider | Model | Gantt feature |
|---|---|---|---|
| [`original`](../../tree/original) | OpenAI | `gpt-5-mini` | No |
| **`open_ai`** *(this branch)* | OpenAI | `gpt-5-mini` | Yes |
| [`anthropic`](../../tree/anthropic) | Anthropic | `claude-haiku-4-5-20251001` | Yes |

The two feature branches (`open_ai` and `anthropic`) share identical UI, scrape pipeline, MongoDB schema, Ably realtime layer, and cron schedules. They differ only in the LLM provider and the surrounding glue code in `main-services/src/services/ai-generate/`.

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
3. If new content is detected, main-services stores it and regenerates summaries with OpenAI (`gpt-5-mini`) using `zodResponseFormat` for structured output.
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
- AI provider: **OpenAI** (`openai` SDK)
- AI model: **`gpt-5-mini`** with `reasoning_effort: 'low'` (configurable via `OPENAI_MODEL`)
- Structured output: `zodResponseFormat` from `openai/helpers/zod`
- Realtime messaging: Ably pub/sub

## Prerequisites

- Docker Desktop (Windows / macOS) or Docker Engine (Linux)
- Docker install guide: <https://docs.docker.com/engine/install/>
- An **OpenAI API key** — sign up at <https://platform.openai.com/>
- An **Ably API key** — sign up at <https://ably.com/sign-up>

## Environment Setup

1. Copy environment variables template:

   ```bash
   cp .env.schema .env
   ```

2. Open `.env` and set your secrets:

   ```env
   OPENAI_API_KEY=sk-...
   ABLY_API_KEY=xxxxxx.yyyyyy:zzzzzzzzzz
   ```

3. The Ably channel name is preconfigured:

   ```env
   ABLY_CHANNEL_NAME=nhis-nest-channel
   ```

4. (Optional) override the model:

   ```env
   OPENAI_MODEL=gpt-5-mini
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
- The Gantt page generates on demand — every click costs one OpenAI call. Inspect `/gantt` in the UI for the paste-text and use-latest-scraped flows.
- Ably is used as pub/sub transport between backend and frontend for status and update events.
- Container timezone is set to `Pacific/Auckland` so log timestamps match NZ wall clock; the NestJS logger is overridden to emit `DD/MM/YYYY, HH:mm:ss` via Luxon.

## What changed vs the `original` branch

- **New Gantt feature** — backend prompt + endpoints, plus a `/gantt` route in the UI that renders structured warnings as a canvas-based Gantt chart with N→S regional sorting, peak-intensity overlay on rain bars, and PNG export at 150/300 DPI.
- **`OPENAI_MODEL` env override** — defaults to `gpt-5-mini` to match the original, but now configurable.
- **Bug fixes** for the Ably token endpoint URL handling under SSR, container timezone, and logger format.
- **AI subsystem otherwise unchanged** — same `openai` SDK, same `zodResponseFormat`, same prompts and schemas for severe weather and thunderstorm. Only addition is a `generateGanttChart()` method using the same pattern.

# Screenshots

## Natural Hazard Intelligence Dashboard

![image](https://github.com/user-attachments/assets/5d5c01a8-c0d1-446b-b629-3c56bfb63f65)

## Data Collection & Visualisation

![image](https://github.com/user-attachments/assets/7236fd46-24dd-4fca-94bd-8948924891ae)

## Issued Alerts Timeline feature

![image](https://github.com/user-attachments/assets/0d6f6fc5-11ac-483b-867e-9d0701c7f8c5)

## Issued Alerts Status feature

![image](https://github.com/user-attachments/assets/b6008e48-3ca1-4c6e-af93-839c4ad1a37c)

## Outlooks revision comparison feature

![image](https://github.com/user-attachments/assets/b7895fd3-cd36-4122-ab44-e52806292fb8)

## AI Generated content validation

![image](https://github.com/user-attachments/assets/c14c1ac7-6dff-4d01-9f4e-604670efe9c9)

## Credits

Original implementation by [Evan Chen](https://github.com/chen-wenyi). Gantt feature added by the current maintainer. MIT licensed.

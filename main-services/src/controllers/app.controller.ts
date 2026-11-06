import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { ScrapeRepository } from 'src/dao/scrape.repository';
import { AiGenerateService } from 'src/services/ai-generate/ai-generate.service';
import type { GanttBar } from 'src/services/ai-generate/schema';
import { AppService } from 'src/services/app.service';
import { ScrapeService } from 'src/services/scrape/scrape.service';

// After this many wrong admin passwords, sign-in pauses for everyone for a
// while — same shape/protection as Feedback's and Notice's own independent
// counters (see notice.service.ts's checkAdmin).
const ADMIN_MAX_FAILURES = 10;
const ADMIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;

@Controller()
export class AppController {
  private readonly adminFailures = new Map<string, number[]>();

  constructor(
    private readonly appService: AppService,
    private readonly scrapeService: ScrapeService,
    private readonly aiGenerateService: AiGenerateService,
    private readonly scrapeRepository: ScrapeRepository,
  ) {}

  // ---- admin auth (own lockout, independent of Feedback/Notice) ---------
  // Same FEEDBACK_ADMIN_KEY secret, same sha256 + timingSafeEqual check as
  // the rest of the app's admin-gated endpoints.
  private checkAdmin(key: string | undefined): string | null {
    const expected = process.env.FEEDBACK_ADMIN_KEY;
    if (!expected) return 'Admin access is not configured.';

    const now = Date.now();
    const recent = (this.adminFailures.get('admin') ?? []).filter(
      (t) => now - t < ADMIN_FAILURE_WINDOW_MS,
    );
    if (recent.length >= ADMIN_MAX_FAILURES) {
      this.adminFailures.set('admin', recent);
      return 'Too many wrong passwords - please wait a few minutes and try again.';
    }
    if (!key) return 'Unauthorized';

    const a = createHash('sha256').update(key).digest();
    const b = createHash('sha256').update(expected).digest();
    if (a.length === b.length && timingSafeEqual(a, b)) return null;

    recent.push(now);
    this.adminFailures.set('admin', recent);
    return 'Unauthorized';
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('update-severe-weather')
  async updateSevereWeatherOutlook() {
    await this.scrapeService.updateSevereWeatherOutlook();
    return { ok: true };
  }

  @Get('update-thunderstorm')
  async updateThunderstormOutlook() {
    await this.scrapeService.updateThunderstormOutlook();
    return { ok: true };
  }

  @Get('update-issued-alerts')
  async updateIssuedAlerts() {
    await this.scrapeService.updateIssuedAlerts();
    return { ok: true };
  }

  @Get('regen-ai-severe-weather-summary')
  async regenerateSevereWeatherSummary(
    @Query('reason') reason: string,
    @Query('outlookRefId') outlookRefId: string,
  ) {
    await this.aiGenerateService.generateSevereWeatherOutlookSummary(
      outlookRefId,
      reason,
    );
  }

  @Get('regen-ai-thunderstorm-summary')
  async regenerateThunderstormSummary(
    @Query('reason') reason: string,
    @Query('outlookRefId') outlookRefId: string,
  ) {
    await this.aiGenerateService.generateThunderstormOutlookSummary(
      outlookRefId,
      reason,
    );
  }

  // ------------------------------------------------------------
  // GANTT — paste arbitrary MetService warning text and get bars
  // back. Body: { input: string }
  // ------------------------------------------------------------
  @Post('generate-gantt')
  async generateGanttFromInput(@Body() body: { input?: string }) {
    const input = (body?.input || '').trim();
    if (!input) {
      return { ok: false, error: 'No input text provided' };
    }
    try {
      const chart = await this.aiGenerateService.generateGanttChart(input);
      return { ok: true, chart };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // ------------------------------------------------------------
  // GANTT — pull the latest scraped issued alerts straight from
  // Mongo, format them into MetService-style text, and run the
  // Gantt extraction. No body required.
  // ------------------------------------------------------------
  @Post('generate-gantt-from-latest')
  async generateGanttFromLatest() {
    try {
      const text = await this.scrapeRepository.getLatestIssuedAlertsAsText();
      if (!text) {
        // Nothing in force is a valid answer, not an error — the UI shows a
        // "No watches or warnings in force" holding message for it.
        const activeCount = await this.scrapeRepository.countActiveIssuedAlerts();
        if (activeCount === 0) {
          return { ok: true, noActiveAlerts: true };
        }
        return {
          ok: false,
          error: 'No issued alerts found in the database yet.',
        };
      }
      const chart = await this.aiGenerateService.generateGanttChart(text);
      return { ok: true, chart, sourceText: text };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // ------------------------------------------------------------
  // GANTT — regenerate a chart from whatever issued alerts were "latest"
  // as of a given timestamp, using the CURRENT extraction code. For
  // verifying a fix against an older real-world case (e.g. an
  // auto-captured snapshot from last night) without waiting for "latest"
  // to naturally cycle back around, and without disturbing the rolling
  // auto-captured snapshot list — this never writes to gantt_snapshots,
  // it only reads issued_alert_entries and returns a fresh chart.
  //
  // ADMIN ONLY — this triggers an AI call on demand against arbitrary
  // historical data, so it's gated the same way as Feedback/Notice's
  // admin endpoints (x-admin-key header, FEEDBACK_ADMIN_KEY secret), not
  // exposed on the public Gantt page.
  //
  // Body: { at: string } — an ISO timestamp, e.g. a snapshot's insertedAt.
  // ------------------------------------------------------------
  @Post('regenerate-gantt-at')
  async regenerateGanttAt(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Body() body: { at?: string },
  ) {
    const authError = this.checkAdmin(adminKey);
    if (authError) return { ok: false, error: authError };

    const atIso = body?.at;
    if (!atIso) {
      return { ok: false, error: 'No "at" timestamp provided' };
    }
    const at = new Date(atIso);
    if (Number.isNaN(at.getTime())) {
      return { ok: false, error: `Invalid "at" timestamp: ${atIso}` };
    }
    try {
      const { text, matchedAt } =
        await this.scrapeRepository.getIssuedAlertsAsTextAsOf(at);
      if (!text) {
        return {
          ok: false,
          error: `No issued alerts found on or before ${at.toISOString()}.`,
        };
      }
      const chart = await this.aiGenerateService.generateGanttChart(text);
      return {
        ok: true,
        chart,
        sourceText: text,
        matchedAt: matchedAt?.toISOString() ?? null,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // ------------------------------------------------------------
  // GANTT — replace an existing auto-captured snapshot's data in place
  // (same _id and insertedAt — only chart_title/bars/notes change). This
  // is how a regenerated chart (see regenerate-gantt-at above) actually
  // reaches the PUBLIC Gantt page: that endpoint only returns a fresh
  // chart for an admin to review, it never saves anything — this is the
  // explicit, separate "yes, replace the public one with this corrected
  // version" step.
  //
  // ADMIN ONLY — same x-admin-key gating as regenerate-gantt-at.
  // Body: { id: string, chart: { chart_title, bars, notes } }.
  // ------------------------------------------------------------
  @Post('update-gantt-snapshot')
  async updateGanttSnapshot(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Body()
    body: {
      id?: string;
      chart?: { chart_title?: string; bars?: GanttBar[]; notes?: string[] };
    },
  ) {
    const authError = this.checkAdmin(adminKey);
    if (authError) return { ok: false, error: authError };

    const { id, chart } = body || {};
    if (!id) return { ok: false, error: 'No snapshot id provided' };
    if (!chart || !Array.isArray(chart.bars)) {
      return { ok: false, error: 'No valid chart provided' };
    }
    try {
      const updated = await this.scrapeRepository.updateGanttSnapshot(id, {
        chart_title: chart.chart_title || '',
        bars: chart.bars,
        notes: chart.notes || [],
      });
      if (!updated) {
        return { ok: false, error: 'Snapshot not found (it may be out of the rolling window and been pruned).' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  // ------------------------------------------------------------
  // GANTT — the last up-to-5 auto-captured snapshots, newest first.
  // Captured automatically whenever issued alerts change (see
  // ScrapeService.captureGanttSnapshot). Read-only from the UI's
  // perspective — viewing/editing an old one in the bars editor is a
  // local-only operation and never writes back here.
  // ------------------------------------------------------------
  @Get('gantt-snapshots')
  async getGanttSnapshots() {
    try {
      const snapshots = await this.scrapeRepository.getGanttSnapshots();
      // Snapshots are only captured while alerts are in force, so once
      // everything expires the newest snapshot is stale. Tell the UI so it can
      // show "No watches or warnings in force" instead of that old chart.
      const activeCount = await this.scrapeRepository.countActiveIssuedAlerts();
      return {
        ok: true,
        noActiveAlerts: activeCount === 0,
        snapshots: snapshots.map((s) => ({
          id: s._id.toString(),
          chart_title: s.chart_title,
          bars: s.bars,
          notes: s.notes,
          insertedAt: s.insertedAt,
        })),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ScrapeRepository } from 'src/dao/scrape.repository';
import { AiGenerateService } from 'src/services/ai-generate/ai-generate.service';
import { AppService } from 'src/services/app.service';
import { ScrapeService } from 'src/services/scrape/scrape.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly scrapeService: ScrapeService,
    private readonly aiGenerateService: AiGenerateService,
    private readonly scrapeRepository: ScrapeRepository,
  ) {}

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
      return {
        ok: true,
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
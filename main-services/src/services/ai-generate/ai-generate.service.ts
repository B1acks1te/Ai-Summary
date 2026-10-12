import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { Rest } from 'ably';
import { DateTime } from 'luxon';
import { ScrapeRepository } from 'src/dao/scrape.repository';
import { NHISCHANNEL_EVENTS } from 'src/events';
import { z } from 'zod';
import {
  parseIssuedAnchorDate,
  resolveBarPeriod,
  resolvePeakPeriod,
} from './dateAnchor';
import { createGanttUserPrompt, ganttSystemPrompt } from './ganttPrompt';
import { buildSeverityHazardLabel, parseHeading } from './headingParser';
import {
  GanttBar,
  GanttBarExtraction,
  GanttChart,
  GanttChartSchema,
  SevereWeatherAISummarySchema,
  ThunderstormAISummarySchema,
} from './schema';
import {
  createSevereWeatherUserPrompt,
  severeWeatherSystemPrompt,
} from './severeWeatherPropmt';
import {
  createThunderstormUserPrompt,
  thunderstormSystemPrompt,
} from './thunderstormPropmt';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 8192;

@Injectable()
export class AiGenerateService {
  private readonly logger = new Logger(AiGenerateService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;

  constructor(private readonly scrapeRepository: ScrapeRepository) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  }

  // ============================================================
  // SEVERE WEATHER OUTLOOK SUMMARY (unchanged downstream contract)
  // ============================================================
  async generateSevereWeatherOutlookSummary(
    outlookRefId: string,
    reason: string,
  ) {
    this.logger.log(
      '****** Generating severe weather outlook AI summary ******',
    );
    this.logger.log(`Reason for generation: ${reason}`);
    this.logger.log(`Severe weather outlook Id: ${outlookRefId}`);

    const outlook =
      await this.scrapeRepository.findSevereWeatherOutlookById(outlookRefId);
    if (!outlook) {
      this.logger.error(
        `Severe weather outlook not found for ID: ${outlookRefId}`,
      );
      return;
    }

    this.logger.log(
      '--- Start Generating Severe Weather Outlook AI Summary ---',
    );
    void this.ablyPublishToClient(
      NHISCHANNEL_EVENTS.AI_SEVERE_WEATHER_OUTLOOK_SUMMARY_GENERATING,
      outlook._id.toString(),
    );

    const ai_resps = await Promise.all(
      outlook.outlookItems.map((item) =>
        this.invokeSevereWeatherChatCompletion(item.outlook),
      ),
    );

    this.logger.log('AI Summary generated.');
    const generatedAt = new Date();
    void this.scrapeRepository.insertAiGeneratedSevereWeatherSummary({
      outlookRefId: outlook._id.toString(),
      genReason: reason,
      generatedAt,
      generatedAtISO:
        DateTime.fromJSDate(generatedAt).setZone('Pacific/Auckland').toISO() ||
        '',
      content: ai_resps.map((summary, idx) => ({
        summary,
        date: outlook.outlookItems[idx].date,
      })),
    });
    this.logger.log('Collection: ai_severe_weather_outlook_summary updated.');

    await this.ablyPublishToClient(
      NHISCHANNEL_EVENTS.AI_SEVERE_WEATHER_OUTLOOK_SUMMARY_GENERATED,
      outlook._id.toString(),
    );
    this.logger.log('Channel message sent.');
    this.logger.log('--- End Generating AI Summary ---');
  }

  // ============================================================
  // THUNDERSTORM OUTLOOK SUMMARY
  // ============================================================
  async generateThunderstormOutlookSummary(
    outlookRefId: string,
    reason: string,
  ) {
    this.logger.log('****** Generating thunderstorm outlook AI summary ******');
    this.logger.log(`Reason for generation: ${reason}`);
    this.logger.log(`Thunderstorm outlook Id: ${outlookRefId}`);

    const outlook =
      await this.scrapeRepository.findThunderstormOutlookById(outlookRefId);
    if (!outlook) {
      this.logger.error(
        `Thunderstorm outlook not found for ID: ${outlookRefId}`,
      );
      return;
    }

    this.logger.log('--- Start Generating Thunderstorm Outlook AI Summary ---');
    void this.ablyPublishToClient(
      NHISCHANNEL_EVENTS.AI_THUNDERSTORM_OUTLOOK_SUMMARY_GENERATING,
      outlook._id.toString(),
    );

    const ai_resps = await Promise.all(
      outlook.items.map((item) =>
        this.invokeThunderstormChatCompletion(item.outlook),
      ),
    );

    this.logger.log('AI Summary generated.');
    const generatedAt = new Date();
    void this.scrapeRepository.insertAiGeneratedThunderstormSummary({
      outlookRefId: outlook._id.toString(),
      genReason: reason,
      generatedAt,
      generatedAtISO:
        DateTime.fromJSDate(generatedAt).setZone('Pacific/Auckland').toISO() ||
        '',
      content: ai_resps.map((summary, idx) => ({
        summary,
        date: outlook.items[idx].header,
      })),
    });
    this.logger.log('Collection: ai_thunderstorm_outlook_summary updated.');

    await this.ablyPublishToClient(
      NHISCHANNEL_EVENTS.AI_THUNDERSTORM_OUTLOOK_SUMMARY_GENERATED,
      outlook._id.toString(),
    );
    this.logger.log('Channel message sent.');
    this.logger.log('--- End Generating AI Summary ---');
  }

  // ============================================================
  // INVOCATIONS via Anthropic — tool-use forces structured output
  // ============================================================
  async invokeSevereWeatherChatCompletion(outlook: string) {
    const parsed = await this.invokeStructured({
      systemPrompt: severeWeatherSystemPrompt,
      userPrompt: createSevereWeatherUserPrompt(outlook),
      schema: SevereWeatherAISummarySchema,
      toolName: 'extract_severe_weather_summary',
      toolDescription:
        'Extract a structured severe-weather outlook summary from the supplied MetService text.',
    });
    return parsed?.chanceOfUpgrade || [];
  }

  async invokeThunderstormChatCompletion(outlook: string) {
    const parsed = await this.invokeStructured({
      systemPrompt: thunderstormSystemPrompt,
      userPrompt: createThunderstormUserPrompt(outlook),
      schema: ThunderstormAISummarySchema,
      toolName: 'extract_thunderstorm_summary',
      toolDescription:
        'Extract a structured thunderstorm outlook summary from the supplied MetService text.',
    });
    return parsed?.outlooks || [];
  }

  // ============================================================
  // GANTT CHART GENERATION (new feature)
  // ============================================================
  async generateGanttChart(input: string): Promise<GanttChart> {
    this.logger.log('****** Generating Gantt chart from input ******');
    if (!input || !input.trim()) {
      throw new Error('Empty input provided to generateGanttChart');
    }

    const parsed = await this.invokeStructured({
      systemPrompt: ganttSystemPrompt,
      userPrompt: createGanttUserPrompt(input),
      schema: GanttChartSchema,
      toolName: 'emit_gantt_chart',
      toolDescription:
        'Emit the structured Gantt-chart bars derived from the supplied MetService warning text.',
    });

    if (!parsed) {
      throw new Error('Anthropic returned no structured Gantt output');
    }

    // The AI's own start/end dates are extraction output, not trusted
    // calendar arithmetic (see dateAnchor.ts) — every bar's actual DATE is
    // recomputed here from its start_day/end_day plus the source's single
    // "Issued:" anchor date, keeping only the AI's HH:MM time-of-day.
    const anchorDate = parseIssuedAnchorDate(input);
    if (!anchorDate) {
      this.logger.warn(
        'generateGanttChart: no "Issued:" line found in input — skipping deterministic date correction and trusting the AI\'s own start/end dates as-is.',
      );
    }

    const bars: GanttBar[] = parsed.bars.map((bar) => {
      // The AI's own hazard_type/severity/label are extraction output, not
      // trusted classification or composition (see headingParser.ts) —
      // every bar's actual hazard_type, severity, and the "(severity
      // hazardtype)" portion of its label are derived deterministically
      // here from heading_text, which is a copy task, not a judgement call.
      const { hazard_type, severity, severityHazardLabel } =
        this.resolveSeverityAndHazard(bar);
      const label = `${bar.region}${
        bar.qualifier ? ` (${bar.qualifier})` : ''
      } (${severityHazardLabel})`;

      // The AI's own start/end dates are likewise extraction output, not
      // trusted calendar arithmetic (see dateAnchor.ts) — every bar's actual
      // DATE is recomputed here from its start_day/end_day plus the
      // source's single "Issued:" anchor date, keeping only the AI's HH:MM
      // time-of-day.
      if (!anchorDate) {
        // No anchor to correct against — fall back to the AI's own
        // best-effort start/end as-is.
        return {
          region: bar.region,
          hazard_type,
          severity,
          label,
          start: bar.start,
          end: bar.end,
          peak_start: bar.peak_start,
          peak_end: bar.peak_end,
          latitude: bar.latitude,
        };
      }

      const { start, end, startDate } = resolveBarPeriod(
        anchorDate,
        bar.start_day,
        bar.start,
        bar.end_day,
        bar.end,
      );

      let peak_start = bar.peak_start;
      let peak_end = bar.peak_end;
      if (
        bar.peak_start &&
        bar.peak_end &&
        bar.peak_start_day &&
        bar.peak_end_day
      ) {
        const peakResolved = resolvePeakPeriod(
          startDate,
          bar.peak_start_day,
          bar.peak_start,
          bar.peak_end_day,
          bar.peak_end,
        );
        peak_start = peakResolved.peak_start;
        peak_end = peakResolved.peak_end;
      }

      return {
        region: bar.region,
        hazard_type,
        severity,
        label,
        start,
        end,
        peak_start,
        peak_end,
        latitude: bar.latitude,
      };
    });

    const chart: GanttChart = { ...parsed, bars };

    this.logger.log(
      `Gantt chart generated: ${chart.bars.length} bars, title="${chart.chart_title}"`,
    );
    return chart;
  }

  /**
   * Deterministically derives a bar's hazard_type/severity (and the label's
   * "(severity hazardtype)" suffix) from heading_text — see headingParser.ts.
   * Falls back to the AI's own hazard_type/severity fields, logging a
   * warning, only when heading_text doesn't match any recognised MetService
   * heading shape.
   */
  private resolveSeverityAndHazard(bar: GanttBarExtraction) {
    const parsedHeading = parseHeading(bar.heading_text);
    if (!parsedHeading) {
      this.logger.warn(
        `generateGanttChart: could not classify heading_text "${bar.heading_text}" for region "${bar.region}" — falling back to the AI's own hazard_type/severity for this bar. If this keeps happening, headingParser.ts needs extending for a new heading shape.`,
      );
    }
    const hazard_type = parsedHeading?.hazardType ?? bar.hazard_type;
    const severity = parsedHeading?.severity ?? bar.severity;
    return {
      hazard_type,
      severity,
      severityHazardLabel: buildSeverityHazardLabel(hazard_type, severity),
    };
  }

  // ============================================================
  // SHARED: Anthropic structured-output invocation
  // ------------------------------------------------------------
  // Uses tool_use to force the model to return JSON conformant to
  // the supplied Zod schema. This replaces openai/helpers/zod's
  // zodResponseFormat used previously.
  //
  // JSON Schema generation uses Zod 4's NATIVE z.toJSONSchema().
  // (External `zod-to-json-schema` package is Zod 3-only and will
  //  not compile against Zod 4 internals.)
  // ============================================================
  private async invokeStructured<T extends z.ZodType>(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema: T;
    toolName: string;
    toolDescription: string;
  }): Promise<z.infer<T> | null> {
    // Generate JSON Schema and strip $schema field — Anthropic doesn't
    // need it and some validators choke on draft-2020-12 metadata.
    const generated = z.toJSONSchema(opts.schema) as Record<string, unknown>;
    delete generated['$schema'];

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
      tools: [
        {
          name: opts.toolName,
          description: opts.toolDescription,
          input_schema: generated as Anthropic.Tool['input_schema'],
        },
      ],
      tool_choice: { type: 'tool', name: opts.toolName },
    });

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (!toolBlock) {
      this.logger.error(
        `No tool_use block in Anthropic response. stop_reason=${response.stop_reason}, content types=${response.content
          .map((c) => c.type)
          .join(',')}`,
      );
      return null;
    }

    const validation = opts.schema.safeParse(toolBlock.input);
    if (!validation.success) {
      this.logger.error(
        `Anthropic tool output failed Zod validation: ${validation.error.message}`,
      );
      return null;
    }

    return validation.data;
  }

  private async ablyPublishToClient(name: string, data: string) {
    const ablyClient = new Rest({
      key: process.env.ABLY_API_KEY,
      clientId: 'nhis-mq',
    });
    const channel = ablyClient.channels.get(process.env.ABLY_CHANNEL_NAME!);
    await channel.publish(name, data);
  }
}
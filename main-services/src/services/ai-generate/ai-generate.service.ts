import { Injectable, Logger } from '@nestjs/common';
import { Rest } from 'ably';
import { DateTime } from 'luxon';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ScrapeRepository } from 'src/dao/scrape.repository';
import { NHISCHANNEL_EVENTS } from 'src/events';
import { z } from 'zod';
import { createGanttUserPrompt, ganttSystemPrompt } from './ganttPrompt';
import {
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

const DEFAULT_MODEL = 'gpt-5-mini';

@Injectable()
export class AiGenerateService {
  private readonly logger = new Logger(AiGenerateService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(private readonly scrapeRepository: ScrapeRepository) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  }

  // ============================================================
  // SEVERE WEATHER OUTLOOK SUMMARY
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
  // INVOCATIONS via OpenAI — zodResponseFormat for structured output
  // ============================================================
  async invokeSevereWeatherChatCompletion(outlook: string) {
    const parsed = await this.invokeStructured({
      systemPrompt: severeWeatherSystemPrompt,
      userPrompt: createSevereWeatherUserPrompt(outlook),
      schema: SevereWeatherAISummarySchema,
      schemaName: 'SevereWeatherAISummary',
    });
    return parsed?.chanceOfUpgrade || [];
  }

  async invokeThunderstormChatCompletion(outlook: string) {
    const parsed = await this.invokeStructured({
      systemPrompt: thunderstormSystemPrompt,
      userPrompt: createThunderstormUserPrompt(outlook),
      schema: ThunderstormAISummarySchema,
      schemaName: 'ThunderstormAISummary',
    });
    return parsed?.outlooks || [];
  }

  // ============================================================
  // GANTT CHART GENERATION
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
      schemaName: 'GanttChart',
    });

    if (!parsed) {
      throw new Error('OpenAI returned no structured Gantt output');
    }

    this.logger.log(
      `Gantt chart generated: ${parsed.bars.length} bars, title="${parsed.chart_title}"`,
    );
    return parsed;
  }

  // ============================================================
  // SHARED: OpenAI structured-output invocation
  // ------------------------------------------------------------
  // Uses chat.completions.parse() with zodResponseFormat to force
  // JSON conformant to the supplied Zod schema.
  // ============================================================
  private async invokeStructured<T extends z.ZodType>(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema: T;
    schemaName: string;
  }): Promise<z.infer<T> | null> {
    const response = await this.openai.chat.completions.parse({
      model: this.model,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
      response_format: zodResponseFormat(opts.schema, opts.schemaName),
    });

    const parsed = response.choices[0]?.message?.parsed;
    if (!parsed) {
      this.logger.error(
        `No parsed output from OpenAI. finish_reason=${response.choices[0]?.finish_reason}, refusal=${response.choices[0]?.message?.refusal}`,
      );
      return null;
    }

    return parsed as z.infer<T>;
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

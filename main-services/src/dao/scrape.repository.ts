import { Injectable, Logger } from '@nestjs/common';

import { DateTime } from 'luxon';
import { ObjectId, WithId } from 'mongodb';
import { MongoService } from 'src/database/mongo.service';
import {
  AISevereWeatherOutlookSummaryDocument,
  AIThunderstormOutlookSummaryDocument,
} from 'src/services/ai-generate/typing';
import type { GanttChart } from 'src/services/ai-generate/schema';
import {
  GanttSnapshotDoc,
  IssuedAlertEntriesDocument,
  SevereWeatherDoc,
  ThunderstormDoc,
} from './typing';

const ISSUED_ALERTS_COLLECTION = 'issued_alert_entries';
const SEVERE_WEATHER_COLLECTION = 'severe_weather_outlook';
const THUNDERSTORM_COLLECTION = 'thunderstorm_outlook';
const AI_SEVERE_WEATHER_SUMMARY_COLLECTION =
  'ai_severe_weather_outlook_summary';
const AI_THUNDERSTORM_SUMMARY_COLLECTION = 'ai_thunderstorm_outlook_summary';
const GANTT_SNAPSHOTS_COLLECTION = 'gantt_snapshots';
// Auto-captured on every issued-alert change. Kept small deliberately — this
// is a rolling recent-history view, not a permanent archive.
const MAX_GANTT_SNAPSHOTS = 5;

@Injectable()
export class ScrapeRepository {
  private readonly logger = new Logger(ScrapeRepository.name);

  constructor(private readonly mongoService: MongoService) {}

  async findSevereWeatherOutlookById(
    id: string,
  ): Promise<WithId<SevereWeatherDoc> | null> {
    const collection = this.mongoService.getCollection<SevereWeatherDoc>(
      SEVERE_WEATHER_COLLECTION,
    );
    return collection.findOne({ _id: new ObjectId(id) });
  }

  async findThunderstormOutlookById(
    id: string,
  ): Promise<WithId<ThunderstormDoc> | null> {
    const collection = this.mongoService.getCollection<ThunderstormDoc>(
      THUNDERSTORM_COLLECTION,
    );
    return collection.findOne({ _id: new ObjectId(id) });
  }

  async findLatestSevereWeatherOutlook(): Promise<SevereWeatherDoc | null> {
    const collection = this.mongoService.getCollection<SevereWeatherDoc>(
      SEVERE_WEATHER_COLLECTION,
    );
    return collection.findOne({}, { sort: { insertedAt: -1 } });
  }

  async findLatestThunderstormOutlook(): Promise<ThunderstormDoc | null> {
    const collection = this.mongoService.getCollection<ThunderstormDoc>(
      THUNDERSTORM_COLLECTION,
    );
    return collection.findOne({}, { sort: { insertedAt: -1 } });
  }

  async insertSevereWeatherOutlook(scrapedOutlook: SevereWeatherDoc) {
    const collection = this.mongoService.getCollection<SevereWeatherDoc>(
      SEVERE_WEATHER_COLLECTION,
    );
    const result = await collection.insertOne(scrapedOutlook);
    this.logger.log(
      `Severe Weather Outlook inserted with id: ${result.insertedId.toString()}`,
    );
    return result;
  }

  async insertThunderstormOutlook(scrapedOutlook: ThunderstormDoc) {
    const collection = this.mongoService.getCollection<ThunderstormDoc>(
      THUNDERSTORM_COLLECTION,
    );
    const result = await collection.insertOne(scrapedOutlook);
    this.logger.log(
      `Thunderstorm Outlook inserted with id: ${result.insertedId.toString()}`,
    );
    return result;
  }

  async findLatestIssuedAlerts(): Promise<IssuedAlertEntriesDocument | null> {
    const collection =
      this.mongoService.getCollection<IssuedAlertEntriesDocument>(
        ISSUED_ALERTS_COLLECTION,
      );
    return collection.findOne({}, { sort: { insertedAt: -1 } });
  }

  // ------------------------------------------------------------
  // Every change to the issued-alerts feed inserts a NEW document rather
  // than overwriting one (see ScrapeService.updateIssuedAlerts), so the
  // full history is sitting in this collection already. This finds
  // whichever one was "latest" as of a given point in time — i.e. the most
  // recent record with insertedAt <= at — which is what lets an older
  // Gantt chart be regenerated against the exact alert set it was
  // originally built from, even though "latest" has since moved on.
  // ------------------------------------------------------------
  async findIssuedAlertsAsOf(
    at: Date,
  ): Promise<IssuedAlertEntriesDocument | null> {
    const collection =
      this.mongoService.getCollection<IssuedAlertEntriesDocument>(
        ISSUED_ALERTS_COLLECTION,
      );
    return collection.findOne(
      { insertedAt: { $lte: at } },
      { sort: { insertedAt: -1 } },
    );
  }

  async insertIssuedAlerts(
    issuedAlertEntries: IssuedAlertEntriesDocument,
  ): Promise<void> {
    const collection =
      this.mongoService.getCollection<IssuedAlertEntriesDocument>(
        ISSUED_ALERTS_COLLECTION,
      );
    const result = await collection.insertOne(issuedAlertEntries);
    this.logger.log(
      `Issued Alerts inserted with id: ${result.insertedId.toString()}`,
    );
  }

  async insertAiGeneratedSevereWeatherSummary(
    data: AISevereWeatherOutlookSummaryDocument,
  ) {
    const collection =
      this.mongoService.getCollection<AISevereWeatherOutlookSummaryDocument>(
        AI_SEVERE_WEATHER_SUMMARY_COLLECTION,
      );
    await collection.insertOne(data);
    this.logger.log('Collection: ai_severe_weather_outlook_summary updated.');
  }

  async insertAiGeneratedThunderstormSummary(
    data: AIThunderstormOutlookSummaryDocument,
  ) {
    const collection =
      this.mongoService.getCollection<AIThunderstormOutlookSummaryDocument>(
        AI_THUNDERSTORM_SUMMARY_COLLECTION,
      );
    await collection.insertOne(data);
    this.logger.log('Collection: ai_thunderstorm_outlook_summary updated.');
  }

  // ------------------------------------------------------------
  // NEW: render the latest scraped issued alerts as MetService-style
  // text suitable for feeding into the Gantt extraction prompt.
  //
  // IMPORTANT — this text MUST carry an "Issued:" line (see below). A real
  // MetService bulletin always has one, and dateAnchor.ts's
  // parseIssuedAnchorDate() depends on finding exactly that one line to
  // anchor every day-of-week abbreviation in the document to a real
  // calendar date. Without it, parseIssuedAnchorDate() returns null and
  // ai-generate.service.ts's generateGanttChart() silently falls back to
  // trusting the AI's own raw start/end AND peak_start/peak_end as-is,
  // skipping resolveBarPeriod()/resolvePeakPeriod() entirely for every
  // bar — exactly the "AI's own date arithmetic drifts, especially many
  // paragraphs into a long document" failure mode dateAnchor.ts exists to
  // prevent (see its own file header). That drift is why the Gantt
  // "Use latest scraped alerts" flow could previously render a per-bar
  // peak highlight that visibly doesn't line up with the overall peak
  // band — a manually pasted bulletin never showed this bug because it
  // always carries a real "Issued:" line of its own.
  // ------------------------------------------------------------
  async getLatestIssuedAlertsAsText(): Promise<string> {
    const latest = await this.findLatestIssuedAlerts();
    return this.issuedAlertsDocToText(latest);
  }

  // ------------------------------------------------------------
  // Same as getLatestIssuedAlertsAsText, but for whatever was "latest" as
  // of a given point in time (findIssuedAlertsAsOf) rather than right now.
  // This is what lets an older auto-captured Gantt chart be regenerated
  // from its original source data to verify a fix, even after newer
  // alerts have come in and "latest" has moved past it. Returns the
  // matched record's own timestamp alongside the text so a caller can
  // show exactly what it regenerated against.
  // ------------------------------------------------------------
  async getIssuedAlertsAsTextAsOf(
    at: Date,
  ): Promise<{ text: string; matchedAt: Date | null }> {
    const record = await this.findIssuedAlertsAsOf(at);
    return {
      text: this.issuedAlertsDocToText(record),
      matchedAt: record?.insertedAt ?? null,
    };
  }

  private issuedAlertsDocToText(
    doc: IssuedAlertEntriesDocument | null,
  ): string {
    if (!doc || !doc.entries.length) {
      return '';
    }

    const fmt = (iso: string) => {
      try {
        const dt = DateTime.fromISO(iso, { setZone: true }).setZone(
          'Pacific/Auckland',
        );
        return dt.isValid ? dt.toFormat("h:mma cccc d LLLL yyyy") : iso;
      } catch {
        return iso;
      }
    };

    const blocks = doc.entries
      .filter((e) => e._status !== 'removed')
      .map((e) => {
        const headline = e.headline || e.event || 'Weather alert';
        const area = e.areaDesc || '';
        const period = `from ${fmt(e.onset)} to ${fmt(e.expires)}`;
        const upgrade = e.ChanceOfUpgrade
          ? `Chance of upgrade: ${e.ChanceOfUpgrade}`
          : '';
        const desc = (e.description || '').trim();
        return [
          headline,
          area ? `Area: ${area}` : '',
          `Period: ${period}`,
          upgrade,
          desc,
        ]
          .filter(Boolean)
          .join('\n');
      });

    // Anchored to when this alert set was last scraped/updated — the
    // closest real timestamp we have standing in for "when this was
    // issued". Format matches dateAnchor.ts's parseIssuedAnchorDate regex
    // exactly: "Issued: H:MMam Ddd D Month YYYY" (e.g.
    // "Issued: 9:41am Tue 26 October 2026").
    const anchor = DateTime.fromJSDate(doc.updatedAt).setZone(
      'Pacific/Auckland',
    );
    const issuedLine = anchor.isValid
      ? `Issued: ${anchor.toFormat('h:mma ccc d LLLL yyyy')}`
      : '';

    return [issuedLine, blocks.join('\n\n---\n\n')]
      .filter(Boolean)
      .join('\n\n');
  }

  // ------------------------------------------------------------
  // How many watches/warnings are currently in force — i.e. entries in the
  // latest issued-alerts record that aren't flagged 'removed'. Returns null
  // when there is no record at all yet (so "no data" can be told apart from
  // "genuinely nothing in force").
  // ------------------------------------------------------------
  async countActiveIssuedAlerts(): Promise<number | null> {
    const latest = await this.findLatestIssuedAlerts();
    if (!latest) return null;
    return latest.entries.filter((e) => e._status !== 'removed').length;
  }

  // ------------------------------------------------------------
  // GANTT SNAPSHOTS — auto-captured whenever issued alerts change.
  // Rolling window of the most recent MAX_GANTT_SNAPSHOTS only; older
  // ones are pruned on insert. Viewing/editing an old snapshot in the
  // public Gantt UI's bars editor is a local, non-persisted operation —
  // that never updates an existing snapshot document, only insertGantt-
  // Snapshot (below) inserts and prunes.
  //
  // updateGanttSnapshot is the one deliberate exception: an admin-only,
  // explicit "replace this snapshot's data" action (see
  // GanttRegenAdmin.tsx / POST /update-gantt-snapshot) for correcting an
  // already-public snapshot in place — e.g. after fixing a bug, so
  // whatever the public Gantt page is already showing for that moment
  // becomes right, rather than only new snapshots going forward. It keeps
  // the document's _id and insertedAt (so its position/label in the
  // rolling list is unchanged) and only replaces the chart content.
  // ------------------------------------------------------------
  async updateGanttSnapshot(
    id: string,
    chart: Pick<GanttChart, 'chart_title' | 'bars' | 'notes'>,
  ): Promise<boolean> {
    const collection = this.mongoService.getCollection<GanttSnapshotDoc>(
      GANTT_SNAPSHOTS_COLLECTION,
    );
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          chart_title: chart.chart_title,
          bars: chart.bars,
          notes: chart.notes,
        },
      },
    );
    if (result.matchedCount > 0) {
      this.logger.log(`Gantt snapshot ${id} updated (corrected in place).`);
    }
    return result.matchedCount > 0;
  }

  async insertGanttSnapshot(chart: GanttChart): Promise<void> {
    const collection = this.mongoService.getCollection<GanttSnapshotDoc>(
      GANTT_SNAPSHOTS_COLLECTION,
    );

    await collection.insertOne({
      chart_title: chart.chart_title,
      bars: chart.bars,
      notes: chart.notes,
      insertedAt: new Date(),
    });

    const all = await collection
      .find({}, { sort: { insertedAt: -1 }, projection: { _id: 1 } })
      .toArray();

    if (all.length > MAX_GANTT_SNAPSHOTS) {
      const staleIds = all
        .slice(MAX_GANTT_SNAPSHOTS)
        .map((doc) => new ObjectId(doc._id));
      await collection.deleteMany({ _id: { $in: staleIds } });
      this.logger.log(
        `Pruned ${staleIds.length} old Gantt snapshot(s), keeping latest ${MAX_GANTT_SNAPSHOTS}.`,
      );
    }
  }

  async getGanttSnapshots(): Promise<WithId<GanttSnapshotDoc>[]> {
    const collection = this.mongoService.getCollection<GanttSnapshotDoc>(
      GANTT_SNAPSHOTS_COLLECTION,
    );
    return collection
      .find({}, { sort: { insertedAt: -1 }, limit: MAX_GANTT_SNAPSHOTS })
      .toArray();
  }
}
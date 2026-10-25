import { checkAdminKey } from '@/lib/adminAuth.server';
import {
  getAISevereWeatherOutlookSummaryCollection,
  getAIThunderstormOutlookSummaryCollection,
  getIssuedAlertCollection,
  getSevereWeatherOutlookCollection,
  getThunderstormOutlookCollection,
} from '@/lib/mongodb';
import type {
  AISevereWeatherOutlookSummaryResp,
  AIThunderstormOutlookSummaryResp,
  IssuedAlertEntries,
  SevereWeatherOutlook,
  ThunderstormOutlook,
} from '@/types';
import type { GanttChart } from '@/types/gantt';
import { createServerFn } from '@tanstack/react-start';
import axios from 'axios';
import { DateTime } from 'luxon';
import type { Document, WithId } from 'mongodb';
import { ObjectId } from 'mongodb';

type VerifyResponse = { ok: boolean; error?: string };

// A single shared sign-in gate for the whole Admin UI (Overview / Notices /
// Feedback / Debug tabs). It only checks the password - it doesn't load any
// data itself, so a wrong guess here never touches Mongo or main-services.
export const verifyAdminKey = createServerFn({ method: 'POST' })
  .inputValidator((data: { adminKey: string }) => data)
  .handler(async ({ data }): Promise<VerifyResponse> => {
    const error = checkAdminKey(data.adminKey);
    return error ? { ok: false, error } : { ok: true };
  });

type CollectionStat = { count: number; lastInsertedAt: string | null };

export type AdminStats = {
  severeWeatherOutlook: CollectionStat;
  thunderstormOutlook: CollectionStat;
  issuedAlerts: CollectionStat;
};

type StatsResponse =
  | { ok: true; stats: AdminStats }
  | { ok: false; error: string };

// Overview tab numbers. Gated the same way as the raw debug lookups below -
// these three collections are queried directly against MongoDB from this
// container, so they need their own check rather than relying on
// main-services having already verified something.
export const getAdminStats = createServerFn({ method: 'POST' })
  .inputValidator((data: { adminKey: string }) => data)
  .handler(async ({ data }): Promise<StatsResponse> => {
    const authError = checkAdminKey(data.adminKey);
    if (authError) return { ok: false, error: authError };

    try {
      const [severeWeatherOutlook, thunderstormOutlook, issuedAlerts] =
        await Promise.all([
          collectionStat(await getSevereWeatherOutlookCollection()),
          collectionStat(await getThunderstormOutlookCollection()),
          collectionStat(await getIssuedAlertCollection()),
        ]);
      return {
        ok: true,
        stats: { severeWeatherOutlook, thunderstormOutlook, issuedAlerts },
      };
    } catch (error) {
      console.error('getAdminStats error:', error);
      return { ok: false, error: 'Could not load the overview stats.' };
    }
  });

// ---------------------------------------------------------------------------
// Debug/Advanced raw-ID lookups — moved here from the old /search page.
// These look up ANY document by its raw Mongo _id, with no relationship to
// what the signed-in person is allowed to see, so (unlike the AI-summary
// lookups further below, which take an outlookRefId the public dashboard
// already knows) they always require the admin key.
// ---------------------------------------------------------------------------

function parseObjectId(id: string): ObjectId | null {
  try {
    return ObjectId.createFromHexString(id);
  } catch {
    return null;
  }
}

export const adminGetSevereWeatherOutlookById = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; id: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; outlooks: (SevereWeatherOutlook & { insertedAt: Date })[] }
      | { ok: false; error: string }
    > => {
      const authError = checkAdminKey(data.adminKey);
      if (authError) return { ok: false, error: authError };
      const objectId = parseObjectId(data.id.trim());
      if (!objectId) return { ok: false, error: 'That is not a valid ID.' };

      const collection = await getSevereWeatherOutlookCollection();
      const outlooks = await collection.find({ _id: objectId }).toArray();
      return {
        ok: true,
        outlooks: outlooks.map((outlook) => ({
          id: outlook._id.toString(),
          issuedDate: outlook.issuedDate,
          outlookItems: outlook.outlookItems,
          insertedAt: outlook.insertedAt,
        })),
      };
    },
  );

export const adminGetThunderstormOutlookById = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; id: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; outlooks: (ThunderstormOutlook & { insertedAt: Date })[] }
      | { ok: false; error: string }
    > => {
      const authError = checkAdminKey(data.adminKey);
      if (authError) return { ok: false, error: authError };
      const objectId = parseObjectId(data.id.trim());
      if (!objectId) return { ok: false, error: 'That is not a valid ID.' };

      const collection = await getThunderstormOutlookCollection();
      const outlooks = await collection.find({ _id: objectId }).toArray();
      return {
        ok: true,
        outlooks: outlooks.map((outlook) => ({
          id: outlook._id.toString(),
          items: outlook.items,
          refIssuedDates: outlook.refIssuedDates,
          insertedAt: outlook.insertedAt,
        })),
      };
    },
  );

export const adminGetIssuedWarningsAndWatchesById = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; id: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; entries: IssuedAlertEntries[] } | { ok: false; error: string }
    > => {
      const authError = checkAdminKey(data.adminKey);
      if (authError) return { ok: false, error: authError };
      const objectId = parseObjectId(data.id.trim());
      if (!objectId) return { ok: false, error: 'That is not a valid ID.' };

      const collection = await getIssuedAlertCollection();
      const items = await collection.find({ _id: objectId }).toArray();
      return {
        ok: true,
        entries: items.map((item) => ({
          id: item._id.toString(),
          updatedAt: item.updatedAt,
          updatedAtISO: item.updatedAtISO,
          entries: item.entries,
          insertedAt: item.insertedAt,
        })),
      };
    },
  );

export const adminGetSevereWeatherOutlookAISummaryById = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; outlookRefId: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; summary: AISevereWeatherOutlookSummaryResp | null }
      | { ok: false; error: string }
    > => {
      const authError = checkAdminKey(data.adminKey);
      if (authError) return { ok: false, error: authError };

      const collection = await getAISevereWeatherOutlookSummaryCollection();
      const summaryDoc = await collection.findOne(
        { outlookRefId: data.outlookRefId },
        { sort: { generatedAt: -1 } },
      );
      return {
        ok: true,
        summary: summaryDoc
          ? {
              id: summaryDoc._id.toString(),
              outlookRefId: summaryDoc.outlookRefId,
              genReason: summaryDoc.genReason,
              generatedAt: summaryDoc.generatedAt,
              generatedAtISO: summaryDoc.generatedAtISO,
              content: summaryDoc.content,
            }
          : null,
      };
    },
  );

export const adminGetThunderstormOutlookAISummaryById = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; outlookRefId: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; summary: AIThunderstormOutlookSummaryResp | null }
      | { ok: false; error: string }
    > => {
      const authError = checkAdminKey(data.adminKey);
      if (authError) return { ok: false, error: authError };

      const collection = await getAIThunderstormOutlookSummaryCollection();
      const summaryDoc = await collection.findOne(
        { outlookRefId: data.outlookRefId },
        { sort: { generatedAt: -1 } },
      );
      return {
        ok: true,
        summary: summaryDoc
          ? {
              id: summaryDoc._id.toString(),
              outlookRefId: summaryDoc.outlookRefId,
              genReason: summaryDoc.genReason,
              generatedAt: summaryDoc.generatedAt,
              generatedAtISO: summaryDoc.generatedAtISO,
              content: summaryDoc.content,
            }
          : null,
      };
    },
  );

// ---------------------------------------------------------------------------
// Browse by date — an alternative to typing a raw ID (which nobody has
// memorised) for the same five collections. Pick an NZ calendar day and get
// back everything inserted/generated that day, each with just enough of a
// preview to tell entries apart before opening the full JSON.
// ---------------------------------------------------------------------------

export type DateListItem = { id: string; when: string; preview: string };
type DateListResponse =
  | { ok: true; items: DateListItem[] }
  | { ok: false; error: string };

const MAX_DATE_LIST_RESULTS = 200;

// "2026-10-11" -> that NZ calendar day's [start, end) as UTC instants, so the
// query is correct across DST changes rather than assuming a fixed +12/+13
// offset.
function nzDayBounds(date: string): { start: Date; end: Date } | null {
  const start = DateTime.fromISO(date, { zone: 'Pacific/Auckland' }).startOf(
    'day',
  );
  if (!start.isValid) return null;
  return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
}

export const adminListSevereWeatherOutlookByDate = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; date: string }) => data)
  .handler(async ({ data }): Promise<DateListResponse> => {
    const authError = checkAdminKey(data.adminKey);
    if (authError) return { ok: false, error: authError };
    const bounds = nzDayBounds(data.date);
    if (!bounds) return { ok: false, error: 'That is not a valid date.' };

    const collection = await getSevereWeatherOutlookCollection();
    const docs = await collection
      .find({ insertedAt: { $gte: bounds.start, $lt: bounds.end } })
      .sort({ insertedAt: -1 })
      .limit(MAX_DATE_LIST_RESULTS)
      .toArray();
    return {
      ok: true,
      items: docs.map((d) => ({
        id: d._id.toString(),
        when: new Date(d.insertedAt).toISOString(),
        preview: `Issued: ${d.issuedDate}`,
      })),
    };
  });

export const adminListThunderstormOutlookByDate = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; date: string }) => data)
  .handler(async ({ data }): Promise<DateListResponse> => {
    const authError = checkAdminKey(data.adminKey);
    if (authError) return { ok: false, error: authError };
    const bounds = nzDayBounds(data.date);
    if (!bounds) return { ok: false, error: 'That is not a valid date.' };

    const collection = await getThunderstormOutlookCollection();
    const docs = await collection
      .find({ insertedAt: { $gte: bounds.start, $lt: bounds.end } })
      .sort({ insertedAt: -1 })
      .limit(MAX_DATE_LIST_RESULTS)
      .toArray();
    return {
      ok: true,
      items: docs.map((d) => ({
        id: d._id.toString(),
        when: new Date(d.insertedAt).toISOString(),
        preview: d.refIssuedDates?.length
          ? `Refs: ${d.refIssuedDates.join(', ')}`
          : `${d.items.length} item(s)`,
      })),
    };
  });

export const adminListIssuedWarningsAndWatchesByDate = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; date: string }) => data)
  .handler(async ({ data }): Promise<DateListResponse> => {
    const authError = checkAdminKey(data.adminKey);
    if (authError) return { ok: false, error: authError };
    const bounds = nzDayBounds(data.date);
    if (!bounds) return { ok: false, error: 'That is not a valid date.' };

    const collection = await getIssuedAlertCollection();
    const docs = await collection
      .find({ insertedAt: { $gte: bounds.start, $lt: bounds.end } })
      .sort({ insertedAt: -1 })
      .limit(MAX_DATE_LIST_RESULTS)
      .toArray();
    return {
      ok: true,
      items: docs.map((d) => ({
        id: d._id.toString(),
        when: new Date(d.insertedAt).toISOString(),
        preview: `${d.entries.length} alert(s) in force`,
      })),
    };
  });

export const adminListSevereWeatherOutlookAISummaryByDate = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; date: string }) => data)
  .handler(async ({ data }): Promise<DateListResponse> => {
    const authError = checkAdminKey(data.adminKey);
    if (authError) return { ok: false, error: authError };
    const bounds = nzDayBounds(data.date);
    if (!bounds) return { ok: false, error: 'That is not a valid date.' };

    const collection = await getAISevereWeatherOutlookSummaryCollection();
    const docs = await collection
      .find({ generatedAt: { $gte: bounds.start, $lt: bounds.end } })
      .sort({ generatedAt: -1 })
      .limit(MAX_DATE_LIST_RESULTS)
      .toArray();
    // The summary's own _id isn't what the by-ID lookup takes - it takes the
    // outlookRefId it was generated from, so that's what's returned here as
    // `id`, ready to feed straight back into that lookup.
    return {
      ok: true,
      items: docs.map((d) => ({
        id: d.outlookRefId,
        when: new Date(d.generatedAt).toISOString(),
        preview: d.genReason || 'AI summary',
      })),
    };
  });

export const adminListThunderstormOutlookAISummaryByDate = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { adminKey: string; date: string }) => data)
  .handler(async ({ data }): Promise<DateListResponse> => {
    const authError = checkAdminKey(data.adminKey);
    if (authError) return { ok: false, error: authError };
    const bounds = nzDayBounds(data.date);
    if (!bounds) return { ok: false, error: 'That is not a valid date.' };

    const collection = await getAIThunderstormOutlookSummaryCollection();
    const docs = await collection
      .find({ generatedAt: { $gte: bounds.start, $lt: bounds.end } })
      .sort({ generatedAt: -1 })
      .limit(MAX_DATE_LIST_RESULTS)
      .toArray();
    return {
      ok: true,
      items: docs.map((d) => ({
        id: d.outlookRefId,
        when: new Date(d.generatedAt).toISOString(),
        preview: d.genReason || 'AI summary',
      })),
    };
  });

// ---------------------------------------------------------------------------
// GANTT REGEN — admin-only. Re-runs a past moment's issued-alerts data
// through the CURRENT Gantt extraction code, for verifying a fix against a
// real older case (e.g. a snapshot that showed a bug) without waiting for
// "latest" to cycle back to it. Never writes anything back — main-services'
// /regenerate-gantt-at only reads issued_alert_entries and returns a fresh,
// unsaved chart. Checked here first (so a wrong key never reaches
// main-services), then re-checked by main-services itself via the
// x-admin-key header (defense in depth, same as Notice/Feedback).
// ---------------------------------------------------------------------------
type RegenerateGanttAtResponse =
  | {
      ok: true;
      chart: GanttChart;
      sourceText?: string;
      matchedAt: string | null;
    }
  | { ok: false; error: string };

export const adminRegenerateGanttAt = createServerFn({ method: 'POST' })
  .inputValidator((data: { adminKey: string; at: string }) => data)
  .handler(async ({ data }): Promise<RegenerateGanttAtResponse> => {
    const authError = checkAdminKey(data.adminKey);
    if (authError) return { ok: false, error: authError };

    try {
      const resp = await axios.post<RegenerateGanttAtResponse>(
        `${process.env.MAIN_SERVICES_URL!}/regenerate-gantt-at`,
        { at: data.at },
        { headers: { 'x-admin-key': data.adminKey } },
      );
      return resp.data;
    } catch (error) {
      console.error('adminRegenerateGanttAt error:', error);
      return { ok: false, error: `${error}` };
    }
  });

// Replaces an existing auto-captured snapshot's data in place (same _id,
// same position/label in the rolling list — only the chart content
// changes). This is the step that actually makes a regenerated chart
// visible on the PUBLIC Gantt page: adminRegenerateGanttAt above only
// returns a fresh chart for review, it never saves anything.
type UpdateGanttSnapshotResponse =
  | { ok: true }
  | { ok: false; error: string };

export const adminUpdateGanttSnapshot = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { adminKey: string; id: string; chart: GanttChart }) => data,
  )
  .handler(async ({ data }): Promise<UpdateGanttSnapshotResponse> => {
    const authError = checkAdminKey(data.adminKey);
    if (authError) return { ok: false, error: authError };

    try {
      const resp = await axios.post<UpdateGanttSnapshotResponse>(
        `${process.env.MAIN_SERVICES_URL!}/update-gantt-snapshot`,
        { id: data.id, chart: data.chart },
        { headers: { 'x-admin-key': data.adminKey } },
      );
      return resp.data;
    } catch (error) {
      console.error('adminUpdateGanttSnapshot error:', error);
      return { ok: false, error: `${error}` };
    }
  });

async function collectionStat<
  T extends Document & { insertedAt?: Date },
>(collection: {
  countDocuments: () => Promise<number>;
  find: (filter: Record<string, never>) => {
    sort: (spec: Record<string, 1 | -1>) => {
      limit: (n: number) => { toArray: () => Promise<WithId<T>[]> };
    };
  };
}): Promise<CollectionStat> {
  const [count, latest] = await Promise.all([
    collection.countDocuments(),
    collection.find({}).sort({ insertedAt: -1 }).limit(1).toArray(),
  ]);
  return {
    count,
    lastInsertedAt: latest[0]?.insertedAt
      ? new Date(latest[0].insertedAt).toISOString()
      : null,
  };
}
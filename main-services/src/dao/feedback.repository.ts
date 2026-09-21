import { Injectable } from '@nestjs/common';
import type { Filter } from 'mongodb';
import { MongoService } from 'src/database/mongo.service';

export const FEEDBACK_TYPES = [
  'bug',
  'data',
  'change',
  'feature',
  'question',
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_STATUSES = ['new', 'triaged', 'done', 'wont_do'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackContextValue = string | number | boolean;

export type FeedbackDoc = {
  ref: string; // e.g. FB-0007 — what the person is given to quote back
  type: FeedbackType;
  description: string;
  contact: string; // optional name/email, '' when anonymous
  page: string;
  context: Record<string, FeedbackContextValue>;
  userAgent: string;
  env: string; // which stack this came from (dev / master)
  status: FeedbackStatus;
  notes: string; // triage notes, editable from the admin view
  notified: boolean; // whether the Discord notification was delivered
  createdAt: Date;
  updatedAt: Date;
};

const FEEDBACK_COLLECTION = 'feedback';
const COUNTERS_COLLECTION = 'counters';

@Injectable()
export class FeedbackRepository {
  private indexesReady = false;

  constructor(private readonly mongoService: MongoService) {}

  private collection() {
    return this.mongoService.getCollection<FeedbackDoc>(FEEDBACK_COLLECTION);
  }

  private async ensureIndexes(): Promise<void> {
    if (this.indexesReady) return;
    const collection = this.collection();
    await collection.createIndex({ ref: 1 }, { unique: true });
    await collection.createIndex({ createdAt: -1 });
    this.indexesReady = true;
  }

  // Sequential, human-friendly reference numbers (FB-0001, FB-0002, ...).
  async nextRef(): Promise<string> {
    const counters = this.mongoService.getCollection<{
      _id: string;
      seq: number;
    }>(COUNTERS_COLLECTION);
    const doc = await counters.findOneAndUpdate(
      { _id: 'feedback' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    const seq = doc?.seq ?? 1;
    return `FB-${String(seq).padStart(4, '0')}`;
  }

  async insert(doc: FeedbackDoc): Promise<void> {
    await this.ensureIndexes();
    await this.collection().insertOne(doc);
  }

  async setNotified(ref: string, notified: boolean): Promise<void> {
    await this.collection().updateOne({ ref }, { $set: { notified } });
  }

  async list(
    filter: { status?: FeedbackStatus; type?: FeedbackType },
    limit: number,
  ): Promise<FeedbackDoc[]> {
    const query: Filter<FeedbackDoc> = {};
    if (filter.status) query.status = filter.status;
    if (filter.type) query.type = filter.type;
    return this.collection()
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .project<FeedbackDoc>({ _id: 0 })
      .toArray();
  }

  async update(
    ref: string,
    patch: { status?: FeedbackStatus; notes?: string },
  ): Promise<FeedbackDoc | null> {
    const set: { status?: FeedbackStatus; notes?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.notes !== undefined) set.notes = patch.notes;
    const updated = await this.collection().findOneAndUpdate(
      { ref },
      { $set: set },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    return updated;
  }
}

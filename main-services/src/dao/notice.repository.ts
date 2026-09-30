import { Injectable } from '@nestjs/common';
import { MongoService } from 'src/database/mongo.service';

export const NOTICE_LEVELS = ['info', 'warning', 'critical'] as const;
export type NoticeLevel = (typeof NOTICE_LEVELS)[number];

export type NoticeDoc = {
  id: string; // e.g. NTC-0007
  message: string;
  level: NoticeLevel;
  // null start = live as soon as enabled; null end = stays up until switched
  // off manually (no automatic expiry)
  startAt: Date | null;
  endAt: Date | null;
  // the manual on/off switch — independent of the schedule window above.
  // At most one notice is ever enabled at a time (see disableAllEnabled).
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const NOTICE_COLLECTION = 'notices';
const COUNTERS_COLLECTION = 'counters';

@Injectable()
export class NoticeRepository {
  private indexesReady = false;

  constructor(private readonly mongoService: MongoService) {}

  private collection() {
    return this.mongoService.getCollection<NoticeDoc>(NOTICE_COLLECTION);
  }

  private async ensureIndexes(): Promise<void> {
    if (this.indexesReady) return;
    const collection = this.collection();
    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ enabled: 1 });
    await collection.createIndex({ createdAt: -1 });
    this.indexesReady = true;
  }

  async nextId(): Promise<string> {
    const counters = this.mongoService.getCollection<{
      _id: string;
      seq: number;
    }>(COUNTERS_COLLECTION);
    const doc = await counters.findOneAndUpdate(
      { _id: 'notice' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    const seq = doc?.seq ?? 1;
    return `NTC-${String(seq).padStart(4, '0')}`;
  }

  async insert(doc: NoticeDoc): Promise<void> {
    await this.ensureIndexes();
    await this.collection().insertOne(doc);
  }

  // At most one notice is enabled at a time, so overlapping banners can't
  // happen. Call this before enabling a notice (on create, and on update
  // when flipping enabled to true).
  async disableAllEnabled(exceptId?: string): Promise<void> {
    await this.collection().updateMany(
      { enabled: true, ...(exceptId ? { id: { $ne: exceptId } } : {}) },
      { $set: { enabled: false, updatedAt: new Date() } },
    );
  }

  // The single currently-enabled notice, if any. isLive() (in the service)
  // still has to check the schedule window on top of this.
  async findEnabled(): Promise<NoticeDoc | null> {
    return this.collection().findOne(
      { enabled: true },
      { projection: { _id: 0 } },
    );
  }

  async findById(id: string): Promise<NoticeDoc | null> {
    return this.collection().findOne({ id }, { projection: { _id: 0 } });
  }

  async list(limit: number): Promise<NoticeDoc[]> {
    return this.collection()
      .find({}, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  async update(
    id: string,
    patch: Partial<
      Pick<NoticeDoc, 'message' | 'level' | 'startAt' | 'endAt' | 'enabled'>
    >,
  ): Promise<NoticeDoc | null> {
    const updated = await this.collection().findOneAndUpdate(
      { id },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    return updated;
  }
}

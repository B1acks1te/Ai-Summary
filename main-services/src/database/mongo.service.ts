import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Collection, Db, Document, MongoClient } from 'mongodb';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private readonly uri = process.env.MONGODB_URI!;
  private readonly dbName = process.env.MONGODB_DB_NAME!;

  private readonly client = new MongoClient(this.uri);
  private db: Db | null = null;

  async onModuleInit() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.logger.log(`Connected to MongoDB (${this.dbName})`);
  }

  async onModuleDestroy() {
    await this.client.close();
    this.logger.log('MongoDB connection closed');
  }

  // A cheap round trip to the database, used by the /health check.
  async ping(): Promise<void> {
    if (!this.db) {
      throw new Error('MongoDB connection is not initialized');
    }
    await this.db.command({ ping: 1 });
  }

  getCollection<T extends Document>(name: string): Collection<T> {
    if (!this.db) {
      throw new Error('MongoDB connection is not initialized');
    }

    return this.db.collection<T>(name);
  }
}

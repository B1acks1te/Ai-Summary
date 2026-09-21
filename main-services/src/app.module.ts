import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './controllers/app.controller';
import { FeedbackController } from './controllers/feedback.controller';
import { HealthController } from './controllers/health.controller';
import { FeedbackRepository } from './dao/feedback.repository';
import { ScrapeRepository } from './dao/scrape.repository';
import { MongoService } from './database/mongo.service';
import { AiGenerateService } from './services/ai-generate/ai-generate.service';
import { AppService } from './services/app.service';
import { CronTasksService } from './services/cron-tasks/cron-tasks.service';
import { FeedbackService } from './services/feedback/feedback.service';
import { ScrapeService } from './services/scrape/scrape.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      expandVariables: true,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController, FeedbackController, HealthController],
  providers: [
    AppService,
    MongoService,
    ScrapeRepository,
    ScrapeService,
    CronTasksService,
    AiGenerateService,
    FeedbackRepository,
    FeedbackService,
  ],
})
export class AppModule {}

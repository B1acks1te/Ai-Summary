import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { MongoService } from 'src/database/mongo.service';

@Controller('health')
export class HealthController {
  constructor(private readonly mongoService: MongoService) {}

  // Used by Docker's health check, the UI's /api/health, and uptime monitoring.
  // 200 when the service is up and MongoDB answers, 503 otherwise.
  @Get()
  async check() {
    try {
      await this.mongoService.ping();
      return { ok: true, service: 'main-services', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        ok: false,
        service: 'main-services',
        db: 'down',
      });
    }
  }
}

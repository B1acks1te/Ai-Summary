import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FeedbackService } from 'src/services/feedback/feedback.service';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  // Submit feedback (called by the UI's server, never directly by browsers).
  @Post()
  async submit(@Body() body: unknown) {
    return this.feedbackService.submit(body);
  }

  // List feedback — requires the x-admin-key header (FEEDBACK_ADMIN_KEY).
  @Get()
  async list(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.feedbackService.list(adminKey, { status, type, limit });
  }

  // Change a report's status / triage notes — same admin key.
  @Patch(':ref')
  async update(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ) {
    return this.feedbackService.update(adminKey, ref, body);
  }
}

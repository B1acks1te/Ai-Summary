import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { NoticeService } from 'src/services/notice/notice.service';

@Controller('notice')
export class NoticeController {
  constructor(private readonly noticeService: NoticeService) {}

  // Public — no admin key needed. Both pages poll this (and refetch on the
  // NOTICE_UPDATED realtime event) to decide whether to show a banner.
  @Get('current')
  async current() {
    return this.noticeService.current();
  }

  // Everything below requires the x-admin-key header (same key as Feedback).

  @Post()
  async create(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Body() body: unknown,
  ) {
    const b = (body ?? {}) as Record<string, unknown>;
    return this.noticeService.create(adminKey, {
      message: b.message,
      level: b.level,
      startAt: b.startAt,
      endAt: b.endAt,
    });
  }

  @Get()
  async list(@Headers('x-admin-key') adminKey: string | undefined) {
    return this.noticeService.list(adminKey);
  }

  @Patch(':id')
  async update(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = (body ?? {}) as Record<string, unknown>;
    return this.noticeService.update(adminKey, id, {
      message: b.message,
      level: b.level,
      startAt: b.startAt,
      endAt: b.endAt,
      enabled: b.enabled,
    });
  }
}

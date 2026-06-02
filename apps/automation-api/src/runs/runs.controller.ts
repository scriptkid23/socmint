import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { RunRequestDto } from './dto';
import { RunService } from './run.service';

@Controller()
export class RunsController {
  constructor(private readonly runs: RunService) {}

  @Post('profiles/:id/runs')
  execute(@Param('id') id: string, @Body() dto: RunRequestDto) {
    return this.runs.execute(id, { url: dto.url, options: dto.options });
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const record = await this.runs.getRun(id);
    if (!record) throw new NotFoundException(`Run not found: ${id}`);
    return record;
  }
}

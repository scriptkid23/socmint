import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RunRequestDto } from './dto';
import { RunRecordResponseDto } from './run.response';
import { RunService } from './run.service';

@ApiTags('runs')
@Controller()
export class RunsController {
  constructor(private readonly runs: RunService) {}

  @Post('profiles/:id/runs')
  @ApiOperation({ summary: 'Run automation against a URL using a profile' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Profile ID' })
  @ApiCreatedResponse({ type: RunRecordResponseDto })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  @ApiConflictResponse({ description: 'Profile already running' })
  execute(@Param('id') id: string, @Body() dto: RunRequestDto) {
    return this.runs.execute(id, { url: dto.url, options: dto.options });
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get run result by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RunRecordResponseDto })
  @ApiNotFoundResponse({ description: 'Run not found' })
  async getRun(@Param('id') id: string) {
    const record = await this.runs.getRun(id);
    if (!record) throw new NotFoundException(`Run not found: ${id}`);
    return record;
  }
}

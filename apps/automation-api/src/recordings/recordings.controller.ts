import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RecordingRegistry } from './recording.registry';

class RecordingSessionResponseDto {
  sessionId!: string;
  status!: 'recording';
}

class RecordingStatusResponseDto extends RecordingSessionResponseDto {
  steps!: unknown[];
}

class RecordingStopResponseDto {
  steps!: unknown[];
}

@ApiTags('recordings')
@Controller('profiles/:id/recording-session')
export class RecordingsController {
  constructor(private readonly recordings: RecordingRegistry) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Open a browser window and record user interactions' })
  @ApiAcceptedResponse({ type: RecordingSessionResponseDto })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  @ApiConflictResponse({ description: 'Profile already has an active session' })
  start(@Param('id') id: string) {
    return this.recordings.start(id);
  }

  @Get()
  @ApiOperation({ summary: 'Get live recording status and captured steps' })
  @ApiOkResponse({ type: RecordingStatusResponseDto })
  @ApiNotFoundResponse({ description: 'No active recording' })
  status(@Param('id') id: string) {
    const status = this.recordings.getStatus(id);
    if (!status) throw new NotFoundException('No active recording session for this profile');
    return status;
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop recording and return captured steps' })
  @ApiOkResponse({ type: RecordingStopResponseDto })
  stop(@Param('id') id: string) {
    return this.recordings.stop(id);
  }
}

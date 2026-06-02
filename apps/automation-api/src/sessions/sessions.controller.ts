import { Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiConflictResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionRegistry } from './session.registry';

class LoginSessionResponseDto {
  sessionId!: string;
  status!: 'authenticating';
}

@ApiTags('sessions')
@Controller('profiles/:id/login-session')
export class SessionsController {
  constructor(private readonly sessions: SessionRegistry) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Open an interactive login window for a profile' })
  @ApiAcceptedResponse({ type: LoginSessionResponseDto })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  @ApiConflictResponse({ description: 'Profile already has an active session' })
  open(@Param('id') id: string) {
    return this.sessions.open(id);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Force-close the interactive login window' })
  @ApiNoContentResponse()
  async close(@Param('id') id: string) {
    await this.sessions.close(id);
  }
}

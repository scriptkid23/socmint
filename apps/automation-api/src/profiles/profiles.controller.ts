import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CreateProfileDto, UpdateProfileDto } from './dto';
import { ProfileResponseDto } from './profile.response';
import { ProfileService } from './profile.service';

@ApiTags('profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfileService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a browser profile' })
  @ApiCreatedResponse({ type: ProfileResponseDto })
  create(@Body() dto: CreateProfileDto) {
    return this.profiles.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all profiles' })
  @ApiOkResponse({ type: ProfileResponseDto, isArray: true })
  list() {
    return this.profiles.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get profile by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  get(@Param('id') id: string) {
    return this.profiles.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update profile metadata' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  update(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a profile' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Profile deleted' })
  @ApiNotFoundResponse({ description: 'Profile not found' })
  async remove(@Param('id') id: string) {
    await this.profiles.remove(id);
  }
}

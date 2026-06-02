import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RunPageResponseDto {
  @ApiProperty({ example: 'Example Domain' })
  title!: string;

  @ApiProperty({ example: 'https://example.com/' })
  finalUrl!: string;
}

export class RunArtifactsResponseDto {
  @ApiProperty({ nullable: true, example: 'runs/{runId}/screenshot.png' })
  screenshot!: string | null;
}

export class RunRecordResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  profileId!: string;

  @ApiProperty({ example: 'https://example.com' })
  url!: string;

  @ApiProperty({ enum: ['completed', 'failed'], example: 'completed' })
  status!: 'completed' | 'failed';

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ format: 'date-time' })
  finishedAt!: string;

  @ApiProperty({ nullable: true, example: null })
  error!: string | null;

  @ApiProperty({ type: RunPageResponseDto, nullable: true })
  page!: RunPageResponseDto | null;

  @ApiProperty({ type: RunArtifactsResponseDto })
  artifacts!: RunArtifactsResponseDto;
}

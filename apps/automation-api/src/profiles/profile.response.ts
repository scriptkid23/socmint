import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LaunchDefaultsResponseDto {
  @ApiProperty({ example: false })
  headless!: boolean;

  @ApiProperty({ example: false })
  geoip!: boolean;
}

export class ProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'investigator-01' })
  label!: string;

  @ApiProperty({ example: 'profiles/{id}/user-data' })
  userDataDir!: string;

  @ApiProperty({ nullable: true, example: null })
  proxy!: string | null;

  @ApiProperty({ nullable: true, example: null })
  fingerprintSeed!: string | null;

  @ApiProperty({ type: LaunchDefaultsResponseDto })
  launchDefaults!: LaunchDefaultsResponseDto;

  @ApiProperty({ enum: ['idle', 'running'], example: 'idle' })
  status!: 'idle' | 'running';

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

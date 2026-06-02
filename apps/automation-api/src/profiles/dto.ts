import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LaunchDefaultsDto {
  @ApiPropertyOptional({ example: false, description: 'Run browser in headless mode' })
  @IsOptional()
  @IsBoolean()
  headless?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Auto-detect timezone/locale from proxy IP' })
  @IsOptional()
  @IsBoolean()
  geoip?: boolean;
}

export class CreateProfileDto {
  @ApiProperty({ example: 'investigator-01' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiPropertyOptional({ example: 'http://user:pass@proxy:8080', nullable: true })
  @IsOptional()
  @IsString()
  proxy?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  fingerprintSeed?: string | null;

  @ApiPropertyOptional({ type: LaunchDefaultsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LaunchDefaultsDto)
  launchDefaults?: LaunchDefaultsDto;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'investigator-01-renamed' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional({ example: 'http://user:pass@proxy:8080', nullable: true })
  @IsOptional()
  @IsString()
  proxy?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  fingerprintSeed?: string | null;

  @ApiPropertyOptional({ type: LaunchDefaultsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LaunchDefaultsDto)
  launchDefaults?: LaunchDefaultsDto;
}

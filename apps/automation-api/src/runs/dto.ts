import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RunOptionsDto {
  @ApiPropertyOptional({ example: true, description: 'Save full-page screenshot to run artifacts' })
  @IsOptional()
  @IsBoolean()
  screenshot?: boolean;

  @ApiPropertyOptional({
    enum: ['load', 'domcontentloaded', 'commit'],
    example: 'load',
  })
  @IsOptional()
  @IsIn(['load', 'domcontentloaded', 'commit'])
  waitUntil?: 'load' | 'domcontentloaded' | 'commit';

  @ApiPropertyOptional({ example: 60000, minimum: 1000, maximum: 120000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;
}

export class RunRequestDto {
  @ApiProperty({ example: 'https://example.com' })
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url!: string;

  @ApiPropertyOptional({ type: RunOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RunOptionsDto)
  options?: RunOptionsDto;
}

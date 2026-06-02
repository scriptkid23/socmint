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

export class RunOptionsDto {
  @IsOptional()
  @IsBoolean()
  screenshot?: boolean;

  @IsOptional()
  @IsIn(['load', 'domcontentloaded', 'commit'])
  waitUntil?: 'load' | 'domcontentloaded' | 'commit';

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;
}

export class RunRequestDto {
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RunOptionsDto)
  options?: RunOptionsDto;
}

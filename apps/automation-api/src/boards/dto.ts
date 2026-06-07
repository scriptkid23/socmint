import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BoardGraph } from './board.types';

export class CreateBoardDto {
  @ApiProperty({ example: 'Warm-up board' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class UpdateBoardDto {
  @ApiPropertyOptional({ example: 'Renamed board' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'React Flow graph (nodes + edges), stored verbatim.',
    example: { nodes: [], edges: [] },
  })
  @IsOptional()
  @IsObject()
  graph?: BoardGraph;
}

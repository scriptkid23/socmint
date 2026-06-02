import { ApiProperty } from '@nestjs/swagger';

export class BoardResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Warm-up board' })
  name!: string;

  @ApiProperty({
    description: 'React Flow graph (nodes + edges).',
    example: { nodes: [], edges: [] },
  })
  graph!: { nodes: unknown[]; edges: unknown[] };

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class BoardRunResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  boardId!: string;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ format: 'date-time' })
  finishedAt!: string;

  @ApiProperty({ isArray: true, description: 'One FlowRunRecord per profile.' })
  runs!: unknown[];
}

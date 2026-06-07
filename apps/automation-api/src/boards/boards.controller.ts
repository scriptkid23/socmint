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
import { BoardService } from './board.service';
import { CreateBoardDto, UpdateBoardDto } from './dto';
import { BoardResponseDto, BoardRunResponseDto } from './board.response';

@ApiTags('boards')
@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an automation board' })
  @ApiCreatedResponse({ type: BoardResponseDto })
  create(@Body() dto: CreateBoardDto) {
    return this.boards.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all boards' })
  @ApiOkResponse({ type: BoardResponseDto, isArray: true })
  list() {
    return this.boards.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a board by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BoardResponseDto })
  @ApiNotFoundResponse({ description: 'Board not found' })
  get(@Param('id') id: string) {
    return this.boards.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a board name and/or graph' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: BoardResponseDto })
  @ApiNotFoundResponse({ description: 'Board not found' })
  update(@Param('id') id: string, @Body() dto: UpdateBoardDto) {
    return this.boards.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a board' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Board deleted' })
  @ApiNotFoundResponse({ description: 'Board not found' })
  async remove(@Param('id') id: string) {
    await this.boards.remove(id);
  }

  @Post(':id/run')
  @HttpCode(201)
  @ApiOperation({ summary: 'Run a board: execute each profile chain in parallel' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: BoardRunResponseDto })
  @ApiNotFoundResponse({ description: 'Board or profile not found' })
  run(@Param('id') id: string) {
    return this.boards.run(id);
  }
}

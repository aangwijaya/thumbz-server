import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminIdParamsDto } from '../admin/dto/admin-id-params.dto';
import { MatchIdParamsDto } from '../matches/dto/match-id-params.dto';
import { CommentsService, MatchComment } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsDto } from './dto/list-comments.dto';

@Controller('matches')
export class MatchCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Public()
  @Get(':id/comments')
  list(
    @Param() params: MatchIdParamsDto,
    @Query() query: ListCommentsDto,
  ): Promise<{
    data: MatchComment[];
    meta: { next_cursor: string | null; total: number };
  }> {
    return this.comments.list(params.id, query);
  }

  @Post(':id/comments')
  create(
    @Param() params: MatchIdParamsDto,
    @CurrentUser() user: { sub: string; name?: string },
    @Body() body: CreateCommentDto,
  ): Promise<{ data: MatchComment }> {
    return this.comments.create(params.id, user, body);
  }
}

@Controller('me/comments')
export class MyCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async removeOwn(
    @Param() params: AdminIdParamsDto,
    @CurrentUser() user: { sub: string },
  ): Promise<void> {
    await this.comments.removeOwn(user.sub, params.id);
  }
}

@Controller('admin/comments')
export class AdminCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async removeAny(@Param() params: AdminIdParamsDto): Promise<void> {
    await this.comments.removeAny(params.id);
  }
}

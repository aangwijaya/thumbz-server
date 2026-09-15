import { Module } from '@nestjs/common';
import {
  AdminCommentsController,
  MatchCommentsController,
  MyCommentsController,
} from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  controllers: [
    MatchCommentsController,
    MyCommentsController,
    AdminCommentsController,
  ],
  providers: [CommentsService],
})
export class CommentsModule {}

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { bearerToken } from '../../common/auth/jwt-verifier.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PlaybackService, PlaybackSession } from './playback.service';

class CreateSessionDto {
  @IsUUID()
  asset_id: string;
}

class SessionParams {
  @IsUUID()
  sid: string;
}

class VariantQuery {
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_/-]+\.m3u8$/)
  path: string;

  @IsString()
  @MaxLength(2000)
  token: string;
}

class TokenQuery {
  @IsString()
  @MaxLength(2000)
  token: string;
}

const HLS = 'application/vnd.apple.mpegurl';

@ApiTags('playback')
@Controller()
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}

  /** Signed-in viewers open a session for a protected asset. */
  @ApiBearerAuth()
  @Post('playback/sessions')
  createSession(
    @CurrentUser() user: CurrentUser,
    @Body() body: CreateSessionDto,
  ): Promise<{ data: PlaybackSession }> {
    return this.playback
      .createSession(user.sub, body.asset_id)
      .then((data) => ({ data }));
  }

  @ApiBearerAuth()
  @Post('playback/sessions/:sid/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @CurrentUser() user: CurrentUser,
    @Param() params: SessionParams,
  ): Promise<{ data: { token: string; expires_at: string } }> {
    return this.playback
      .heartbeat(user.sub, params.sid)
      .then((data) => ({ data }));
  }

  @ApiBearerAuth()
  @Delete('playback/sessions/:sid')
  @HttpCode(HttpStatus.NO_CONTENT)
  async end(
    @CurrentUser() user: CurrentUser,
    @Param() params: SessionParams,
  ): Promise<void> {
    await this.playback.end(user.sub, params.sid);
  }

  /** EME ClearKey license; the playback token travels as a Bearer header. */
  @Public()
  @Post('drm/clearkey/license')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  license(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { kids?: unknown },
  ) {
    return this.playback.clearKeyLicense(
      bearerToken(authorization) ?? undefined,
      body,
    );
  }

  /** Safari's native player cannot send headers, so HLS URLs carry the token. */
  @Public()
  @Get('playback/:sid/hls/master.m3u8')
  @Header('Content-Type', HLS)
  @Header('Cache-Control', 'private, no-store')
  hlsMaster(
    @Param() params: SessionParams,
    @Query() query: TokenQuery,
  ): Promise<string> {
    return this.playback.hlsMaster(params.sid, query.token);
  }

  @Public()
  @Get('playback/:sid/hls/variant')
  @Header('Content-Type', HLS)
  @Header('Cache-Control', 'private, no-store')
  hlsVariant(
    @Param() params: SessionParams,
    @Query() query: VariantQuery,
  ): Promise<string> {
    return this.playback.hlsVariant(params.sid, query.path, query.token);
  }

  @Public()
  @Get('drm/hls/key')
  async hlsKey(
    @Query() query: TokenQuery,
    @Res() response: Response,
  ): Promise<void> {
    const key = await this.playback.hlsKey(query.token);
    response
      .status(200)
      .setHeader('Content-Type', 'application/octet-stream')
      .setHeader('Cache-Control', 'private, no-store')
      .end(key);
  }

  /** Callback for commercial DRM license services (token in the body). */
  @Public()
  @Post('drm/authorize')
  @HttpCode(HttpStatus.OK)
  authorize(@Body() body: TokenQuery) {
    return this.playback.authorize(body.token).then((data) => ({ data }));
  }
}

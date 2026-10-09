import { Module } from '@nestjs/common';
import { KeyVault } from './key-vault';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';

@Module({
  controllers: [PlaybackController],
  providers: [PlaybackService, KeyVault],
  exports: [KeyVault],
})
export class MediaModule {}

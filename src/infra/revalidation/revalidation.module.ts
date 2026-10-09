import { Module } from '@nestjs/common';
import { FrontendRevalidationListener } from './frontend-revalidation.listener';

@Module({ providers: [FrontendRevalidationListener] })
export class RevalidationModule {}

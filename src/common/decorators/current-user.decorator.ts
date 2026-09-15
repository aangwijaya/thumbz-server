import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUser {
  sub: string;
  name?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUser | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: CurrentUser }>();
    return request?.user;
  },
);

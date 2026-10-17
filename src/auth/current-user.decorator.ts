import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator<unknown, unknown>(
  (_data: unknown, context: ExecutionContext): unknown => {
    const request = context.switchToHttp().getRequest<{ user?: unknown }>();

    return request.user;
  },
);

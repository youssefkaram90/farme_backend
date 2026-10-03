import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { ERROR_MESSAGES, duplicateMessage } from '../error-messages';

/**
 * Single place that turns EVERY exception into a response a non-technical user
 * can read.
 *
 * - HttpException -> passed through unchanged (services already throw
 *                    human-readable messages); `message` is normalised to a
 *                    single string because class-validator emits string[]
 * - Prisma errors -> mapped to 400 / 404 / 409 with friendly wording
 * - anything else -> 500 with a safe generic message; the real error is logged
 *                    server-side only and never leaked to the client
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, message, code } = this.resolve(exception);

    // 500+ → log the full exception server-side (never sent to the client).
    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status}${
          code ? ` (${code})` : ''
        }`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status] ?? 'Error',
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }

  private resolve(exception: unknown): {
    status: number;
    message: string;
    code?: string;
  } {
    // 1) Existing Nest exceptions keep their own status and wording.
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const raw =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>).message ?? exception.message);

      return { status: exception.getStatus(), message: this.toText(raw) };
    }

    // 2) Prisma known request errors (unique / FK / missing record / ...).
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    // 3) Prisma validation errors (bad query shape / bad enum value).
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: ERROR_MESSAGES.invalidData,
      };
    }

    // 4) Unknown failure — friendly message, real cause only in the log.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: ERROR_MESSAGES.unexpected,
    };
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    code: string;
  } {
    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: duplicateMessage(
            this.uniqueFields(e).join(' + '),
            this.modelName(e),
          ),
          code: e.code,
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: ERROR_MESSAGES.badReference,
          code: e.code,
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: ERROR_MESSAGES.alreadyDeleted,
          code: e.code,
        };
      // Input Prisma rejected outright: P2000 value too long, P2011 null in a
      // column that cannot be null, P2012 a required value missing, P2014 the
      // relation is violated, P2023 a column value is inconsistent. All of them
      // are the caller's data, not our fault, so they are 400 and never 500.
      case 'P2000':
      case 'P2011':
      case 'P2012':
      case 'P2014':
      case 'P2023':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: ERROR_MESSAGES.invalidData,
          code: e.code,
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: ERROR_MESSAGES.unexpected,
          code: e.code,
        };
    }
  }

  /**
   * Field list of the violated unique constraint.
   *
   * With the driver adapters (Prisma 7 + @prisma/adapter-pg) the fields live
   * under `meta.driverAdapterError.cause.constraint.fields`. The classic
   * engine puts them in `meta.target` — both shapes are supported.
   */
  private uniqueFields(e: Prisma.PrismaClientKnownRequestError): string[] {
    const meta = e.meta as
      | {
          target?: unknown;
          driverAdapterError?: {
            cause?: { constraint?: { fields?: unknown } };
          };
        }
      | undefined;

    const adapterFields = meta?.driverAdapterError?.cause?.constraint?.fields;
    if (Array.isArray(adapterFields)) {
      return adapterFields.filter((f): f is string => typeof f === 'string');
    }

    const target = meta?.target;
    if (Array.isArray(target)) {
      return target.filter((f): f is string => typeof f === 'string');
    }
    if (typeof target === 'string') return [target];

    return [];
  }

  private modelName(
    e: Prisma.PrismaClientKnownRequestError,
  ): string | undefined {
    const meta = e.meta as { modelName?: unknown } | undefined;
    return typeof meta?.modelName === 'string' ? meta.modelName : undefined;
  }

  /** class-validator/Nest emit string[] — clients need one readable string. */
  private toText(raw: unknown): string {
    if (Array.isArray(raw)) {
      const joined = raw
        .filter((v): v is string => typeof v === 'string')
        .join('; ');
      return joined || ERROR_MESSAGES.invalidData;
    }
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && 'message' in raw) {
      return this.toText(raw.message);
    }
    return ERROR_MESSAGES.unexpected;
  }
}

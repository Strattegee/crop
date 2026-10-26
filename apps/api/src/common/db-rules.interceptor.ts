import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';

/** Error codes raised by database rules whose message is already plain English for the person. */
const RULE_CODES = new Set(['CRLK1']);

/**
 * Turns a business rule refused inside the database (for example a change to a published roster that the
 * business has locked, migration 0024) into a 409 with the database's message, wherever it is raised.
 */
@Injectable()
export class DbRulesInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((err: unknown) => {
      const e = err as { code?: string; message?: string };
      if (e && typeof e.code === 'string' && RULE_CODES.has(e.code)) return throwError(() => new ConflictException(e.message));
      return throwError(() => err);
    }));
  }
}

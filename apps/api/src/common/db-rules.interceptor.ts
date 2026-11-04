import { CallHandler, ConflictException, ExecutionContext, ForbiddenException, Injectable, NestInterceptor, NotFoundException } from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';

/**
 * Error codes raised by database rules whose message is already plain English for the person:
 * CRLK1 a locked published roster (0024), CRAG1 an agency link rule (0038), CRPJ1 a project rule (0084: team or equipment dates overlap). CRAG2 is "not found" (404).
 */
const RULE_CODES = new Set(['CRLK1', 'CRAG1', 'CRPJ1']);
const NOT_FOUND_CODES = new Set(['CRAG2']);

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
      // A row another site's (migration 0086's site policies) or a supervisor's out-of-bounds change: plain 403.
      if (e && e.code === '42501' && /row-level security/.test(e.message ?? '')) {
        return throwError(() => new ForbiddenException("That {site} isn't one of yours, so you can't change it"));
      }
      if (e && typeof e.code === 'string' && NOT_FOUND_CODES.has(e.code)) return throwError(() => new NotFoundException(e.message));
      return throwError(() => err);
    }));
  }
}

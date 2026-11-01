import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { withTenant } from '@crop/db';
import type { Pool } from 'pg';
import { catchError, from, Observable, switchMap, throwError } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.types.js';
import { APP_POOL } from '../database/database.module.js';
import { DEFAULT_WORDS, fillWords, hasWordTokens, wordsFor, type Words } from './words.js';

/**
 * API error messages are shown to people, so they use the business's words: a message written with tokens,
 * e.g. `'This {shift} is cancelled'`, reaches a café that says Jobs as "This job is cancelled".
 * The business's words are loaded only when an error has tokens; without a business (public links), or if
 * loading fails, CROP's own words are used. Registered first, so it also sees what `DbRulesInterceptor` makes.
 */
@Injectable()
export class WordsInErrorsInterceptor implements NestInterceptor {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(catchError((err: unknown) => {
      if (!(err instanceof HttpException)) return throwError(() => err);
      const body = err.getResponse();
      const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      const texts = Array.isArray(message) ? message : [message];
      if (!texts.some(t => typeof t === 'string' && hasWordTokens(t))) return throwError(() => err);
      const tenantId = ctx.getType() === 'http' ? ctx.switchToHttp().getRequest<AuthedRequest>().auth?.tenant?.tenantId : undefined;
      return from(this.words(tenantId)).pipe(switchMap(w => {
        const fill = (t: unknown) => (typeof t === 'string' ? fillWords(t, w) : t);
        const filled = typeof body === 'string' ? fill(body) : { ...(body as object), message: Array.isArray(message) ? message.map(fill) : fill(message) };
        return throwError(() => new HttpException(filled as string | Record<string, unknown>, err.getStatus(), { cause: err }));
      }));
    }));
  }

  private async words(tenantId: string | undefined): Promise<Words> {
    if (!tenantId) return DEFAULT_WORDS;
    try { return await withTenant(this.pool, tenantId, wordsFor); } catch { return DEFAULT_WORDS; }
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG } from './app-config.provider';
import { AppConfig } from './config';

/**
 * CSRF protection for state-changing endpoints. HTML forms can only send
 * form-encoded or text/plain bodies, and a cross-origin fetch with
 * Content-Type: application/json needs a CORS preflight that only corsOrigin
 * passes.
 */
@Injectable()
export class JsonRequestGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const mediaType = (req.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      throw new UnsupportedMediaTypeException(
        'Content-Type must be application/json',
      );
    }

    const origin = req.headers.origin;
    if (origin && !this.isAllowedOrigin(origin, req.headers.host)) {
      throw new ForbiddenException(`Origin ${origin} is not allowed`);
    }
    return true;
  }

  private isAllowedOrigin(origin: string, host: string | undefined): boolean {
    if (origin === this.config.corsOrigin) return true;
    try {
      // The bundled UI is same-origin, but may be opened via any LAN hostname.
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
}

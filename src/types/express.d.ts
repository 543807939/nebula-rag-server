import { JwtPayload } from '../auth/types/jwt-payload.ts';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: JwtPayload;
    }
  }
}

export {};

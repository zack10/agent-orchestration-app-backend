import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { AppError } from '../errors/AppError';

export const validate = (schema: AnyZodObject) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
        headers: req.headers,
      });
      // Use the parsed values so unknown keys are stripped and defaults apply.
      if ('body' in parsed) req.body = parsed.body;
      if ('params' in parsed) req.params = parsed.params;
      if ('query' in parsed) req.query = parsed.query;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        throw AppError.badRequest('Validation failed', details);
      }
      next(err);
    }
  };
};

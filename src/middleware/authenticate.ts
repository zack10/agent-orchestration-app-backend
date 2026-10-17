import { RequestHandler } from "express";
import crypto from "node:crypto";
import { config } from "../config";
import { AppError } from "../errors/AppError";

const safelyEqual = (actual: string, expected: string): boolean => {
  const actualHash = crypto.createHash("sha256").update(actual).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
};

export const authenticate: RequestHandler = (req, _res, next) => {
  if (config.authDisabled && config.nodeEnv !== "production") {
    next();
    return;
  }
  if (!config.apiAuthToken) {
    next(
      AppError.unauthorized(
        "API_AUTH_TOKEN is not configured; set it or AUTH_DISABLED=true for local development",
      ),
    );
    return;
  }

  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (
    !token ||
    !config.apiAuthToken ||
    !safelyEqual(token, config.apiAuthToken)
  ) {
    next(AppError.unauthorized());
    return;
  }
  next();
};

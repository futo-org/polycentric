import { base64DecodeString, base64EncodeString } from '@polycentric/js-core';
import axios, { type AxiosInstance } from 'axios';
import bodyParser from 'body-parser';
import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CookieJar, MemoryCookieStore } from 'tough-cookie';
import { Result } from './result.js';

const binaryParser = bodyParser.raw({ type: 'application/octet-stream' });
const jsonParser = bodyParser.json();

export function createCookieEnabledAxios(): AxiosInstance {
  const cookieJar = new CookieJar(new MemoryCookieStore());

  const instance = axios.create({
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US',
    },
  });

  instance.interceptors.request.use((config) => {
    config.headers['Cookie'] = cookieJar.getCookieStringSync(config.url!);
    return config;
  });

  instance.interceptors.response.use(
    (response) => {
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        cookies.forEach((cookie: string) => {
          cookieJar.setCookieSync(cookie, response.config.url!);
        });
      }

      return response;
    },
    (error) => {
      return error;
    },
  );

  return instance;
}

export function encodeObject<T>(token: T): string {
  return encodeURIComponent(base64EncodeString(JSON.stringify(token)));
}

export function decodeObject<T>(base64String: string): T {
  const jsonString = base64DecodeString(base64String);
  if (jsonString === undefined) {
    throw new SyntaxError('Invalid base64 encoding');
  }
  return JSON.parse(jsonString) as T;
}

export async function writeResult<T>(
  res: Response,
  result: Result<T>,
): Promise<void> {
  if (result.success) {
    // `Result<void>` (e.g. healthCheck) has no value; reading `.value` would
    // throw, so fall back to a simple success body.
    res
      .status(StatusCodes.OK)
      .json(result.valueOrUndefined ?? { success: true });
  } else {
    res
      .status(result.error.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR)
      .json({
        message: result.error.message,
        extendedMessage: result.error.extendedMessage,
      });
  }
}

export function handleBinaryOrJson(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const contentType = req.headers['content-type'];
  if (contentType === 'application/octet-stream') {
    binaryParser(req, res, next);
  } else if (contentType === 'application/json') {
    jsonParser(req, res, next);
  } else {
    console.info('requestVerify(400): Invalid Content-Type.', contentType);
    res.status(StatusCodes.BAD_REQUEST).send('Invalid Content-Type');
  }
}

export function httpResponseToError<T>(
  code: number,
  data: string,
  endpointName: string,
): Result<T> {
  switch (code) {
    case StatusCodes.INTERNAL_SERVER_ERROR: {
      return Result.err({
        message:
          'Verifier encountered an error getting your profile information',
        extendedMessage:
          'An error was encountered while getting the OAuth Token and Username',
      });
    }

    default: {
      return Result.err({
        message: 'Verifier was unable to validate your login information',
        extendedMessage: `Returned ${code} on ${endpointName} endpoint with content: ${data}`,
      });
    }
  }
}

/** URL-safe slug for a schema name, used in route paths and the callback URL. */
export function slug(schemaName: string): string {
  return schemaName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function getCallbackForPlatform(schemaName: string, uriEncode = false) {
  const url = `${process.env.POLYCENTRIC_VERIFIER_BOT_OAUTH_CALLBACK_DOMAIN}/platforms/${slug(
    schemaName,
  )}/oauth/callback`;
  return uriEncode ? encodeURIComponent(url) : url;
}

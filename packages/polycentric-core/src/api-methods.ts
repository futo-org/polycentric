import * as Base64 from '@borderless/base64';
import fetch, { Headers } from 'cross-fetch';
import Long from 'long';
import * as Models from './models';
import * as Protocol from './protocol';
import * as Version from './version';

async function checkResponse(name: string, response: Response): Promise<void> {
  if (!response.ok) {
    console.warn(name, response.status, await response.text());
    throw new Error(name + ' !ok');
  }
}

function encodeModerationLevels(
  moderationLevels: Record<string, number>,
): string {
  return JSON.stringify(
    Object.entries(moderationLevels).map(([key, value]) => ({
      name: key,
      max_level: value,
      strict_mode: false,
    })),
  );
}

const userAgent = 'polycentric-core-' + Version.SHA.substring(0, 8);

export async function postEvents(
  server: string,
  events: Models.SignedEvent.SignedEvent[],
): Promise<void> {
  const response = await fetch(server + '/events', {
    method: 'POST',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
    body: Protocol.Events.encode({
      events: events,
    }).finish(),
  });

  await checkResponse('postEvents', response);
}

export async function postCensor(
  server: string,
  censorshipType: string,
  urlInfo: string,
  authorization: string,
): Promise<void> {
  const response = await fetch(
    `${server}/censor?censorship_type=${censorshipType}`,
    {
      method: 'POST',
      headers: new Headers({
        authorization: authorization,
        'x-polycentric-user-agent': userAgent,
      }),
      body: urlInfo,
    },
  );

  await checkResponse('postCensor', response);
}

export async function getRanges(
  server: string,
  system: Models.PublicKey.PublicKey,
): Promise<Models.Ranges.RangesForSystem> {
  const systemQuery = Base64.encodeUrl(
    Protocol.PublicKey.encode(system).finish(),
  );

  const path = `/ranges?system=${systemQuery}`;

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getRanges', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.Ranges.rangesForSystemFromBuffer(rawBody);
}

export type GetEventsType = (
  server: string,
  system: Models.PublicKey.PublicKey,
  ranges: Models.Ranges.RangesForSystem,
  moderationLevels?: Record<string, number>,
) => Promise<Models.Events.Type>;

export const getEvents: GetEventsType = async (
  server: string,
  system: Models.PublicKey.PublicKey,
  ranges: Models.Ranges.RangesForSystem,
  moderationLevels?: Record<string, number>,
): Promise<Models.Events.Type> => {
  const systemQuery = Base64.encodeUrl(
    Protocol.PublicKey.encode(system).finish(),
  );

  const rangesQuery = Base64.encodeUrl(
    Protocol.RangesForSystem.encode(ranges).finish(),
  );

  let path = `/events?system=${systemQuery}&ranges=${rangesQuery}`;

  if (moderationLevels !== undefined) {
    const moderationLevelsQuery = encodeModerationLevels(moderationLevels);
    path += `&moderation_filters=${moderationLevelsQuery}`;
  }

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getEvents', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.Events.fromBuffer(rawBody);
};

export async function getResolveClaim(
  server: string,
  trustRoot: Models.PublicKey.PublicKey,
  claimType: Models.ClaimType.ClaimType,
  matchAnyField: string,
): Promise<Models.QueryClaimToSystemResponse.ResponseType> {
  const query = Base64.encodeUrl(
    Protocol.QueryClaimToSystemRequest.encode({
      claimType: claimType,
      trustRoot: trustRoot,
      matchAnyField: matchAnyField,
    }).finish(),
  );

  const path = `/resolve_claim?query=${query}`;

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getResolveClaim', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.QueryClaimToSystemResponse.responseTypeFromBuffer(rawBody);
}

export type GetQueryLatestType = (
  server: string,
  system: Models.PublicKey.PublicKey,
  eventTypes: Models.ContentType.ContentType[],
) => Promise<Models.Events.Type>;

export const getQueryLatest: GetQueryLatestType = async (
  server: string,
  system: Models.PublicKey.PublicKey,
  eventTypes: Models.ContentType.ContentType[],
): Promise<Models.Events.Type> => {
  const systemQuery = Base64.encodeUrl(
    Protocol.PublicKey.encode(system).finish(),
  );

  const eventTypesQuery = Base64.encodeUrl(
    Protocol.RepeatedUInt64.encode({
      numbers: eventTypes,
    }).finish(),
  );

  const path =
    `/query_latest?system=${systemQuery}` + `&event_types=${eventTypesQuery}`;

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getQueryLatest', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.Events.fromBuffer(rawBody);
};

export async function getQueryIndex(
  server: string,
  system: Models.PublicKey.PublicKey,
  contentType: Models.ContentType.ContentType,
  after?: Long,
  limit?: Long,
): Promise<Models.QueryIndexResponse.Type> {
  const systemQuery = Base64.encodeUrl(
    Protocol.PublicKey.encode(system).finish(),
  );

  const path =
    `/query_index?system=${systemQuery}` +
    `&content_type=${contentType.toString()}` +
    (after ? `&after=${after.toString()}` : '') +
    (limit ? `&limit=${limit.toString()}` : '');

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getQueryIndex', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.QueryIndexResponse.fromBuffer(rawBody);
}

export async function getQueryReferences(
  server: string,
  reference: Protocol.Reference,
  cursor?: Uint8Array,
  requestEvents?: Protocol.QueryReferencesRequestEvents,
  countLwwElementReferences?: Protocol.QueryReferencesRequestCountLWWElementReferences[],
  countReferences?: Protocol.QueryReferencesRequestCountReferences[],
  extraByteReferences?: Uint8Array[],
  moderationLevels?: Record<string, number>,
): Promise<Protocol.QueryReferencesResponse> {
  const query: Protocol.QueryReferencesRequest = {
    reference: reference,
    cursor: cursor,
    requestEvents: requestEvents,
    countLwwElementReferences: countLwwElementReferences ?? [],
    countReferences: countReferences ?? [],
    extraByteReferences: extraByteReferences ?? [],
  };

  const encodedQuery = Base64.encodeUrl(
    Protocol.QueryReferencesRequest.encode(query).finish(),
  );

  let path = `/query_references?query=${encodedQuery}`;

  if (moderationLevels !== undefined) {
    path += `&moderation_filters=${encodeModerationLevels(moderationLevels)}`;
  }

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getQueryReferences', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Protocol.QueryReferencesResponse.decode(rawBody);
}

export enum SearchType {
  Messages = 'messages',
  Profiles = 'profiles',
}

export async function getSearch(
  server: string,
  searchQuery: string,
  limit?: number,
  cursor?: Uint8Array,
  searchType?: SearchType,
  moderationLevels?: Record<string, number>,
): Promise<Models.ResultEventsAndRelatedEventsAndCursor.Type> {
  let path = `/search?search=${encodeURIComponent(searchQuery)}`;

  if (cursor !== undefined) {
    path += `&cursor=${Base64.encodeUrl(cursor)}`;
  }

  if (limit !== undefined) {
    path += `&limit=${limit.toString()}`;
  }

  if (searchType !== undefined) {
    path += `&search_type=${searchType}`;
  }

  if (moderationLevels !== undefined) {
    path += `&moderation_filters=${encodeModerationLevels(moderationLevels)}`;
  }

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getSearch', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.ResultEventsAndRelatedEventsAndCursor.fromBuffer(rawBody);
}

export type TopStringReferenceTimeRange = '12h' | '1d' | '7d' | '30d';

export async function getTopStringReferences(
  server: string,
  options: {
    query?: string;
    timeRange?: TopStringReferenceTimeRange;
    limit?: number;
  },
): Promise<Models.ResultTopStringReferences.Type> {
  let path = '/top_string_references?';

  const params = new URLSearchParams();

  if (options.query !== undefined) {
    params.append('query', options.query);
  }

  if (options.limit !== undefined) {
    params.append('limit', options.limit.toString());
  }

  if (options.timeRange !== undefined) {
    params.append('time_range', options.timeRange);
  }

  path += params.toString();

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getTopStringReferences', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.ResultTopStringReferences.fromBuffer(rawBody);
}

export async function getHead(
  server: string,
  system: Models.PublicKey.PublicKey,
): Promise<Models.Events.Type> {
  const systemQuery = Base64.encodeUrl(
    Protocol.PublicKey.encode(system).finish(),
  );

  const path = `/head?system=${systemQuery}`;

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getHead', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.Events.fromBuffer(rawBody);
}

export async function getExplore(
  server: string,
  limit?: number,
  cursor?: Uint8Array,
  moderationLevels?: Record<string, number>,
): Promise<Models.ResultEventsAndRelatedEventsAndCursor.Type> {
  let path = '/explore?';

  const params = new URLSearchParams();

  if (cursor !== undefined) {
    params.append('cursor', Base64.encodeUrl(cursor));
  }

  if (limit !== undefined) {
    params.append('limit', limit.toString());
  }

  if (moderationLevels !== undefined) {
    params.append(
      'moderation_filters',
      encodeModerationLevels(moderationLevels),
    );
  }

  path += params.toString();

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getExplore', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.ResultEventsAndRelatedEventsAndCursor.fromBuffer(rawBody);
}

export async function getFindClaimAndVouch(
  server: string,
  vouching_system: Models.PublicKey.PublicKey,
  claiming_system: Models.PublicKey.PublicKey,
  fields: Protocol.ClaimFieldEntry[],
  claimType: Models.ClaimType.ClaimType,
): Promise<Models.FindClaimAndVouchResponse.Type | undefined> {
  const query: Protocol.FindClaimAndVouchRequest = {
    vouchingSystem: vouching_system,
    claimingSystem: claiming_system,
    fields: fields,
    claimType: claimType,
  };

  const encodedQuery = Base64.encodeUrl(
    Protocol.FindClaimAndVouchRequest.encode(query).finish(),
  );

  const path = `/find_claim_and_vouch?query=${encodedQuery}`;

  const response = await fetch(server + path, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  if (response.status === 404) {
    return undefined;
  }

  await checkResponse('getFindClaimAndVouch', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.FindClaimAndVouchResponse.fromBuffer(rawBody);
}

export async function getChallenge(
  server: string,
): Promise<Protocol.HarborChallengeResponse> {
  const response = await fetch(server + '/challenge', {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getChallenge', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Protocol.HarborChallengeResponse.decode(rawBody);
}

export async function postPurge(
  server: string,
  solvedChallenge: Protocol.HarborValidateRequest,
): Promise<void> {
  const response = await fetch(server + '/purge', {
    method: 'POST',
    body: Protocol.HarborValidateRequest.encode(solvedChallenge).finish(),
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('postPurge', response);
}

export async function postClaimHandle(
  server: string,
  claimRequest: Protocol.ClaimHandleRequest,
): Promise<void> {
  const response = await fetch(server + '/claim_handle', {
    method: 'POST',
    headers: new Headers({
      'content-type': 'application/octet-stream',
      'x-polycentric-user-agent': userAgent,
    }),
    body: Protocol.ClaimHandleRequest.encode(claimRequest).finish(),
  });

  await checkResponse('postClaimHandle', response);
}

export async function getResolveHandle(
  server: string,
  handle: string,
): Promise<Models.PublicKey.PublicKey> {
  const response = await fetch(server + `/resolve_handle?handle=${handle}`, {
    method: 'GET',
    headers: new Headers({
      'content-type': 'application/octet-stream',
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getResolveHandle', response);

  const rawBody = new Uint8Array(await response.arrayBuffer());

  return Models.PublicKey.fromProto(Protocol.PublicKey.decode(rawBody));
}

export const VERIFIER_SERVER =
  // Check if we're in a browser environment
  typeof window !== 'undefined'
    ? window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
      ? 'https://localhost:3002' // Local development
      : 'https://verifiers.polycentric.io' // Production
    : process.env.NEXT_PUBLIC_VERIFIER_SERVER ??
      'https://verifiers.polycentric.io';

export async function requestVerification(
  pointer: Protocol.Pointer,
  claimType: Models.ClaimType.ClaimType,
  challengeResponse?: string,
): Promise<void> {
  const verifierType = challengeResponse ? 'oauth' : 'text';

  let url = `${VERIFIER_SERVER}/platforms/${claimType.toString()}/${verifierType}/vouch`;

  if (challengeResponse) {
    url += `?challengeResponse=${encodeURIComponent(challengeResponse)}`;
  }

  try {
    const encodedPointer = Protocol.Pointer.encode(pointer).finish();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-polycentric-user-agent': userAgent,
        Origin: window.location.origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'content-type,x-polycentric-user-agent',
      },
      body: encodedPointer,
      credentials: 'include',
      mode: 'cors',
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Error response body:', text);
      throw new Error(`Verification failed: ${text}`);
    }

    await checkResponse('requestVerification', response);
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      console.error('CORS or network error:', {
        error,
        url,
        origin: window.location.origin,
      });
    }
    throw error;
  }
}

export interface OAuthUsernameResponse {
  username: string;
  token: string;
}

interface OAuthURLResponse {
  url: string;
}

export async function getOAuthURL(
  server: string,
  claimType: Models.ClaimType.ClaimType,
  redirectUri?: string,
): Promise<string> {
  let url = `${server}/platforms/${claimType.toString()}/oauth/url`;

  if (redirectUri) {
    url += `?redirectUri=${encodeURIComponent(redirectUri)}`;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
    credentials: 'include',
    mode: 'cors',
  });

  await checkResponse('getOAuthURL', response);
  const data = (await response.json()) as string | OAuthURLResponse;

  return typeof data === 'string' ? data : data.url;
}

export async function getOAuthUsername(
  server: string,
  token: string,
  claimType: Models.ClaimType.ClaimType,
): Promise<OAuthUsernameResponse> {
  const url = `${server}/platforms/${claimType.toString()}/oauth/token${
    token.startsWith('?') ? token : `?${token}`
  }`;

  const response = await fetch(url, {
    method: 'GET',
    headers: new Headers({
      'x-polycentric-user-agent': userAgent,
    }),
  });

  await checkResponse('getOAuthUsername', response);
  return response.json() as Promise<OAuthUsernameResponse>;
}

export async function getClaimFieldsByUrl(
  server: string,
  claimType: Models.ClaimType.ClaimType,
  subject: string,
): Promise<Protocol.ClaimFieldEntry[]> {
  const url = `${server}/platforms/${claimType.toString()}/text/getClaimFieldsByUrl`;

  const response = await fetch(url, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      'x-polycentric-user-agent': userAgent,
    }),
    body: JSON.stringify({ url: subject }),
  });

  await checkResponse('getClaimFieldsByUrl', response);

  interface ClaimFieldItem {
    key: number;
    value: string;
  }

  const decoded = (await response.json()) as ClaimFieldItem[];
  return decoded.map((item: ClaimFieldItem) => ({
    key: Long.fromNumber(item.key),
    value: item.value,
  }));
}

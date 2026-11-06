import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { pkceChallenge } from "@/lib/crypto";
import type { MediaItem } from "@/lib/media";
import { deviantart } from "@/lib/networks/deviantart";
import { NetworkError } from "@/lib/networks/http";
import type {
  Account,
  OAuthConnect,
  PublishContext,
} from "@/lib/networks/types";

const API = "https://www.deviantart.com/api/v1/oauth2";
const file = path.join(os.tmpdir(), `posty-da-${process.pid}.png`);
const connect = deviantart.connect as OAuthConnect;

beforeAll(async () => {
  Object.assign(process.env, {
    APP_KEY: "test-key",
    DEVIANTART_CLIENT_ID: "da-id",
    DEVIANTART_CLIENT_SECRET: "da-secret",
    PUBLIC_MEDIA_URL: "https://media.example.com",
    MEDIA_DIR: os.tmpdir(),
  });
  await writeFile(file, "fake image bytes");
});
afterAll(() => rm(file, { force: true }));
afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init: RequestInit };

/** Stub fetch: first matching [pattern, responder] wins; records calls. */
function stubFetch(routes: [RegExp, () => Response][]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    calls.push({ url: input, init });
    const route = routes.find(([re]) => re.test(input));
    if (!route) throw new Error(`Unexpected fetch ${input}`);
    return route[1]();
  });
  return calls;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const submitted = () => json({ status: "success", itemid: 42 });
const published = () =>
  json({
    status: "success",
    url: "https://www.deviantart.com/me/art/my-art-1",
    deviationid: "DEV-1",
  });

const acct: Account = {
  socialAccountId: "sa1",
  providerAccountId: "123",
  name: "me",
  username: "me",
  accessToken: "tok",
  refreshToken: "rt",
  expiresAt: null,
  tokenIssuedAt: new Date(),
  meta: {},
};

const image: MediaItem = {
  mediaId: "m1",
  kind: "image",
  mime: "image/png",
  path: file,
  url: "https://media.example.com/media/m1.png",
  sizeBytes: 16,
  width: 100,
  height: 100,
  durationSeconds: null,
  altText: "",
};

const ctx = (options: Record<string, string> = {}): PublishContext => ({
  idempotencyKey: "k",
  options: { title: "My art", ...options },
  log: () => {},
});

const part = { text: "About this piece", media: [image] };
const formOf = (call: Call) => new URLSearchParams(String(call.init.body));

describe("deviantart publish", () => {
  it("uploads to Sta.sh, then publishes the item", async () => {
    const calls = stubFetch([
      [/\/stash\/submit$/, submitted],
      [/\/stash\/publish$/, published],
    ]);

    const res = await deviantart.publish(
      acct,
      part,
      ctx({ tags: "#art, my_tag" }),
    );

    expect(res).toEqual({
      id: "DEV-1",
      url: "https://www.deviantart.com/me/art/my-art-1",
    });
    expect(calls.map((c) => c.url)).toEqual([
      `${API}/stash/submit`,
      `${API}/stash/publish`,
    ]);

    const upload = calls[0].init.body as FormData;
    expect(upload.get("title")).toBe("My art");
    expect(upload.get("artist_comments")).toBe("About this piece");
    expect(upload.getAll("tags[]")).toEqual(["art", "my_tag"]);
    const sent = upload.get("file") as File;
    expect(sent.name).toBe(path.basename(file));
    expect(sent.type).toBe("image/png");

    expect(Object.fromEntries(formOf(calls[1]))).toEqual({
      itemid: "42",
      is_mature: "false",
      agree_submission: "1",
      agree_tos: "1",
    });
    for (const call of calls) {
      expect(new Headers(call.init.headers).get("Authorization")).toBe(
        "Bearer tok",
      );
    }
  });

  it("sends the mature level and AI label when set", async () => {
    const calls = stubFetch([
      [/\/stash\/submit$/, submitted],
      [/\/stash\/publish$/, published],
    ]);

    await deviantart.publish(
      acct,
      part,
      ctx({ mature: "strict", aiGenerated: "true" }),
    );

    const form = formOf(calls[1]);
    expect(form.get("is_mature")).toBe("true");
    expect(form.get("mature_level")).toBe("strict");
    expect(form.get("is_ai_generated")).toBe("true");
  });

  it("stops when an upload reports an error with HTTP 200", async () => {
    const calls = stubFetch([
      [
        /\/stash\/submit$/,
        () =>
          json({
            status: "error",
            error: "invalid_request",
            error_description: "Upload too large",
          }),
      ],
      [/\/stash\/publish$/, published],
    ]);

    await expect(deviantart.publish(acct, part, ctx())).rejects.toThrow(
      "Upload too large",
    );
    expect(calls).toHaveLength(1);
  });

  it("needs an image and a title before calling the API", async () => {
    const calls = stubFetch([]);

    await expect(
      deviantart.publish(acct, { text: "hi", media: [] }, ctx()),
    ).rejects.toThrow("DeviantArt needs an image");
    await expect(
      deviantart.publish(acct, part, ctx({ title: "  " })),
    ).rejects.toThrow("DeviantArt needs a title");
    expect(calls).toHaveLength(0);
  });

  it("retries a failed upload but never an ambiguous publish", async () => {
    const down = () => new Response("oops", { status: 500 });

    stubFetch([[/\/stash\/submit$/, down]]);
    const upload = await deviantart
      .publish(acct, part, ctx())
      .catch((e: NetworkError) => e);
    expect((upload as NetworkError).retryable).toBe(true);

    stubFetch([
      [/\/stash\/submit$/, submitted],
      [/\/stash\/publish$/, down],
    ]);
    const publish = await deviantart
      .publish(acct, part, ctx())
      .catch((e: NetworkError) => e);
    expect((publish as NetworkError).retryable).toBe(false);
  });
});

describe("deviantart connect", () => {
  const start = {
    state: "st",
    redirectUri: "https://posty.example/api/connect/deviantart/callback",
    codeVerifier: "verifier",
    data: {},
  };

  it("asks for the scopes with an S256 PKCE challenge", async () => {
    const { url } = await connect.authorize(start, {});
    const u = new URL(url);

    expect(u.origin + u.pathname).toBe(
      "https://www.deviantart.com/oauth2/authorize",
    );
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code",
      client_id: "da-id",
      redirect_uri: start.redirectUri,
      scope: "basic user browse stash publish",
      state: "st",
      code_challenge: pkceChallenge("verifier"),
      code_challenge_method: "S256",
    });
  });

  it("exchanges the code and reads the account", async () => {
    const calls = stubFetch([
      [
        /\/oauth2\/token$/,
        () =>
          json({
            status: "success",
            access_token: "at",
            refresh_token: "rt2",
            expires_in: 3600,
          }),
      ],
      [
        /\/user\/whoami$/,
        () =>
          json({
            userid: "U-1",
            username: "artist",
            usericon: "https://a.deviantart.net/icon.png",
            type: "regular",
          }),
      ],
    ]);

    const [account] = await connect.exchange({ ...start, code: "c0de" });

    expect(Object.fromEntries(formOf(calls[0]))).toEqual({
      grant_type: "authorization_code",
      code: "c0de",
      redirect_uri: start.redirectUri,
      code_verifier: "verifier",
      client_id: "da-id",
      client_secret: "da-secret",
    });
    expect(account).toMatchObject({
      providerAccountId: "U-1",
      name: "artist",
      username: "artist",
      avatarUrl: "https://a.deviantart.net/icon.png",
      accessToken: "at",
      refreshToken: "rt2",
    });
    expect(account.expiresAt).toBeInstanceOf(Date);
  });

  it("refreshes with the stored refresh token", async () => {
    const calls = stubFetch([
      [
        /\/oauth2\/token$/,
        () => json({ access_token: "at2", expires_in: 3600 }),
      ],
    ]);

    const tokens = await deviantart.refresh!(acct);

    const form = formOf(calls[0]);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt");
    expect(tokens.accessToken).toBe("at2");
    expect(tokens.refreshToken).toBeUndefined();
  });
});

describe("deviantart metrics", () => {
  it("maps deviation stats", async () => {
    const calls = stubFetch([
      [
        /\/deviation\/metadata\?/,
        () =>
          json({
            metadata: [
              {
                deviationid: "DEV-1",
                stats: { views: 10, favourites: 3, comments: 2, downloads: 1 },
              },
            ],
          }),
      ],
    ]);

    const metrics = await deviantart.metrics!(acct, "DEV-1");

    expect(metrics).toEqual({ views: 10, likes: 3, comments: 2 });
    const u = new URL(calls[0].url);
    expect(u.searchParams.getAll("deviationids[]")).toEqual(["DEV-1"]);
    expect(u.searchParams.get("ext_stats")).toBe("true");
  });
});

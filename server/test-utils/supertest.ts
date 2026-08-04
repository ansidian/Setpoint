import http, { type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import supertest from "supertest";
import { afterAll } from "vitest";

export type { Response, Test } from "supertest";

const TEST_APP_HEADER = "x-setpoint-test-app";
const apps = new Map<string, RequestListener>();
const appIds = new WeakMap<object, string>();
let nextAppId = 1;

const server = http.createServer((req, res) => {
  const appId = req.headers[TEST_APP_HEADER];
  const app = typeof appId === "string" ? apps.get(appId) : undefined;
  if (!app) {
    res.statusCode = 500;
    res.end("Managed Supertest request did not identify an application");
    return;
  }
  app(req, res);
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    resolve();
  });
});

const clientAgent = new http.Agent({ keepAlive: true });
const managedOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  clientAgent.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections();
  });
  apps.clear();
});

type TestApp = Parameters<typeof supertest>[0];

function appIdFor(app: Exclude<TestApp, string>): string {
  const key = app as object;
  const existing = appIds.get(key);
  if (existing) return existing;
  const appId = String(nextAppId++);
  appIds.set(key, appId);
  apps.set(appId, app as RequestListener);
  return appId;
}

function wrapClient(
  client: ReturnType<typeof supertest>,
  appId?: string,
): ReturnType<typeof supertest> {
  return new Proxy(client, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        const test = Reflect.apply(member, target, args) as {
          set?: (field: string, value: string) => unknown;
          agent?: (agent: http.Agent) => unknown;
        };
        if (typeof test.set === "function" && typeof test.agent === "function") {
          if (appId) test.set(TEST_APP_HEADER, appId);
          test.agent(clientAgent);
        }
        return test;
      };
    },
  });
}

export default function request(app: TestApp): ReturnType<typeof supertest> {
  if (typeof app === "string") {
    throw new Error("Managed Supertest requires an in-process application");
  }
  if (typeof app !== "function") {
    return wrapClient(supertest(app));
  }
  return wrapClient(supertest(server), appIdFor(app));
}

export function fetchApp(
  app: RequestListener,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(TEST_APP_HEADER, appIdFor(app));
  return fetch(`${managedOrigin}${path}`, { ...init, headers });
}

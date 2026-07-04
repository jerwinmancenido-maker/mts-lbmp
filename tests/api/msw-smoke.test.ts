import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer(
  http.get("http://localhost:4100/health", () => {
    return HttpResponse.json({ ok: true, source: "msw" });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("MSW test foundation", () => {
  test("can mock API responses for future workflow tests", async () => {
    const response = await fetch("http://localhost:4100/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, source: "msw" });
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();
const stamp = Date.now();
let token: string;

const auth = () => ({ Authorization: `Bearer ${token}` });
const get = async () => (await request(app).get("/api/settings/dashboard-widgets").set(auth())).body.widgets;
const patch = (widgets: unknown) => request(app).patch("/api/settings/dashboard-widgets").set(auth()).send({ widgets });

beforeAll(async () => {
  token = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Widgets", email: `widgets-${stamp}@example.com`, password: "password123" })
  ).body.token;
});

describe("dashboard widget preferences", () => {
  it("starts with nothing changed", async () => {
    expect(await get()).toEqual({});
  });

  it("merges each change into what's saved", async () => {
    expect((await patch({ topViewed: false })).body.widgets).toEqual({ topViewed: false });
    expect((await patch({ topProviders: false, topViewed: true })).body.widgets).toEqual({
      topViewed: true,
      topProviders: false,
    });
    expect(await get()).toEqual({ topViewed: true, topProviders: false });
  });

  it("keeps both of two toggles sent at once", async () => {
    await Promise.all([patch({ modelCount: false }), patch({ authorCount: false })]);
    expect(await get()).toMatchObject({ modelCount: false, authorCount: false });
  });

  it("rejects an unknown widget or a non-boolean", async () => {
    expect((await patch({ weather: false })).status).toBe(400);
    expect((await patch({ topViewed: "no" })).status).toBe(400);
  });

  it("needs a signed-in user", async () => {
    expect((await request(app).get("/api/settings/dashboard-widgets")).status).toBe(401);
  });
});

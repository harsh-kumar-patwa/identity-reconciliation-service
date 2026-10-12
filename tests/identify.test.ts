import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import prisma from "../src/db";
import { identify } from "../src/services/contact.service";

describe.skipIf(!process.env.DATABASE_URL)("POST /identify (needs Postgres)", () => {
  beforeEach(async () => {
    await prisma.contact.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a request with no email or phone", async () => {
    const res = await request(app).post("/identify").send({});
    expect(res.status).toBe(400);
  });

  it("creates a new primary for an unknown contact", async () => {
    const res = await request(app).post("/identify").send({ email: "doc@hv.com", phoneNumber: "123" });
    expect(res.status).toBe(200);
    expect(res.body.contact.secondaryContactIds).toEqual([]);
  });

  it("adds a secondary when new info shares a phone number", async () => {
    const first = await request(app).post("/identify").send({ email: "doc@hv.com", phoneNumber: "123" });
    const second = await request(app).post("/identify").send({ email: "marty@hv.com", phoneNumber: "123" });

    expect(second.body.contact.primaryContactId).toBe(first.body.contact.primaryContactId);
    expect(second.body.contact.emails).toEqual(["doc@hv.com", "marty@hv.com"]);
    expect(second.body.contact.secondaryContactIds).toHaveLength(1);
  });

  it("merges two primaries and keeps the older one", async () => {
    const a = await request(app).post("/identify").send({ email: "george@hv.com", phoneNumber: "919" });
    await request(app).post("/identify").send({ email: "biff@hv.com", phoneNumber: "717" });

    const merged = await request(app).post("/identify").send({ email: "george@hv.com", phoneNumber: "717" });

    expect(merged.body.contact.primaryContactId).toBe(a.body.contact.primaryContactId);
    expect(merged.body.contact.phoneNumbers).toEqual(["919", "717"]);
  });

  it("does not create duplicate primaries under concurrent requests", async () => {
    await Promise.all(Array.from({ length: 20 }, () => identify({ email: "same@hv.com" })));
    const primaries = await prisma.contact.count({ where: { linkPrecedence: "primary" } });
    expect(primaries).toBe(1);
  });
});

describe("health endpoints", () => {
  it("livez is always ok", async () => {
    const res = await request(app).get("/livez");
    expect(res.status).toBe(200);
  });

  it("metrics are exposed", async () => {
    const res = await request(app).get("/metrics");
    expect(res.text).toContain("http_requests_total");
  });
});

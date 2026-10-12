import { describe, it, expect } from "vitest";
import { buildResponse } from "../src/services/contact.service";
import { Contact } from "../src/generated/prisma/client";

function contact(id: number, email: string | null, phoneNumber: string | null): Contact {
  return {
    id,
    email,
    phoneNumber,
    linkedId: id === 1 ? null : 1,
    linkPrecedence: id === 1 ? "primary" : "secondary",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

describe("buildResponse", () => {
  it("puts the primary first and removes duplicates", () => {
    const result = buildResponse([
      contact(1, "a@x.com", "111"),
      contact(2, "b@x.com", "111"),
      contact(3, "a@x.com", "222"),
    ]);

    expect(result.contact).toEqual({
      primaryContactId: 1,
      emails: ["a@x.com", "b@x.com"],
      phoneNumbers: ["111", "222"],
      secondaryContactIds: [2, 3],
    });
  });

  it("skips null emails and phone numbers", () => {
    const result = buildResponse([contact(1, null, "111")]);
    expect(result.contact.emails).toEqual([]);
    expect(result.contact.phoneNumbers).toEqual(["111"]);
  });
});

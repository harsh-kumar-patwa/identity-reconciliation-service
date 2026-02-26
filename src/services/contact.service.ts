import prisma from "../db";
import { Contact } from "../generated/prisma/client";
import { IdentifyRequest, IdentifyResponse } from "../types/contact";

/**
 * Find the root primary contact for a given contact.
 * Follows the linkedId chain up to the primary.
 */
async function findPrimaryContact(contact: Contact): Promise<Contact> {
  let current = contact;
  while (current.linkPrecedence === "secondary" && current.linkedId !== null) {
    const parent = await prisma.contact.findUnique({
      where: { id: current.linkedId },
    });
    if (!parent) break;
    current = parent;
  }
  return current;
}

/**
 * Gather all contacts in a linked group given the primary contact ID.
 * Returns the primary first, then all secondaries ordered by createdAt.
 */
async function getLinkedContacts(primaryId: number): Promise<Contact[]> {
  const primary = await prisma.contact.findUnique({
    where: { id: primaryId },
  });
  if (!primary) return [];

  const secondaries = await prisma.contact.findMany({
    where: { linkedId: primaryId, linkPrecedence: "secondary" },
    orderBy: { createdAt: "asc" },
  });

  return [primary, ...secondaries];
}

/**
 * Build the consolidated response from a list of linked contacts.
 */
function buildResponse(contacts: Contact[]): IdentifyResponse {
  const primary = contacts[0]!;
  const emails: string[] = [];
  const phoneNumbers: string[] = [];
  const secondaryContactIds: number[] = [];

  for (const contact of contacts) {
    if (contact.email && !emails.includes(contact.email)) {
      emails.push(contact.email);
    }
    if (contact.phoneNumber && !phoneNumbers.includes(contact.phoneNumber)) {
      phoneNumbers.push(contact.phoneNumber);
    }
    if (contact.id !== primary.id) {
      secondaryContactIds.push(contact.id);
    }
  }

  return {
    contact: {
      primaryContactId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds,
    },
  };
}

export async function identify(request: IdentifyRequest): Promise<IdentifyResponse> {
  const { email, phoneNumber } = request;

  // Find all existing contacts matching email or phoneNumber
  const conditions: object[] = [];
  if (email) conditions.push({ email });
  if (phoneNumber) conditions.push({ phoneNumber });

  const matchingContacts = await prisma.contact.findMany({
    where: { OR: conditions },
    orderBy: { createdAt: "asc" },
  });

  // Case 1: No existing contacts — create a new primary contact
  if (matchingContacts.length === 0) {
    const newContact = await prisma.contact.create({
      data: {
        email: email || null,
        phoneNumber: phoneNumber || null,
        linkPrecedence: "primary",
      },
    });
    return buildResponse([newContact]);
  }

  // Find all unique primary contacts in the matching set
  const primaryContactsMap = new Map<number, Contact>();
  for (const contact of matchingContacts) {
    const primary = await findPrimaryContact(contact);
    primaryContactsMap.set(primary.id, primary);
  }

  // Sort primaries by creation date — oldest is the true primary
  const primaryContacts = Array.from(primaryContactsMap.values()).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  const truePrimary = primaryContacts[0]!;

  // Case 2: Multiple primaries found — link them (older stays primary, newer becomes secondary)
  if (primaryContacts.length > 1) {
    for (let i = 1; i < primaryContacts.length; i++) {
      const otherPrimary = primaryContacts[i]!;

      // Turn this primary into a secondary linked to the true primary
      await prisma.contact.update({
        where: { id: otherPrimary.id },
        data: {
          linkedId: truePrimary.id,
          linkPrecedence: "secondary",
        },
      });

      // Re-link all secondaries of the other primary to the true primary
      await prisma.contact.updateMany({
        where: { linkedId: otherPrimary.id },
        data: { linkedId: truePrimary.id },
      });
    }
  }

  // Check if the incoming request has new information not already in the linked group
  const allLinked = await getLinkedContacts(truePrimary.id);

  const emailExists = !email || allLinked.some((c) => c.email === email);
  const phoneExists = !phoneNumber || allLinked.some((c) => c.phoneNumber === phoneNumber);

  // Case 3: New information found — create a secondary contact
  if (!emailExists || !phoneExists) {
    const newSecondary = await prisma.contact.create({
      data: {
        email: email || null,
        phoneNumber: phoneNumber || null,
        linkedId: truePrimary.id,
        linkPrecedence: "secondary",
      },
    });
    allLinked.push(newSecondary);
  }

  return buildResponse(allLinked);
}

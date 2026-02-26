export interface IdentifyRequest {
  email?: string | null;
  phoneNumber?: string | null;
}

export interface ContactResponse {
  primaryContactId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

export interface IdentifyResponse {
  contact: ContactResponse;
}

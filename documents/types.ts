export const documentNames = ["W-4 Form", "I-9 Form", "State Withholding Form", "W-9 Form", "Payment Method Form"] as const;
export const maxFileBytes = 10 * 1024 * 1024;
export type UploadDetails = { id: string; employeeId: number; kind: "certificate" | "onboarding" | "photo"; title: string; expirationDate?: string };
export interface DocumentBucket {
  delete(key: string): Promise<void>;
  put(key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number; customMetadata?: Record<string, string> } | null>;
}

import type { UIMessage } from "ai";
import Dexie, { type EntityTable } from "dexie";

/**
 * A message as persisted in IndexedDB. Since v4 only Image History uses Dexie
 * (rows with sessionId "image"); Conversation History lives in Cloudflare D1.
 */
export type StoredMessage = UIMessage & {
  sessionId: string;
  createdAt: Date;
};

/** Image History stores generated images as Blobs in a `data-images` part. */
export interface StoredImagesData {
  images: Blob[];
}

/** The display form of a `data-images` part, with Blobs replaced by object URLs. */
export interface ImageUrlsData {
  urls: string[];
}

export const db = new Dexie("CF_AI_DB") as Dexie & {
  message: EntityTable<StoredMessage, "id">;
};

// v1: initial schema (has a stray space and unique createdAt constraint)
// v2: removed unique createdAt constraint and fixed the stray space in sessionId index
// v3: added [sessionId+createdAt] so the newest messages of a session load in order
// v4: Conversation History moved to Cloudflare D1. The session table is omitted,
//     so Dexie drops it on upgrade; only Image History rows (sessionId "image") stay.
db.version(1).stores({
  session: "&id, name, updatedAt",
  message: "&id, sessionId ,role, metadata, parts, &createdAt",
});

db.version(2).stores({
  session: "&id, name, updatedAt",
  message: "&id, sessionId, role, metadata, parts, createdAt",
});

db.version(3).stores({
  session: "&id, name, updatedAt",
  message: "&id, sessionId, role, metadata, parts, createdAt, [sessionId+createdAt]",
});

db.version(4).stores({
  // Explicit null drops the table (omitting it would leave it untouched).
  session: null,
  message: "&id, sessionId, role, metadata, parts, createdAt, [sessionId+createdAt]",
});

import type { UIMessage } from "ai";
import Dexie from "dexie";
import { db, type StoredMessage } from "@/lib/db";

export const IMAGE_HISTORY_LOAD_LIMIT = 50;

/**
 * Image History is the only history still stored locally. It shares the
 * message table under a reserved session id that never has a D1 session row.
 */
const IMAGE_HISTORY_SESSION_ID = "image";

const loadNewestMessages = async (sessionId: string, limit: number): Promise<StoredMessage[]> => {
  const newestFirst = await db.message
    .where("[sessionId+createdAt]")
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .reverse()
    .limit(limit)
    .toArray();
  return newestFirst.reverse();
};

export const appendImageHistoryEntry = async (entry: UIMessage) => {
  await db.message.add({ ...entry, sessionId: IMAGE_HISTORY_SESSION_ID, createdAt: new Date() });
};

export const loadImageHistory = () =>
  loadNewestMessages(IMAGE_HISTORY_SESSION_ID, IMAGE_HISTORY_LOAD_LIMIT);

export const clearImageHistory = async () => {
  await db.message.where("sessionId").equals(IMAGE_HISTORY_SESSION_ID).delete();
};

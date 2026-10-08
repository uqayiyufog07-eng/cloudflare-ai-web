import { afterEach, beforeAll, expect, setSystemTime, test } from "bun:test";
import Dexie from "dexie";
import { createUserMessage } from "@/lib/conversation-api";
import {
  appendImageHistoryEntry,
  clearImageHistory,
  IMAGE_HISTORY_LOAD_LIMIT,
  loadImageHistory,
} from "@/lib/conversation-store";
import { db, type StoredMessage } from "@/lib/db";

const textOf = (message: StoredMessage) => message.parts.find((part) => part.type === "text")?.text;

beforeAll(async () => {
  // Seed a v3 database (sessions + messages) so opening db exercises the v4
  // upgrade that drops the session table. An Image History row must survive.
  const legacy = new Dexie("CF_AI_DB");
  legacy.version(3).stores({
    session: "&id, name, updatedAt",
    message: "&id, sessionId, role, metadata, parts, createdAt, [sessionId+createdAt]",
  });
  await legacy.table("message").add({
    id: "legacy-image",
    role: "user",
    parts: [{ type: "text", text: "legacy prompt" }],
    sessionId: "image",
    createdAt: new Date(Date.UTC(2025, 0, 1)),
  });
  legacy.close();
  // Let the underlying fake-indexeddb connection finish closing so the v4
  // upgrade can physically delete the session object store.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

// Entries written within the same millisecond share a timestamp, so tests step the
// clock to keep creation order unambiguous.
let clock = Date.UTC(2026, 0, 1);
const tick = () => setSystemTime((clock += 1000));

afterEach(async () => {
  setSystemTime();
  await db.message.clear();
});

test("upgrading from v3 keeps Image History after sessions move to D1", async () => {
  await db.open();
  expect(db.verno).toBe(4);
  expect(db.tables.map((table) => table.name)).toEqual(["message"]);

  // The v4 upgrade must also drop the underlying IndexedDB object store.
  const backend = db.backendDB();
  expect(backend.objectStoreNames.contains("session")).toBe(false);
  expect(backend.objectStoreNames.contains("message")).toBe(true);

  const history = await loadImageHistory();
  expect(textOf(history[0])).toBe("legacy prompt");
});

test("Image History keeps the newest 50 entries in chronological order", async () => {
  for (let index = 0; index < IMAGE_HISTORY_LOAD_LIMIT + 1; index++) {
    tick();
    await appendImageHistoryEntry(createUserMessage(`prompt ${index}`));
  }

  const imageHistory = await loadImageHistory();
  // 51 new rows: the oldest is trimmed to the 50-row limit.
  expect(imageHistory).toHaveLength(IMAGE_HISTORY_LOAD_LIMIT);
  expect(textOf(imageHistory[0])).toBe("prompt 1");
  expect(textOf(imageHistory.at(-1)!)).toBe(`prompt ${IMAGE_HISTORY_LOAD_LIMIT}`);
});

test("Image History can be cleared without touching unrelated rows", async () => {
  await appendImageHistoryEntry(createUserMessage("a prompt to clear"));
  await clearImageHistory();
  expect(await loadImageHistory()).toEqual([]);
});

import { expect, test } from "bun:test";
import { db } from "@/lib/db";

const tableNames = () => db.tables.map((table) => table.name);

test("Dexie v4 keeps only the message table for Image History", async () => {
  await db.open();

  expect(db.verno).toBe(4);
  expect(tableNames()).toEqual(["message"]);

  const indexNames = db.table("message").schema.indexes.map((index) => index.name);
  expect(indexNames).toContain("sessionId");
  expect(indexNames).toContain("[sessionId+createdAt]");
});

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const streams = sqliteTable("streams", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  snapshotAt: integer("snapshot_at").notNull(),
  receivedAt: integer("received_at").notNull(),
});
export const signals = sqliteTable("signals", {
  id: text("id").primaryKey(),
  streamId: text("stream_id").notNull(),
  payload: text("payload").notNull(),
  confirmedAt: integer("confirmed_at").notNull(),
  receivedAt: integer("received_at").notNull(),
}, table => [
  index("signals_stream_time").on(table.streamId, table.confirmedAt, table.id),
]);

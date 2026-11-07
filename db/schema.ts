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

// One private desk owns its saved Deriv preferences and active scanner lease.
export const derivConfig = sqliteTable("deriv_config", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const derivLease = sqliteTable("deriv_lease", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  mode: text("mode").notNull(),
  expiresAt: integer("expires_at").notNull(),
  heartbeatAt: integer("heartbeat_at").notNull(),
});

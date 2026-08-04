import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
    userid: serial("userid").primaryKey(),
    username: text("username").notNull(),
    email: text("email").unique().notNull(),
    password: text("password").notNull(),
});

export const userModelHistory = pgTable("usermodelhistory", {
    serialno: serial("serialno").primaryKey(),
    userid: integer("userid").references(() => users.userid),
    coeff: jsonb("coeff").notNull(),
    intercept: jsonb("intercept").notNull(),
    /** Number of samples the client actually trained on — used as FedAvg weight. */
    n_samples: integer("n_samples").notNull().default(1),
    timestamp: timestamp("timestamp").defaultNow(),
});

export const globalModelHistory = pgTable("globalmodelhistory", {
    serialno: serial("serialno").primaryKey(),
    coeff: jsonb("coeff").notNull(),
    intercept: jsonb("intercept").notNull(),
    timestamp: timestamp("timestamp").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
    modelHistory: many(userModelHistory),
}));

export const userModelHistoryRelations = relations(userModelHistory, ({ one }) => ({
    user: one(users, {
        fields: [userModelHistory.userid],
        references: [users.userid],
    }),
}));

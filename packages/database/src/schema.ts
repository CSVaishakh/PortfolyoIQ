import { pgTable, serial, text, integer, real, jsonb, timestamp } from "drizzle-orm/pg-core";
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
    feature_version: integer("feature_version").notNull().default(1),
    scaler_version: integer("scaler_version").notNull().default(1),
    model_version: integer("model_version").notNull().default(1),
    validation_auc: real("validation_auc"),
    timestamp: timestamp("timestamp").defaultNow(),
});

export const globalModelHistory = pgTable("globalmodelhistory", {
    serialno: serial("serialno").primaryKey(),
    coeff: jsonb("coeff").notNull(),
    intercept: jsonb("intercept").notNull(),
    participants: integer("participants").notNull().default(0),
    n_samples_total: integer("n_samples_total").notNull().default(0),
    feature_version: integer("feature_version").notNull().default(1),
    scaler_version: integer("scaler_version").notNull().default(1),
    model_version: integer("model_version").notNull().default(1),
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

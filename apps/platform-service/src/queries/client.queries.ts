import { db, users, userModelHistory, globalModelHistory } from "database";
import { eq, desc } from "drizzle-orm";

export async function getUserById(userId: number) {
  const [user] = await db
    .select({ userid: users.userid, username: users.username, email: users.email })
    .from(users)
    .where(eq(users.userid, userId))
    .limit(1);
  return user ?? null;
}

export async function getLatestGlobalModel() {
  const [row] = await db
    .select()
    .from(globalModelHistory)
    .orderBy(desc(globalModelHistory.timestamp))
    .limit(1);
  return row ?? null;
}

export async function getLatestUserWeights(userId: number) {
  const [row] = await db
    .select()
    .from(userModelHistory)
    .where(eq(userModelHistory.userid, userId))
    .orderBy(desc(userModelHistory.timestamp))
    .limit(1);
  return row ?? null;
}

export async function saveUserWeights(
  userId: number,
  coeff: number[][],
  intercept: number[],
  nSamples: number,
) {
  const [row] = await db
    .insert(userModelHistory)
    .values({ userid: userId, coeff, intercept, n_samples: nSamples })
    .returning();
  return row!;
}

// Returns the single most-recent weight row for every user that has uploaded weights.
export async function getAllLatestUserWeights() {
  const all = await db
    .select()
    .from(userModelHistory)
    .orderBy(desc(userModelHistory.timestamp));

  const seen = new Set<number>();
  return all.filter((row) => {
    if (!row.userid || seen.has(row.userid)) return false;
    seen.add(row.userid);
    return true;
  });
}

export async function saveGlobalWeights(coeff: number[][], intercept: number[]) {
  const [row] = await db
    .insert(globalModelHistory)
    .values({ coeff, intercept })
    .returning();
  return row!;
}

export async function getUserModelHistory(
  userId: number,
  limit: number,
  offset: number,
) {
  return db
    .select()
    .from(userModelHistory)
    .where(eq(userModelHistory.userid, userId))
    .orderBy(desc(userModelHistory.timestamp))
    .limit(limit)
    .offset(offset);
}

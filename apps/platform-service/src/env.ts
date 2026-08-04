/**
 * Environment loading, kept in its own module so it runs before any importer's
 * other imports are evaluated. Routers read `process.env` at module scope, so
 * this must be the first import in the entry point.
 *
 * `.env.local` holds this machine's real secrets and is never committed; `.env`
 * is the shared fallback. The first file to define a key wins.
 */
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"] });

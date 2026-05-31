import { initializeDatabase, openDatabase } from "./db/database.js";
import { buildServer } from "./server.js";

const db = openDatabase();
initializeDatabase(db);

const app = await buildServer(db);
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ host, port });
console.log(`Weeb-Screen listening on http://${host}:${port}`);


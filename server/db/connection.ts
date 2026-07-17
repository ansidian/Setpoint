import { createClient, type Client } from "@libsql/client";
import { resolveDatabaseClientConfig } from "./config.ts";

const dbConfig = resolveDatabaseClientConfig(process.env);
const db: Client = createClient(dbConfig.client);

export default db;

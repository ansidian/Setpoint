import { createClient } from "@libsql/client";
import { resolveDatabaseClientConfig } from "./config.js";

const dbConfig = resolveDatabaseClientConfig(process.env);
const db = createClient(dbConfig.client);

export default db;

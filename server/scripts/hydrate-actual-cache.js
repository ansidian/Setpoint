import { hydrateActualCache } from "../briefing/bills-service.js";

const userId = process.argv[2] || process.env.EA_USER_ID;

if (!userId) {
  console.error("EA_USER_ID is required, or pass a user id as the first argument.");
  process.exit(1);
}

const result = await hydrateActualCache(userId);
console.log(JSON.stringify(result, null, 2));

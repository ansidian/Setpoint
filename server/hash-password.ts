#!/usr/bin/env node
import bcrypt from "bcrypt";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node server/hash-password.ts <your-password>");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log("\nAdd this to your .env file:\n");
console.log(`EA_PASSWORD_HASH=${hash}`);
console.log("\nRemove the old EA_PASSWORD line if it exists.\n");

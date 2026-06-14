import db from "../db/connection.js";

function safeMetadata(metadata) {
  try {
    return JSON.stringify(metadata || {});
  } catch {
    return "{}";
  }
}

export async function recordAlfredUsage(userId, {
  dbClient = db,
  eventType,
  model,
  usage = {},
  metadata = {},
  createdAt = new Date(),
} = {}) {
  await dbClient.execute({
    sql: `INSERT INTO ea_alfred_usage
            (user_id, event_type, model, input_tokens, cached_input_tokens,
             output_tokens, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      userId,
      eventType,
      model,
      Number(usage.input_tokens || 0),
      Number(usage.cache_read_input_tokens || 0),
      Number(usage.output_tokens || 0),
      safeMetadata(metadata),
      createdAt.toISOString(),
    ],
  });
}

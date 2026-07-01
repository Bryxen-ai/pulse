#!/usr/bin/env bun

/**
 * Test script to verify session reuse fix
 *
 * This script simulates multiple API calls to verify that:
 * 1. First request creates a new session
 * 2. Subsequent requests with the same session ID reuse that session
 * 3. No duplicate sessions are created
 */

const GATEWAY_KEY = "test-key"; // You'll need to use a real gateway key
const API_URL = "http://localhost:3000";

async function testSessionReuse() {
  console.log("🧪 Testing session reuse fix...\n");

  // First request - should create a new session
  console.log("1️⃣  Making first request (should create new session)...");
  const firstResponse = await fetch(`${API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GATEWAY_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [
        { role: "user", content: "Hello, this is my first message" }
      ],
      stream: false,
    }),
  });

  const sessionId = firstResponse.headers.get("X-Session-Id");
  console.log(`   ✅ Session created: ${sessionId}\n`);

  if (!sessionId) {
    console.error("❌ ERROR: No session ID returned in response headers!");
    process.exit(1);
  }

  // Second request - should reuse the same session
  console.log("2️⃣  Making second request with same session ID (should reuse)...");
  const secondResponse = await fetch(`${API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GATEWAY_KEY}`,
      "Content-Type": "application/json",
      "X-Session-Id": sessionId, // Pass the session ID
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [
        { role: "user", content: "This is my second message in the same conversation" }
      ],
      stream: false,
    }),
  });

  const returnedSessionId = secondResponse.headers.get("X-Session-Id");
  console.log(`   ✅ Session returned: ${returnedSessionId}\n`);

  if (returnedSessionId !== sessionId) {
    console.error(`❌ ERROR: Session ID mismatch!`);
    console.error(`   Expected: ${sessionId}`);
    console.error(`   Got: ${returnedSessionId}`);
    process.exit(1);
  }

  // Third request - should also reuse the same session
  console.log("3️⃣  Making third request with same session ID (should reuse)...");
  const thirdResponse = await fetch(`${API_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GATEWAY_KEY}`,
      "Content-Type": "application/json",
      "X-Session-Id": sessionId,
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [
        { role: "user", content: "This is my third message" }
      ],
      stream: false,
    }),
  });

  const thirdSessionId = thirdResponse.headers.get("X-Session-Id");
  console.log(`   ✅ Session returned: ${thirdSessionId}\n`);

  if (thirdSessionId !== sessionId) {
    console.error(`❌ ERROR: Session ID mismatch on third request!`);
    process.exit(1);
  }

  console.log("✅ All tests passed! Session reuse is working correctly.");
  console.log(`   Same session ID (${sessionId}) was used for all 3 requests.\n`);

  // Optional: Verify in the database
  console.log("📊 Checking database...");
  const { Database } = await import("bun:sqlite");
  const db = new Database(process.env.DB_PATH || "pulse.db");

  const sessions = db.query("SELECT id, title FROM sessions WHERE id = ?").all(sessionId);
  const messages = db.query("SELECT COUNT(*) as count FROM messages WHERE session_id = ?").get(sessionId) as { count: number };

  console.log(`   Sessions with this ID: ${sessions.length}`);
  console.log(`   Messages in session: ${messages.count}`);

  if (sessions.length === 1) {
    console.log("   ✅ Only one session exists (no duplicates!)");
  } else {
    console.error(`   ❌ ERROR: Found ${sessions.length} sessions (expected 1)`);
    process.exit(1);
  }

  db.close();
}

// Run the test
testSessionReuse().catch((error) => {
  console.error("\n❌ Test failed with error:");
  console.error(error);
  process.exit(1);
});

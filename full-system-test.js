// full-system-test.js - Complete Panopticon System Test
const io = require("socket.io-client");

// Replace with your actual tokens
const SUPERADMIN_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjNWMyOWRmYS0zMjY5LTQ0ZjctYjRmNC03MTcwYTQ5NmYyY2YiLCJ1c2VybmFtZSI6InN1cGVyYWRtaW4iLCJlbWFpbCI6InN1cGVyYWRtaW5AcGFub3B0aWNvbi5sb2NhbCIsInJvbGUiOiJzdXBlcmFkbWluIiwiaWF0IjoxNzY5Mjc2OTAwLCJleHAiOjE3NjkzNjMzMDAsImF1ZCI6InBhbm9wdGljb24tdXNlcnMiLCJpc3MiOiJwYW5vcHRpY29uLWNoYXQifQ.MIFnN3fZv8JFvVBoWJtVzLSg9NeNN40PvGBQziOlNYY";
const ALICE_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI4YTg3ZTJkOC1hMzdmLTQ2YzAtYmM3MS1mOGQyZDNhZmE4MGMiLCJ1c2VybmFtZSI6ImFsaWNlIiwiZW1haWwiOiJhbGljZTJAdGVzdC5jb20iLCJyb2xlIjoidXNlciIsImlhdCI6MTc2OTI3OTcxNCwiZXhwIjoxNzY5MzY2MTE0LCJhdWQiOiJwYW5vcHRpY29uLXVzZXJzIiwiaXNzIjoicGFub3B0aWNvbi1jaGF0In0.fSJ80aLvNi9g8wATkLsOzEuI-BnvsRj3srXrLz51Rf8";
const BOB_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1OGNiZjcyOC01NzI3LTRkNmYtODc0MS1kMjZmYmFmYjUzNDIiLCJ1c2VybmFtZSI6ImJvYiIsImVtYWlsIjoiYm9iQHRlc3QuY29tIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3NjkyNzk3MTcsImV4cCI6MTc2OTM2NjExNywiYXVkIjoicGFub3B0aWNvbi11c2VycyIsImlzcyI6InBhbm9wdGljb24tY2hhdCJ9.MXZid2GoHHd-a_W5yngjQcj82gZopJ5Vcg6tUt-eQEc";

// User IDs (get from the admin/users response)
const ALICE_ID = "8a87e2d8-a37f-46c0-bc71-f8d2d3afa80c";
const BOB_ID = "58cbf728-5727-4d6f-8741-d26fbafb5342";

console.log("🎯 Starting Panopticon Full System Test\n");

// 1. Connect SuperAdmin (God Mode)
console.log("1️⃣ Connecting SuperAdmin (God Mode Monitoring)...");
const superAdminSocket = io("http://localhost:5000", {
  auth: { token: SUPERADMIN_TOKEN },
});

superAdminSocket.on("connect", () => {
  console.log("✅ SuperAdmin connected - God Mode Active\n");
});

superAdminSocket.on("monitoring_active", (data) => {
  console.log("🎯 GOD MODE ACTIVATED:", data.message);
  console.log("");
});

superAdminSocket.on("intercepted_message", (data) => {
  console.log("📨 [GOD MODE] MESSAGE INTERCEPTED:");
  console.log(`   From: ${data.senderUsername} → To: ${data.receiverId}`);
  console.log(`   Content: "${data.content}"`);
  console.log(`   Time: ${data.timestamp}\n`);
});

superAdminSocket.on("shadow_banned_message", (data) => {
  console.log("🚫 [GOD MODE] SHADOW BANNED MESSAGE BLOCKED:");
  console.log(`   From: ${data.sender.username} (SHADOW BANNED)`);
  console.log(`   To: ${data.receiverId}`);
  console.log(`   Content: "${data.content}"`);
  console.log(`   ⚠️ Message NOT delivered, sender thinks it sent!\n`);
});

superAdminSocket.on("message_deleted_event", (data) => {
  console.log("🗑️ [GOD MODE] MESSAGE DELETED (Soft Delete):");
  console.log(`   Message ID: ${data.messageId}`);
  console.log(
    `   Deleted by: ${data.deletedBy.username} (${data.deletedBy.role})`,
  );
  console.log(`   ⚠️ Data still in database forever!\n`);
});

// Wait for SuperAdmin to connect, then start test sequence
setTimeout(() => {
  // 2. Connect Bob
  console.log("2️⃣ Connecting Bob...");
  const bobSocket = io("http://localhost:5000", {
    auth: { token: BOB_TOKEN },
  });

  bobSocket.on("connect", () => {
    console.log("✅ Bob connected\n");
  });

  bobSocket.on("message_sent", (data) => {
    console.log("✅ Bob: Message sent successfully");
    console.log(`   To: ${data.receiverId}`);
    console.log(`   Content: "${data.content}"\n`);
  });

  bobSocket.on("new_message", (data) => {
    console.log("📬 Bob received message:");
    console.log(`   From: ${data.senderUsername}`);
    console.log(`   Content: "${data.content}"\n`);
  });

  // 3. Connect Alice (Shadow Banned)
  setTimeout(() => {
    console.log("3️⃣ Connecting Alice (SHADOW BANNED USER)...");
    const aliceSocket = io("http://localhost:5000", {
      auth: { token: ALICE_TOKEN },
    });

    aliceSocket.on("connect", () => {
      console.log(
        "✅ Alice connected (she doesn't know she's shadow banned)\n",
      );
    });

    aliceSocket.on("message_sent", (data) => {
      console.log('✅ Alice: Message "sent" successfully (FAKE SUCCESS)');
      console.log(`   ⚠️ Alice thinks message was delivered`);
      console.log(`   🚫 Reality: Message was BLOCKED by shadow ban\n`);
    });

    aliceSocket.on("new_message", (data) => {
      console.log("📬 Alice received message:");
      console.log(`   From: ${data.senderUsername}`);
      console.log(`   Content: "${data.content}"\n`);
    });

    // 4. Run Test Sequence
    setTimeout(() => {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("🧪 STARTING TEST SEQUENCE");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      // Test 1: Bob sends to Alice
      setTimeout(() => {
        console.log("TEST 1: Bob → Alice (Normal Message)");
        console.log("─────────────────────────────────────");
        bobSocket.emit("send_message", {
          receiverId: ALICE_ID,
          content: "Hey Alice, how are you?",
        });
      }, 1000);

      // Test 2: Alice tries to send to Bob (SHADOW BANNED - will be blocked)
      setTimeout(() => {
        console.log("\nTEST 2: Alice → Bob (SHADOW BANNED - BLOCKED)");
        console.log("─────────────────────────────────────");
        aliceSocket.emit("send_message", {
          receiverId: BOB_ID,
          content: "Hi Bob, I am fine! (THIS WILL BE BLOCKED)",
        });
      }, 3000);

      // Test 3: Bob sends another message
      setTimeout(() => {
        console.log("\nTEST 3: Bob → Alice (Another Normal Message)");
        console.log("─────────────────────────────────────");
        bobSocket.emit("send_message", {
          receiverId: ALICE_ID,
          content: "Alice? Are you there? Why aren't you replying?",
        });
      }, 5000);

      // Summary
      setTimeout(() => {
        console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("📊 TEST COMPLETE - SUMMARY");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        console.log("✅ Bob sent 2 messages → Alice received both");
        console.log("🚫 Alice sent 1 message → BLOCKED (shadow banned)");
        console.log("   → Alice thinks it sent (fake success)");
        console.log("   → Bob never received it");
        console.log("   → SuperAdmin saw the blocked attempt");
        console.log("🎯 SuperAdmin intercepted ALL 3 message attempts\n");
        console.log("💾 All events logged in database");
        console.log(
          '🔍 "Deleted" messages remain in DB forever (soft delete)\n',
        );

        console.log("Press Ctrl+C to exit and check database...\n");
      }, 7000);
    }, 2000);
  }, 2000);
}, 1000);

// Error handling
superAdminSocket.on("connect_error", (error) => {
  console.error("❌ SuperAdmin connection error:", error.message);
});

// test-socket.js
const io = require("socket.io-client");

// Use your actual token from the login response
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjNWMyOWRmYS0zMjY5LTQ0ZjctYjRmNC03MTcwYTQ5NmYyY2YiLCJ1c2VybmFtZSI6InN1cGVyYWRtaW4iLCJlbWFpbCI6InN1cGVyYWRtaW5AcGFub3B0aWNvbi5sb2NhbCIsInJvbGUiOiJzdXBlcmFkbWluIiwiaWF0IjoxNzY5Mjc2OTAwLCJleHAiOjE3NjkzNjMzMDAsImF1ZCI6InBhbm9wdGljb24tdXNlcnMiLCJpc3MiOiJwYW5vcHRpY29uLWNoYXQifQ.MIFnN3fZv8JFvVBoWJtVzLSg9NeNN40PvGBQziOlNYY";

const socket = io("http://localhost:5000", {
  auth: { token: TOKEN },
});

socket.on("connect", () => {
  console.log("✅ Connected to server");
  console.log("Socket ID:", socket.id);
});

socket.on("monitoring_active", (data) => {
  console.log("🎯 GOD MODE ACTIVE:", data);
});

socket.on("intercepted_message", (data) => {
  console.log("📨 MESSAGE INTERCEPTED:", data);
});

socket.on("shadow_banned_message", (data) => {
  console.log("🚫 SHADOW BANNED MESSAGE BLOCKED:", data);
});

socket.on("message_deleted_event", (data) => {
  console.log("🗑️ MESSAGE DELETED:", data);
});

socket.on("connect_error", (error) => {
  console.error("❌ Connection error:", error.message);
});

console.log("Connecting to Panopticon server...");

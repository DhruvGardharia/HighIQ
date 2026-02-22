const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

/**
 * Send SMS notification to p1 when p2 comes online
 */
async function notifyP1Online() {
  console.log("[SMS] Attempting to send notification...");
  console.log("[SMS] From:", process.env.TWILIO_PHONE_NUMBER);
  console.log("[SMS] To:", process.env.SMS_TO);

  try {
    const message = await client.messages.create({
      body: `[NOTICE] Secondary subsystem node is now online.\n\nTimestamp: ${new Date().toISOString()}\n\n-- Internal diagnostic service`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.SMS_TO,
    });

    console.log("[SMS] Message sent successfully:", message.sid);
    return true;
  } catch (err) {
    console.error("[SMS] Failed to send notification:", err.message);
    console.error("[SMS] Full error:", err);
    return false;
  }
}

module.exports = { notifyP1Online };

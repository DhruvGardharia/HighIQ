const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

/**
 * Send WhatsApp notification to p1 when p2 comes online
 */
async function notifyP1Online() {
  console.log("[WhatsApp] Attempting to send notification...");
  console.log("[WhatsApp] From:", `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`);
  console.log("[WhatsApp] To:", `whatsapp:${process.env.WHATSAPP_TO}`);

  try {
    const message = await client.messages.create({
      body: `[NOTICE] Secondary subsystem node is now online.\n\nTimestamp: ${new Date().toISOString()}\n\n-- Internal diagnostic service`,
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: `whatsapp:${process.env.WHATSAPP_TO}`,
    });

    console.log("[WhatsApp] Message sent successfully:", message.sid);
    return true;
  } catch (err) {
    console.error("[WhatsApp] Failed to send notification:", err.message);
    console.error("[WhatsApp] Full error:", err);
    return false;
  }
}

module.exports = { notifyP1Online };

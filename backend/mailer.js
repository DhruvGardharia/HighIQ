const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

/**
 * Send notification to p1 when p2 comes online
 */
async function notifyP1Online() {
  const mailOptions = {
    from: process.env.MAIL_USER,
    to: process.env.MAIL_TO,
    subject: "[SYSTEM] Secondary node connected",
    text: `[NOTICE] Secondary subsystem node is now online.\n\nTimestamp: ${new Date().toISOString()}\n\n-- Internal diagnostic service`
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error("[MAILER] Failed to send notification:", err.message);
    return false;
  }
}

module.exports = { notifyP1Online };

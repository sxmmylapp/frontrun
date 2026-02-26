import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.warn('[Twilio] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — SMS will be skipped');
}

export const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null;
export const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? '';

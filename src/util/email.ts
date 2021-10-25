export const msg_signup = {
  to: 'test@example.com', // Change to your recipient
  from: process.env.FROM_EMAIL||'test@example.com', // Change to your verified sender
  subject: 'Thanks for signing up',
  text: 'welcome email',
  html: '<strong>welcome</strong>',
}
export const msg_reset = {
  to: 'test@example.com', // Change to your recipient
  from: process.env.FROM_EMAIL||'test@example.com', // Change to your verified sender
  subject: 'your reset token valid for 10min',
  text: 'reset token',
  html: '<strong>welcome</strong>',
}
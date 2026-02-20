// App version - update on each deploy
// Sourced from package.json version at build time via next.config
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'v1.0.0';

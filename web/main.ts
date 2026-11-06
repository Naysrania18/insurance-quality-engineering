import { createWebApp } from './server.js';

const port = Number(process.env.PORT ?? 3000);
createWebApp({
  quoteUrl: process.env.QUOTE_URL ?? 'http://localhost:3001',
  policyUrl: process.env.POLICY_URL ?? 'http://localhost:3002',
  claimsUrl: process.env.CLAIMS_URL ?? 'http://localhost:3003',
}).listen(port, '0.0.0.0', () => console.log(`web listening on ${port}`));

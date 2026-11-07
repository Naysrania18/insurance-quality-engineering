// Load test: steady, expected traffic. Run: k6 run performance/load.js  (SCALE=0.2 for a short run)
import { sleep } from 'k6';
import { claimJourney, quoteJourney, setupPolicy, stage } from './lib.js';

export const options = {
  scenarios: {
    quotes: {
      executor: 'ramping-vus',
      exec: 'quotes',
      stages: [stage(20, 10), stage(60, 10), stage(10, 0)],
    },
    claims: {
      executor: 'ramping-vus',
      exec: 'claims',
      stages: [stage(20, 5), stage(60, 5), stage(10, 0)],
    },
  },
  thresholds: {
    // Quality gate: the build fails when any of these is breached.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{scenario:quotes}': ['p(95)<500'],
    'http_req_duration{scenario:claims}': ['p(95)<600'],
    checks: ['rate>0.99'],
  },
};

export const setup = setupPolicy;
export function quotes(data) {
  quoteJourney(data);
  sleep(0.5);
}
export function claims(data) {
  claimJourney(data);
  sleep(0.5);
}

// Spike test: sudden surge (e.g. a broker batch upload) then recovery.
import { sleep } from 'k6';
import { claimJourney, quoteJourney, setupPolicy, stage } from './lib.js';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      stages: [stage(10, 5), stage(5, 80), stage(20, 80), stage(5, 5), stage(20, 5), stage(5, 0)],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2500'],
    checks: ['rate>0.95'],
  },
};

export const setup = setupPolicy;
export default function (data) {
  if (Math.random() < 0.7) quoteJourney(data);
  else claimJourney(data);
  sleep(0.1);
}

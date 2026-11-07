// Stress test: ramp beyond expected load to find where latency/errors start to degrade.
import { sleep } from 'k6';
import { claimJourney, quoteJourney, setupPolicy, stage } from './lib.js';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      stages: [stage(20, 10), stage(30, 30), stage(30, 60), stage(30, 100), stage(20, 0)],
    },
  },
  thresholds: {
    // Looser than load: we expect degradation, but not collapse.
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.95'],
  },
};

export const setup = setupPolicy;
export default function (data) {
  if (Math.random() < 0.6) quoteJourney(data);
  else claimJourney(data);
  sleep(0.2);
}

import { ApiError } from '../../../shared/src/errors.js';

export interface PolicySummary {
  id: string;
  policyRef: string;
  status: string;
  sumInsuredCents: number;
}

export interface PolicyClient {
  getPolicy(id: string): Promise<PolicySummary | null>;
}

/** HTTP consumer of the policy-service contract (see tests/contract). */
export class HttpPolicyClient implements PolicyClient {
  constructor(
    private baseUrl: string,
    private timeoutMs = Number(process.env.POLICY_TIMEOUT_MS ?? 2000),
  ) {}

  async getPolicy(id: string): Promise<PolicySummary | null> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/policies/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ApiError(503, 'policy_service_unavailable', 'Policy service did not respond');
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new ApiError(
        503,
        'policy_service_unavailable',
        `Policy service returned ${res.status}`,
      );
    }
    const p = (await res.json()) as PolicySummary;
    return {
      id: p.id,
      policyRef: p.policyRef,
      status: p.status,
      sumInsuredCents: p.sumInsuredCents,
    };
  }
}

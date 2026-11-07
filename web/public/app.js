/* Minimal broker / underwriter / claims UI. Money is cents on the wire, dollars on screen. */
const $ = (id) => document.getElementById(id);
const usd = (cents) => (cents == null ? '-' : (cents / 100).toFixed(2));
const toCents = (v) => Math.round(Number(v) * 100);

async function api(path, method = 'GET', body) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return data;
}

function say(text, kind = 'ok') {
  const el = $('message');
  el.textContent = text;
  el.className = kind;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

async function guarded(fn) {
  try {
    await fn();
  } catch (e) {
    say(e.message, 'error');
  }
}

document.querySelectorAll('nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button, section').forEach((e) => e.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
    refresh();
  });
});

async function refresh() {
  await guarded(async () => {
    const [brokers, submitted, allQuotes, policies, claims] = await Promise.all([
      api('quote/brokers'),
      api('quote/risks?status=SUBMITTED'),
      api('quote/quotes'),
      api('policy/policies'),
      api('claims/claims'),
    ]);
    const current = $('broker-select').value;
    $('broker-select').innerHTML = brokers
      .map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`)
      .join('');
    if (current) $('broker-select').value = current;

    $('submitted-body').innerHTML = submitted
      .map(
        (r) => `<tr data-testid="risk-row-${r.id}"><td>${escapeHtml(r.description)}</td>
          <td>${r.riskType}</td><td>${usd(r.insuredValueCents)}</td>
          <td><button data-testid="quote-btn-${r.id}" data-risk="${r.id}" class="quote-btn">Quote</button></td></tr>`,
      )
      .join('');
    $('quoted-body').innerHTML = allQuotes
      .filter((q) => q.status === 'QUOTED')
      .map(
        (
          q,
        ) => `<tr data-testid="quote-row-${q.id}"><td>${q.id.slice(0, 8)}</td><td>${usd(q.premiumCents)}</td>
          <td><button data-testid="bind-btn-${q.id}" data-quote="${q.id}" class="bind-btn">Bind</button></td></tr>`,
      )
      .join('');
    $('policies-body').innerHTML = policies
      .map(
        (
          p,
        ) => `<tr data-testid="policy-row-${p.id}"><td>${p.policyRef}</td><td>${usd(p.totalPremiumCents)}</td>
          <td>${p.shares.map((s) => `${escapeHtml(s.insurer)} ${(s.bps / 100).toFixed(2)}% = ${usd(s.amountCents)}`).join('<br>')}</td></tr>`,
      )
      .join('');
    $('claim-policy').innerHTML = policies
      .map((p) => `<option value="${p.id}">${p.policyRef}</option>`)
      .join('');
    $('claims-body').innerHTML = claims
      .map((c) => {
        const action =
          c.status === 'NOTIFIED'
            ? `<button class="assess-btn" data-testid="assess-btn-${c.id}" data-claim="${c.id}" data-amount="${c.amountClaimedCents}">Assess in full</button>`
            : c.status === 'ASSESSED'
              ? `<button class="settle-btn" data-testid="settle-btn-${c.id}" data-claim="${c.id}" data-amount="${c.assessedCents}">Settle</button>`
              : '';
        return `<tr data-testid="claim-row-${c.id}"><td>${c.claimRef}</td>
          <td data-testid="claim-status-${c.id}">${c.status}</td><td>${usd(c.amountClaimedCents)}</td>
          <td>${usd(c.assessedCents)}</td><td>${usd(c.settledCents)}</td><td>${action}</td></tr>`;
      })
      .join('');
  });
}

$('submit-risk').addEventListener('click', () =>
  guarded(async () => {
    const risk = await api('quote/risks', 'POST', {
      brokerId: $('broker-select').value,
      riskType: $('risk-type').value,
      insuredValueCents: toCents($('insured-value').value),
      description: $('risk-description').value,
    });
    say(`Risk submitted: ${risk.id}`);
    await refresh();
  }),
);

$('submit-claim').addEventListener('click', () =>
  guarded(async () => {
    const claim = await api('claims/claims', 'POST', {
      policyId: $('claim-policy').value,
      lossDate: $('loss-date').value,
      amountClaimedCents: toCents($('claim-amount').value),
      description: $('claim-description').value,
    });
    say(`Claim notified: ${claim.claimRef}`);
    await refresh();
  }),
);

document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.classList.contains('quote-btn')) {
    guarded(async () => {
      const q = await api(`quote/risks/${t.dataset.risk}/quote`, 'POST');
      say(`Quote created: ${q.id}`);
      await refresh();
    });
  } else if (t.classList.contains('bind-btn')) {
    guarded(async () => {
      const p = await api('policy/policies', 'POST', { quoteId: t.dataset.quote });
      say(`Policy bound: ${p.policyRef}`);
      await refresh();
    });
  } else if (t.classList.contains('assess-btn')) {
    guarded(async () => {
      await api(`claims/claims/${t.dataset.claim}/assess`, 'POST', {
        assessedCents: Number(t.dataset.amount),
      });
      say('Claim assessed');
      await refresh();
    });
  } else if (t.classList.contains('settle-btn')) {
    guarded(async () => {
      await api(`claims/claims/${t.dataset.claim}/settle`, 'POST', {
        settledCents: Number(t.dataset.amount),
      });
      say('Claim settled');
      await refresh();
    });
  }
});

refresh();

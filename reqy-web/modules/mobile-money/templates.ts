/**
 * Mobile Money callback TEMPLATE SENDER.
 *
 * ⚠️ SHAPE VALIDATION REQUIRED BEFORE PRODUCTION (ASSUMPTIONS AHEAD) ⚠️
 * -------------------------------------------------------------------------
 * The JSON shapes below are *plausible approximations* of each provider's
 * official callback / webhook payload, built from public documentation and
 * common practice (MTN MoMo ~2024, FedaPay / Kkiapay webhooks). This code
 * cannot browse the network, so these are STARTING POINTS, not gospel.
 *
 * Before any real use, validate each shape against the OFFICIAL source:
 *   - MTN MoMo (Collections & Disbursement):
 *       https://momodeveloper.mtn.com/  (Subscription / Collection / Transfer
 *       webhook notification schemas)
 *   - FedaPay:  https://docs.fedapay.com/api/webhooks  (transaction webhook)
 *   - Kkiapay:  https://docs.kkiapay.me/documentation/webhooks  (transaction)
 *
 * Known assumptions / things to double-check:
 *   - MTN status vocabulary here assumes SUCCESSFUL / FAILED / TIMEOUT.
 *     Real MTN also uses PENDING; the timeout case may instead arrive as a
 *     final FAILED with a timeout reason in production.
 *   - FedaPay webhook is modelled as { id, event, data: { status, ... } };
 *     the live envelope and `event` naming may differ by version.
 *   - Kkiapay fields (transaction_id, method, wallet, external_id) are
 *     illustrative; confirm exact keys + whether `status` or
 *     `transaction_status` is the canonical field.
 */

export type MomoProvider = "mtn-momo-collections" | "mtn-momo-disbursement" | "fedapay" | "kkiapay";

export type MomoScenario = "success" | "failure" | "timeout";

/**
 * Build a plausible provider-shaped callback payload for a given scenario.
 * This is a TEMPLATE (not a real provider callback) — it represents the JSON
 * each provider would POST to a user-provided callback URL.
 */
export function buildCallbackPayload(
  provider: MomoProvider,
  scenario: MomoScenario,
): Record<string, unknown> {
  switch (provider) {
    case "mtn-momo-collections":
      return mtnCollections(scenario);
    case "mtn-momo-disbursement":
      return mtnDisbursement(scenario);
    case "fedapay":
      return fedapay(scenario);
    case "kkiapay":
      return kkiapay(scenario);
  }
}

/** POST a JSON payload to a user-provided URL. Returns the HTTP status. */
export async function sendCallbackPayload(
  url: string,
  payload: unknown,
): Promise<{ status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status };
}

/** MTN MoMo Collections (RequestToPay → collection) notification shape. */
function mtnCollections(scenario: MomoScenario): Record<string, unknown> {
  const base = {
    eventType: "collection",
    amount: "1000",
    currency: "EUR",
    externalId: "ext-col-0001",
    payer: { partyIdType: "MSISDN", partyId: "46733123450" },
    financialTransactionId: "ftx-col-8841",
  };
  if (scenario === "success") {
    return { ...base, status: "SUCCESSFUL", reason: { code: "0", message: "Success" } };
  }
  if (scenario === "failure") {
    return {
      ...base,
      status: "FAILED",
      reason: { code: "101", message: "Not enough funds" },
    };
  }
  return {
    ...base,
    status: "TIMEOUT",
    reason: { code: "102", message: "Transaction timed out" },
  };
}

/** MTN MoMo Disbursement (Transfer) notification shape — note `payee`. */
function mtnDisbursement(scenario: MomoScenario): Record<string, unknown> {
  const base = {
    eventType: "disbursement",
    amount: "500",
    currency: "EUR",
    externalId: "ext-disb-0002",
    payee: { partyIdType: "MSISDN", partyId: "46733223451" },
    financialTransactionId: "ftx-disb-7732",
  };
  if (scenario === "success") {
    return { ...base, status: "SUCCESSFUL", reason: { code: "0", message: "Success" } };
  }
  if (scenario === "failure") {
    return {
      ...base,
      status: "FAILED",
      reason: { code: "103", message: "Payee account locked" },
    };
  }
  return {
    ...base,
    status: "TIMEOUT",
    reason: { code: "102", message: "Transaction timed out" },
  };
}

/** FedaPay transaction webhook shape (envelope + data.status). */
function fedapay(scenario: MomoScenario): Record<string, unknown> {
  const statusMap = { success: "approved", failure: "declined", timeout: "expired" } as const;
  const eventMap = {
    success: "transaction.approved",
    failure: "transaction.declined",
    timeout: "transaction.expired",
  } as const;
  const status = statusMap[scenario];
  const reason =
    scenario === "success"
      ? null
      : scenario === "failure"
        ? "Insufficient balance"
        : "Payment window expired";
  return {
    id: 991122,
    event: eventMap[scenario],
    data: {
      id: 991122,
      status,
      amount: 1000,
      currency: "XOF",
      reference: "ref-fdp-0003",
      reason,
      customer: {
        id: 55,
        firstname: "Awa",
        lastname: "Diallo",
        email: "awa@example.com",
        phone: "+22997000000",
      },
      mode: "momo",
      created_at: "2025-01-01T12:00:00Z",
      updated_at: "2025-01-01T12:01:00Z",
    },
  };
}

/** Kkiapay transaction webhook shape. */
function kkiapay(scenario: MomoScenario): Record<string, unknown> {
  const statusMap = { success: "SUCCESSFUL", failure: "FAILED", timeout: "PENDING" } as const;
  const reason =
    scenario === "success"
      ? "Paiement réussi"
      : scenario === "failure"
        ? "Fonds insuffisants"
        : "En attente / expiré";
  return {
    transaction_id: "tx-kk-0004",
    amount: 1000,
    currency: "XOF",
    status: statusMap[scenario],
    reason,
    phone: "+22997000000",
    method: "momo",
    external_id: "ext-kk-0004",
    wallet: "WALLET_MOMO",
  };
}

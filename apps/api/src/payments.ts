// Stripe adapter (v7, ADR-028): the only place that talks to Stripe. Checkout Sessions on Stripe's
// hosted page, refunds, webhook signature checks. Test mode only. Tests replace the methods of
// `payments`, so they never call Stripe.

import { env } from "cloudflare:workers";
import Stripe from "stripe";
import { HttpError } from "./errors";

export interface CheckoutLine {
  name: string;
  /** Unit price in minor units of the currency (euro cents). */
  unitAmount: number;
  quantity: number;
}

export interface CheckoutRequest {
  orderId: string;
  reservationId: string;
  currency: string;
  lines: CheckoutLine[];
  successUrl: string;
  cancelUrl: string;
  /** Stripe's page language; Stripe has no Ukrainian, so "auto" (the browser's language) there. */
  locale: "en" | "ru" | "auto";
  expiresAt: Date;
}

export interface CheckoutState {
  id: string;
  status: "open" | "complete" | "expired";
  paid: boolean;
  paymentIntentId: string | null;
  orderId: string | null;
}

/** A webhook event reduced to what the API handles. */
export type PaymentEvent =
  | { kind: "completed"; session: CheckoutState }
  | { kind: "expired"; session: CheckoutState }
  | { kind: "ignored"; type: string };

/** The café's name on Stripe's page; the sandbox's own name cannot be changed (v7 R1). */
const DISPLAY_NAME = "Linden Coffee";

const unavailable = (message: string) => new HttpError(503, "PAYMENTS_UNAVAILABLE", message);

/** A client for the test-mode key, or PAYMENTS_UNAVAILABLE: the demo never takes real money (P2). */
function client(): Stripe {
  const key = env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) throw unavailable("Payments are not configured.");
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

function toState(session: Stripe.Checkout.Session): CheckoutState {
  const intent = session.payment_intent;
  return {
    id: session.id,
    status: session.status === "complete" ? "complete" : session.status === "expired" ? "expired" : "open",
    paid: session.payment_status === "paid",
    paymentIntentId: typeof intent === "string" ? intent : (intent?.id ?? null),
    orderId: session.metadata?.order_id ?? null,
  };
}

export const payments = {
  async createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }> {
    try {
      const session = await client().checkout.sessions.create({
        mode: "payment",
        line_items: req.lines.map((line) => ({
          quantity: line.quantity,
          price_data: { currency: req.currency, unit_amount: line.unitAmount, product_data: { name: line.name } },
        })),
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        locale: req.locale,
        expires_at: Math.floor(req.expiresAt.getTime() / 1000),
        client_reference_id: req.reservationId,
        metadata: { order_id: req.orderId, reservation_id: req.reservationId },
        // One amount in euros, no conversion offered by Stripe (v7 R1).
        adaptive_pricing: { enabled: false },
        branding_settings: { display_name: DISPLAY_NAME },
      });
      if (!session.url) throw new Error("Stripe returned no URL");
      return { id: session.id, url: session.url };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("Stripe checkout failed:", error instanceof Error ? error.message : error);
      throw unavailable("The payment page could not be opened. Try again later.");
    }
  },

  async retrieveCheckout(id: string): Promise<CheckoutState> {
    return toState(await client().checkout.sessions.retrieve(id));
  },

  /** Best effort: an old session should not be payable once the guest started a new one. */
  async expireCheckout(id: string): Promise<void> {
    await client().checkout.sessions.expire(id);
  },

  async refund(paymentIntentId: string, orderId: string): Promise<{ id: string }> {
    // The webhook and the return check can both refund one order; the key makes the second a no-op.
    const refund = await client().refunds.create(
      { payment_intent: paymentIntentId, reason: "requested_by_customer", metadata: { order_id: orderId } },
      { idempotencyKey: `refund-${orderId}` },
    );
    return { id: refund.id };
  },

  /** Checks the Stripe-Signature header (Web Crypto, as Workers need) and reduces the event. */
  async verifyWebhook(body: string, signature: string | undefined): Promise<PaymentEvent> {
    const secret = env.STRIPE_WEBHOOK_SECRET ?? "";
    if (!secret || !signature) throw new HttpError(400, "WEBHOOK_SIGNATURE", "Missing webhook signature.");
    let event: Stripe.Event;
    try {
      event = await Stripe.webhooks.constructEventAsync(body, signature, secret, undefined, Stripe.createSubtleCryptoProvider());
    } catch {
      throw new HttpError(400, "WEBHOOK_SIGNATURE", "Invalid webhook signature.");
    }
    if (event.type === "checkout.session.completed") return { kind: "completed", session: toState(event.data.object) };
    if (event.type === "checkout.session.expired") return { kind: "expired", session: toState(event.data.object) };
    return { kind: "ignored", type: event.type };
  },
};

import { describe, expect, it } from "vitest";
import { evaluateTriagePreflight } from "./triage-preflight.ts";

const baseEmail = {
  user_id: "user-1",
  account_id: "gmail-work",
  from_name: "Example",
  from_address: "sender@example.com",
  subject: "",
  body_snippet: "",
  body_text: "",
};

function email(overrides = {}) {
  return { ...baseEmail, ...overrides };
}

describe("triage preflight engine", () => {
  it("finalizes low-risk FYI and noise rules without broad full-text any_includes", () => {
    const delivery = evaluateTriagePreflight(email({
      from_name: "USPS Informed Delivery",
      from_address: "informeddelivery@usps.com",
      subject: "Your Daily Digest for May 5",
      body_snippet: "Mail and packages arriving soon.",
      body_text: "This message contains an unsubscribe footer but no action.",
    }));

    expect(delivery).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "delivery",
      reasonCode: "delivery_digest_fyi",
      matchedRuleKey: "default_delivery_digest_fyi",
      riskOverride: false,
      modelTier: null,
    });

    const marketing = evaluateTriagePreflight(email({
      from_name: "UNIQLO",
      from_address: "news@uniqlo.example",
      subject: "Limited time offer: extra 40% off",
      body_snippet: "Shop the new collection.",
      body_text: "Order confirmation language appears in old footer text.",
    }));

    expect(marketing).toMatchObject({
      action: "finalize",
      lane: "noise",
      category: "marketing",
      reasonCode: "marketing_noise",
      riskOverride: false,
    });
  });

  it("routes hard risk before low-risk finalization", () => {
    const result = evaluateTriagePreflight(email({
      from_name: "Utility Billing",
      from_address: "billing@utility.example",
      subject: "Low balance may interrupt service",
      body_snippet: "Your balance is low and service may be interrupted.",
      body_text: "Sale and unsubscribe footer text should not override the risk.",
    }));

    expect(result).toMatchObject({
      action: "route_model",
      modelTier: "strong",
      riskOverride: true,
      reasonCode: "hard_risk_override",
    });
  });

  it("allows exact scoped rules to define explicit hard-risk exclusions", () => {
    const result = evaluateTriagePreflight(email({
      from_name: "Trusted Utility",
      from_address: "billing@utility.example",
      subject: "Payment due reminder covered by autopay",
      body_snippet: "Your payment due will be paid automatically by autopay on May 8.",
    }), {
      includeDefaults: false,
      rules: [{
        key: "trusted_autopay_due_fyi",
        priority: 1,
        match_json: {
          mode: "finalize",
          from_addresses: ["billing@utility.example"],
          subject_regex: "payment due",
          snippet_includes: ["autopay", "automatically"],
          hard_risk_exclusions: ["paid automatically by autopay"],
          reason_code: "autopay_due_covered_fyi",
        },
        lane: "fyi",
        category: "finance",
        urgency: "low",
        confidence: 0.9,
      }],
    });

    expect(result).toMatchObject({
      action: "finalize",
      lane: "fyi",
      reasonCode: "autopay_due_covered_fyi",
      riskOverride: false,
      matchedRuleKey: "trusted_autopay_due_fyi",
    });
  });

  it("supports audit profiles without finalizing the lane", () => {
    const result = evaluateTriagePreflight(email({
      from_name: "Trusted Vendor",
      from_address: "alerts@vendor.example",
      subject: "Package status update",
      body_snippet: "Your package is on the way.",
    }), {
      rules: [{
        id: 42,
        name: "Trusted vendor FYI audit",
        priority: 5,
        rule_type: "sender_domain",
        match_json: JSON.stringify({
          mode: "audit",
          from_domain_suffixes: ["vendor.example"],
          subject_regex: "package status",
          reason_code: "trusted_vendor_audit",
        }),
        lane: "fyi",
        category: "delivery",
        urgency: "low",
        confidence: 0.91,
        reason: "Trusted delivery notification.",
      }],
      includeDefaults: false,
    });

    expect(result).toMatchObject({
      action: "audit",
      lane: "fyi",
      category: "delivery",
      reasonCode: "trusted_vendor_audit",
      matchedRuleKey: "db_rule_42",
      modelTier: "cheap",
    });
  });

  it("returns one-time weak-security grace candidates separately from OTP noise", () => {
    const weak = evaluateTriagePreflight(email({
      from_name: "Account Security",
      from_address: "security@example.com",
      subject: "New sign-in to your account",
      body_snippet: "We noticed a sign-in from Chrome on macOS.",
    }));

    expect(weak).toMatchObject({
      action: "grace",
      lane: null,
      category: "security",
      reasonCode: "weak_security_grace",
      matchedRuleKey: "default_weak_security_grace",
    });

    const otp = evaluateTriagePreflight(email({
      from_name: "Account Security",
      from_address: "security@example.com",
      subject: "Your verification code is 123456",
      body_snippet: "Enter this one-time code to continue.",
    }));

    expect(otp).toMatchObject({
      action: "finalize",
      lane: "noise",
      reasonCode: "verification_code_noise",
    });
  });

  it("promotes safe Noise candidates to FYI only when an interest matches the sender scope", () => {
    const promoted = evaluateTriagePreflight(email({
      from_name: "Da Vien Coffee",
      from_address: "offers@davien.example",
      subject: "BOGO drinks this weekend",
      body_snippet: "Rewards members get a free drink.",
    }), {
      emailInterests: ["Da Vien"],
    });

    expect(promoted).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "updates",
      reasonCode: "email_interest_promoted_noise_to_fyi",
      matchedInterest: "Da Vien",
      modelSaved: true,
      interestPromotion: {
        originalLane: "noise",
        originalReasonCode: "marketing_noise",
        originalMatchedRuleKey: "default_retail_menu_marketing_noise",
      },
    });

    const unrelatedSender = evaluateTriagePreflight(email({
      from_name: "Retail Weekly",
      from_address: "offers@retail.example",
      subject: "Da Vien BOGO drinks this weekend",
      body_snippet: "A partner promo mentions Da Vien in the subject.",
    }), {
      emailInterests: ["Da Vien"],
    });

    expect(unrelatedSender).toMatchObject({
      action: "finalize",
      lane: "noise",
      reasonCode: "marketing_noise",
    });
    expect(unrelatedSender.matchedInterest).toBeNull();
  });

  it("does not let email interests override hard risk, grace, or model-routing mail", () => {
    const hardRisk = evaluateTriagePreflight(email({
      from_name: "Da Vien Coffee",
      from_address: "billing@davien.example",
      subject: "Payment due",
      body_snippet: "Your payment due notice needs review.",
    }), {
      emailInterests: ["Da Vien"],
    });
    expect(hardRisk).toMatchObject({
      action: "route_model",
      modelTier: "strong",
      reasonCode: "hard_risk_override",
      matchedInterest: null,
    });

    const grace = evaluateTriagePreflight(email({
      from_name: "Da Vien Coffee",
      from_address: "security@davien.example",
      subject: "New sign-in to your account",
      body_snippet: "We noticed a sign-in from Chrome on macOS.",
    }), {
      emailInterests: ["Da Vien"],
    });
    expect(grace).toMatchObject({
      action: "grace",
      reasonCode: "weak_security_grace",
      matchedInterest: null,
    });

    const senderInterest = evaluateTriagePreflight(email({
      from_name: "Da Vien Coffee",
      from_address: "hello@davien.example",
      subject: "A normal update",
      body_snippet: "Thanks for stopping by.",
    }), {
      emailInterests: ["Da Vien"],
    });
    expect(senderInterest).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "updates",
      reasonCode: "email_interest_sender_fyi",
      matchedInterest: "Da Vien",
    });
  });

  it("finalizes first-wave delivery, onboarding, school, and infra profiles with scoped senders", () => {
    expect(evaluateTriagePreflight(email({
      from_name: "USPS",
      from_address: "auto-reply@usps.com",
      subject: "USPS Expected Delivery by Friday, March 20, 2026 arriving by 9:00pm",
    }))).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "delivery",
      reasonCode: "delivery_digest_fyi",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Linear",
      from_address: "hello@linear.app",
      subject: "Welcome to Linear",
      body_snippet: "Start by creating your first workspace.",
    }))).toMatchObject({
      action: "finalize",
      lane: "noise",
      reasonCode: "linear_onboarding_noise",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Course_Evaluations",
      from_address: "course_evaluations@calstatela.edu",
      subject: "Course Evaluations Now Available",
    }))).toMatchObject({
      action: "finalize",
      lane: "noise",
      category: "school",
      reasonCode: "course_evaluation_noise",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Render",
      from_address: "notify@render.com",
      subject: "Server failure detected on Course Task Manager",
    }))).toMatchObject({
      action: "finalize",
      lane: "needs_attention",
      category: "infra",
      reasonCode: "infra_service_failure_needs_attention",
    });
  });

  it("handles first-wave commerce and finance profiles with audit and hidden metadata", () => {
    expect(evaluateTriagePreflight(email({
      from_name: "Amazon.com",
      from_address: "return@amazon.com",
      subject: "Dropoff confirmed for Zacurate 500C Elite Fingertip",
    }))).toMatchObject({
      action: "finalize",
      lane: "fyi",
      reasonCode: "amazon_return_confirmation_fyi",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Amazon.com",
      from_address: "return@amazon.com",
      subject: "Return reminder for Zacurate 500C Elite Fingertip",
    }))).toMatchObject({
      action: "audit",
      lane: "fyi",
      reasonCode: "amazon_return_audit",
      modelTier: "cheap",
    });

    const citi = evaluateTriagePreflight(email({
      from_name: "Citi Alerts",
      from_address: "alerts@info6.citi.com",
      subject: "A $44.72 transaction was made on your Costco Anywhere account",
    }));
    expect(citi).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "finance",
      reasonCode: "finance_transaction_fyi",
      metadata: {
        finance_candidate: true,
        finance_candidate_kind: "card_transaction",
      },
    });

    expect(evaluateTriagePreflight(email({
      from_name: "PayPal",
      from_address: "service@paypal.com",
      subject: "Your payment method has expired",
    }))).toMatchObject({
      action: "finalize",
      lane: "needs_attention",
      category: "finance",
      decisionAction: "Update payment method",
      reasonCode: "payment_method_expired_needs_attention",
    });
  });

  it("finalizes third-pass exact-profile FYI and Noise candidates without model spend", () => {
    expect(evaluateTriagePreflight(email({
      from_name: "SoFi",
      from_address: "statements@sofi.com",
      subject: "Your SoFi Credit Card payment is due on May 05, 2026",
      body_snippet: "Your statement balance of $156.98 is due May 5, 2026. You're enrolled in autopay.",
    }))).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "finance",
      reasonCode: "autopay_due_covered_fyi",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "PayPal",
      from_address: "service@paypal.com",
      subject: "Mercari: $9.06 USD",
    }))).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "finance",
      reasonCode: "finance_transaction_fyi",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "OpenAI",
      from_address: "news@openai.com",
      subject: "OpenAI Dev News: GPT-5.4, Plugins in Codex, and other fun things",
    }))).toMatchObject({
      action: "finalize",
      lane: "noise",
      category: "product",
      reasonCode: "vendor_product_newsletter_noise",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Strava",
      from_address: "mail@strava.com",
      subject: "Conway is now following you on Strava.",
    }))).toMatchObject({
      action: "finalize",
      lane: "noise",
      category: "social",
      reasonCode: "social_notification_noise",
    });
  });

  it("finalizes third-pass school and domain-renewal action profiles with scoped senders", () => {
    expect(evaluateTriagePreflight(email({
      from_name: "Commencement",
      from_address: "commencement@calstatela.edu",
      subject: "Cal State LA Commencement: Register and reserve your guest tickets!",
      body_snippet: "Registering and reserving guest tickets is now available.",
    }))).toMatchObject({
      action: "finalize",
      lane: "needs_attention",
      category: "school",
      decisionAction: "Register for commencement",
      reasonCode: "commencement_registration_needs_attention",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Scheduling Support",
      from_address: "scheduling@calstatela.edu",
      subject: "Final Exam Schedule Available in GET",
      body_snippet: "The final exam schedule for this semester is now published in GET.",
    }))).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "school",
      reasonCode: "school_schedule_fyi",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "DotTech Domains",
      from_address: "renewals@radix.email",
      subject: "Consolidated Renewal Reminder",
      body_snippet: "Some of your orders are expiring soon. Renew them now.",
    }))).toMatchObject({
      action: "finalize",
      lane: "needs_attention",
      category: "infra",
      decisionAction: "Review domain renewal",
      reasonCode: "domain_renewal_needs_attention",
    });
  });

  it("keeps third-pass escape cases on the model path", () => {
    expect(evaluateTriagePreflight(email({
      from_name: "SoFi",
      from_address: "alerts@sofi.com",
      subject: "Your SoFi Credit Card payment failed",
      body_snippet: "Your autopay payment failed and your payment is past due.",
    }))).toMatchObject({
      action: "route_model",
      modelTier: "strong",
      reasonCode: "hard_risk_override",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "OpenAI",
      from_address: "news@openai.com",
      subject: "Action required: API deprecation and shutdown notice",
      body_snippet: "A deprecated API will be shut down and requires migration.",
    }))).toMatchObject({
      action: "route_model",
      reasonCode: "no_preflight_match",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Scheduling Support",
      from_address: "scheduling@calstatela.edu",
      subject: "Final Exam Schedule Available in GET",
      body_snippet: "You are required to confirm your exam schedule by the deadline.",
    }))).toMatchObject({
      action: "route_model",
      reasonCode: "no_preflight_match",
    });
  });

  it("finalizes exact third-pass credit monitoring and service-balance profiles", () => {
    expect(evaluateTriagePreflight(email({
      from_name: "Chase Credit Journey",
      from_address: "no.reply.alerts@chase.com",
      subject: "Here's your latest Credit Summary",
    }))).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "finance",
      reasonCode: "credit_monitoring_fyi",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Experian Alerts",
      from_address: "support@s.usa.experian.com",
      subject: "Your FICO Score changed",
    }))).toMatchObject({
      action: "finalize",
      lane: "fyi",
      category: "finance",
      reasonCode: "credit_monitoring_fyi",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "PikaPods Support",
      from_address: "support@pikapods.com",
      subject: "Low Balance: Your account balance is $0.98",
      body_snippet: "Your account is nearly out of funds; service may stop if balance hits zero.",
    }))).toMatchObject({
      action: "finalize",
      lane: "needs_attention",
      category: "finance",
      decisionAction: "Recharge PikaPods balance",
      reasonCode: "service_balance_needs_attention",
    });
  });

  it("keeps credit-alert and generic low-balance escapes out of low-cost finalization", () => {
    expect(evaluateTriagePreflight(email({
      from_name: "Experian Alerts",
      from_address: "support@s.usa.experian.com",
      subject: "Heads up Andy! You have new alerts on your Experian credit file",
    }))).toMatchObject({
      action: "route_model",
      reasonCode: "no_preflight_match",
    });

    expect(evaluateTriagePreflight(email({
      from_name: "Utility Billing",
      from_address: "billing@utility.example",
      subject: "Low Balance: Your account balance is $0.98",
      body_snippet: "Your account is nearly out of funds; service may stop if balance hits zero.",
    }))).toMatchObject({
      action: "route_model",
      modelTier: "strong",
      reasonCode: "hard_risk_override",
    });
  });
});

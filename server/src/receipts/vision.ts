import type Anthropic from "@anthropic-ai/sdk";

/** Structured extraction from a receipt photo. The model's numbers are untrusted —
 * the caller re-validates (positive, capped) and applies fraud controls. */
export interface ReceiptExtraction {
  total: number;
  currency: string;
  merchant: string;
  date: string;
  looksGenuine: boolean;
  tamperConcerns: string;
}

const PROMPT = `You are extracting fields from a photo of a purchase receipt.
Respond with ONLY a JSON object (no prose, no markdown fences) of exactly this shape:
{"total": number, "currency": string, "merchant": string, "date": string, "looksGenuine": boolean, "tamperConcerns": string}
- "total": the grand total actually paid, as a plain number (no currency symbol).
- "currency": ISO code if determinable (e.g. "USD"), else "".
- "merchant": the business name, else "".
- "date": the receipt date as printed, else "".
- "looksGenuine": false if the image looks edited, screenshotted, hand-written, or not a real receipt.
- "tamperConcerns": brief note of anything suspicious, else "".
If this is not a receipt at all, set total to 0 and looksGenuine to false.`;

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

/** Returns the parsed extraction, or null if the model output couldn't be parsed. */
export async function extractReceipt(
  client: Anthropic,
  base64: string,
  mimeType: string,
): Promise<ReceiptExtraction | null> {
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: base64,
            },
          },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) return null;

  try {
    const raw = JSON.parse(stripFences(text)) as Record<string, unknown>;
    const total = Number(raw.total);
    if (!Number.isFinite(total)) return null;
    return {
      total,
      currency: typeof raw.currency === "string" ? raw.currency : "",
      merchant: typeof raw.merchant === "string" ? raw.merchant : "",
      date: typeof raw.date === "string" ? raw.date : "",
      looksGenuine: raw.looksGenuine === true,
      tamperConcerns: typeof raw.tamperConcerns === "string" ? raw.tamperConcerns : "",
    };
  } catch {
    return null;
  }
}

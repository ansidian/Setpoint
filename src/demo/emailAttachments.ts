import type { EmailBodyAttachment } from "../../shared/types/email.ts";
import { createDemoApiError } from "./config.ts";

function buildDemoBudgetPdf(): string {
  const pageText = "BT /F1 18 Tf 72 720 Td (Fictional Setpoint demo attachment) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${pageText.length} >>\nstream\n${pageText}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

const DEMO_BUDGET_PDF = buildDemoBudgetPdf();

const DEMO_ATTACHMENTS: Record<string, Array<EmailBodyAttachment & { content: string }>> = {
  "demo-email-budget": [{
    id: "2",
    filename: "demo-rollout-budget.pdf",
    contentType: "application/pdf",
    contentDisposition: "attachment",
    cid: null,
    size: new TextEncoder().encode(DEMO_BUDGET_PDF).byteLength,
    inline: false,
    content: DEMO_BUDGET_PDF,
  }],
};

export function getDemoEmailAttachmentDescriptors(uid: string): EmailBodyAttachment[] {
  return (DEMO_ATTACHMENTS[uid] || []).map(({ content: _content, ...attachment }) => ({ ...attachment }));
}

export function getDemoEmailAttachmentBlob(uid: string, attachmentId: string): Blob {
  const attachment = DEMO_ATTACHMENTS[uid]?.find((candidate) => candidate.id === attachmentId);
  if (!attachment) throw createDemoApiError(`/api/briefing/email/${uid}/attachments/${attachmentId}`);
  return new Blob([attachment.content], { type: attachment.contentType || "application/octet-stream" });
}

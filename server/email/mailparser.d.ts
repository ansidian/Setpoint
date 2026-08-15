declare module "mailparser" {
  export interface ParsedMailAddress {
    text?: string;
  }

  export interface ParsedMailAttachment {
    filename?: string;
    contentType?: string;
    contentDisposition?: string;
    cid?: string;
  }

  export interface ParsedMail {
    html?: string | false;
    textAsHtml?: string;
    text?: string;
    subject?: string;
    from?: ParsedMailAddress;
    date?: Date;
    attachments?: ParsedMailAttachment[];
  }

  export function simpleParser(source: Buffer | string): Promise<ParsedMail>;
}

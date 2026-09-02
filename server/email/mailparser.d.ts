declare module "mailparser" {
  export interface ParsedMailAddress {
    text?: string;
  }

  export interface ParsedMailAttachment {
    filename?: string;
    contentType?: string;
    contentDisposition?: string;
    cid?: string;
    partId?: string | null;
    size?: number;
    content?: Buffer;
    related?: boolean;
  }

  export interface ParsedMail {
    headerLines?: Array<{ key: string; line: string }>;
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

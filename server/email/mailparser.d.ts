declare module "mailparser" {
  export interface ParsedMailAddress {
    text?: string;
  }

  export interface ParsedMail {
    html?: string | false;
    textAsHtml?: string;
    text?: string;
    subject?: string;
    from?: ParsedMailAddress;
    date?: Date;
  }

  export function simpleParser(source: Buffer | string): Promise<ParsedMail>;
}

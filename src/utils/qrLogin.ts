import QRCode from 'qrcode';

export function buildTelegramLoginUrl(token: Buffer): string {
  return `tg://login?token=${token.toString('base64url')}`;
}

export async function qrPngForLoginUrl(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: 400,
    errorCorrectionLevel: 'M',
  });
}

import { createHmac, randomBytes } from "node:crypto";

// Подпись вынесена за интерфейс: настоящая ЭЦП (аппаратный токен или сертификат, ключ не покидает
// устройство врача) подключается заменой реализации. Выбор схемы ждёт юридического ответа (Фаза 0).
export interface Signer {
  readonly demo: boolean;
  readonly scheme: string;
  sign(documentHash: string): string;
}

/** ДЕМО: HMAC на серверном ключе. Не является ЭЦП и не имеет юридической силы. */
export class DemoSigner implements Signer {
  readonly demo = true;
  readonly scheme = "DEMO-HMAC-SHA256 (не ЭЦП)";
  private key: Buffer;
  constructor(key?: string) {
    this.key = key ? Buffer.from(key) : randomBytes(32);
  }
  sign(documentHash: string): string {
    return createHmac("sha256", this.key).update(documentHash).digest("hex");
  }
}
